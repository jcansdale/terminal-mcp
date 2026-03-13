import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import * as vscode from 'vscode';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod/v4';
import type { TerminalSessionManager } from './terminalSessionManager';

interface McpSession {
	server: McpServer;
	transport: StreamableHTTPServerTransport;
}

interface RunInTerminalArgs {
	command: string;
	explanation: string;
	goal: string;
	isBackground: boolean;
	timeout: number;
}

interface AwaitTerminalArgs {
	id: string;
	timeout: number;
}

interface TerminalIdArgs {
	id: string;
}

export const TERMINAL_MCP_VERSION = '0.0.1';

export const TERMINAL_MCP_METADATA: vscode.McpServerMetadata = {
	instructions: 'Terminal MCP exposes VS Code terminal tools for running commands, waiting for completion, reading captured output, and terminating tracked terminals.',
	serverInfo: {
		name: 'terminal-mcp',
		version: TERMINAL_MCP_VERSION
	},
	tools: [
		{
			availability: vscode.McpToolAvailability.Initial,
			definition: {
				name: 'runInTerminal',
				description: 'Execute a shell command in a VS Code terminal. Background executions return a terminal ID. Foreground executions wait for completion when shell integration is available.',
				inputSchema: {
					type: 'object',
					properties: {
						command: { type: 'string', description: 'The command to run in the terminal.' },
						explanation: { type: 'string', description: 'A one-sentence description of what the command does. This is shown before execution.' },
						goal: { type: 'string', description: 'A short description of the purpose of the command.' },
						isBackground: { type: 'boolean', description: 'Whether the command should continue running in the background.' },
						timeout: { type: 'number', description: 'Timeout in milliseconds for foreground execution. Use 0 for no timeout.' }
					},
					required: ['command', 'explanation', 'goal', 'isBackground', 'timeout']
				}
			}
		},
		{
			availability: vscode.McpToolAvailability.Initial,
			definition: {
				name: 'awaitTerminal',
				description: 'Wait for a background terminal command to complete. Returns the output, exit code, or timeout status.',
				inputSchema: {
					type: 'object',
					properties: {
						id: { type: 'string', description: 'The ID of the terminal to await.' },
						timeout: { type: 'number', description: 'Timeout in milliseconds. Use 0 for no timeout.' }
					},
					required: ['id', 'timeout']
				}
			}
		},
		{
			availability: vscode.McpToolAvailability.Initial,
			definition: {
				name: 'getTerminalOutput',
				description: 'Get the output of a terminal command previously started with runInTerminal.',
				inputSchema: {
					type: 'object',
					properties: {
						id: { type: 'string', description: 'The ID of the terminal to check.' }
					},
					required: ['id']
				}
			}
		},
		{
			availability: vscode.McpToolAvailability.Initial,
			definition: {
				name: 'killTerminal',
				description: 'Kill a tracked terminal by its ID and return the output captured so far.',
				inputSchema: {
					type: 'object',
					properties: {
						id: { type: 'string', description: 'The ID of the tracked terminal to kill.' }
					},
					required: ['id']
				}
			}
		}
	]
};

export class TerminalMcpHttpServer {
	private readonly _sessions = new Map<string, McpSession>();
	private _server: Server | undefined;
	private _url: URL | undefined;

	constructor(private readonly _terminalManager: TerminalSessionManager) {
	}

	public get url(): URL {
		if (!this._url) {
			throw new Error('Server has not been started.');
		}
		return this._url;
	}

	public async start(): Promise<URL> {
		if (this._server && this._url) {
			return this._url;
		}

		this._server = createServer((req, res) => {
			void this._handleRequest(req, res);
		});

		await new Promise<void>((resolve, reject) => {
			this._server!.once('error', reject);
			this._server!.listen(0, '127.0.0.1', () => {
				this._server!.off('error', reject);
				resolve();
			});
		});

		const address = this._server.address();
		if (!address || typeof address === 'string') {
			throw new Error('Failed to determine server address.');
		}

		this._url = new URL(`http://127.0.0.1:${(address as AddressInfo).port}/mcp`);
		return this._url;
	}

	public async stop(): Promise<void> {
		for (const session of this._sessions.values()) {
			await session.transport.close();
			await session.server.close();
		}
		this._sessions.clear();
		if (this._server) {
			await new Promise<void>((resolve, reject) => {
				this._server!.close(error => {
					if (error) {
						reject(error);
						return;
					}
					resolve();
				});
			});
		}
		this._server = undefined;
		this._url = undefined;
	}

	private async _handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
		if (req.url === '/health') {
			res.writeHead(200, { 'content-type': 'application/json' });
			res.end(JSON.stringify({ ok: true }));
			return;
		}

		if (req.url !== '/mcp') {
			res.writeHead(404).end('Not Found');
			return;
		}

		try {
			const sessionId = this._getSessionId(req);
			const existingSession = sessionId ? this._sessions.get(sessionId) : undefined;

			if (sessionId && !existingSession) {
				this._writeJsonRpcError(res, 404, -32001, 'Session not found');
				return;
			}

			if (existingSession) {
				await existingSession.transport.handleRequest(req, res);
				return;
			}

			const session = await this._createSession();
			await session.transport.handleRequest(req, res);

			if (!session.transport.sessionId) {
				await session.transport.close();
				await session.server.close();
			}
		} catch (error) {
			console.error('Terminal MCP request failed', error);
			if (!res.headersSent) {
				this._writeJsonRpcError(res, 500, -32603, 'Internal server error');
			}
		}
	}

	private async _createSession(): Promise<McpSession> {
		const server = this._createMcpServer();
		let session: McpSession | undefined;
		const transport = new StreamableHTTPServerTransport({
			sessionIdGenerator: () => randomUUID(),
			enableJsonResponse: true,
			onsessioninitialized: sessionId => {
				if (!session) {
					throw new Error('Session initialized before transport was ready.');
				}
				this._sessions.set(sessionId, session);
			},
			onsessionclosed: async sessionId => {
				const existingSession = this._sessions.get(sessionId);
				this._sessions.delete(sessionId);
				if (existingSession) {
					await existingSession.server.close();
				}
			}
		});

		session = { server, transport };
		await server.connect(transport);
		return session;
	}

	private _getSessionId(req: IncomingMessage): string | undefined {
		const header = req.headers['mcp-session-id'];
		if (Array.isArray(header)) {
			return header[0];
		}
		return header;
	}

	private _writeJsonRpcError(res: ServerResponse, status: number, code: number, message: string): void {
		res.writeHead(status, { 'content-type': 'application/json' });
		res.end(JSON.stringify({
			jsonrpc: '2.0',
			error: {
				code,
				message
			},
			id: null
		}));
	}

	private _createMcpServer(): McpServer {
		const server = new McpServer({
			name: 'terminal-mcp',
			version: TERMINAL_MCP_VERSION
		});

		server.registerTool(
			'runInTerminal',
			{
				description: 'Execute a shell command in a VS Code terminal. Background executions return a terminal ID. Foreground executions wait for completion when shell integration is available.',
				inputSchema: {
					command: z.string().describe('The command to run in the terminal.'),
					explanation: z.string().describe('A one-sentence description of what the command does. This is shown before execution.'),
					goal: z.string().describe('A short description of the purpose of the command.'),
					isBackground: z.boolean().describe('Whether the command should continue running in the background.'),
					timeout: z.number().describe('Timeout in milliseconds for foreground execution. Use 0 for no timeout.')
				}
			},
			async (args: RunInTerminalArgs) => {
				const result = await this._terminalManager.runInTerminal(args);
				const text = result.id
					? `Started background terminal ${result.id}${result.warning ? `\nWarning: ${result.warning}` : ''}`
					: `Command finished${result.exitCode !== undefined ? ` (exit code: ${result.exitCode})` : ''}${result.timedOut ? ' after timing out' : ''}:\n${result.output ?? ''}${result.warning ? `\nWarning: ${result.warning}` : ''}`;
				return {
					content: [{ type: 'text' as const, text }]
				};
			}
		);

		server.registerTool(
			'awaitTerminal',
			{
				description: 'Wait for a background terminal command to complete. Returns the output, exit code, or timeout status.',
				inputSchema: {
					id: z.string().describe('The ID of the terminal to await.'),
					timeout: z.number().describe('Timeout in milliseconds. Use 0 for no timeout.')
				}
			},
			async ({ id, timeout }: AwaitTerminalArgs) => {
				const result = await this._terminalManager.awaitTerminal(id, timeout);
				return {
					content: [{
						type: 'text' as const,
						text: `Terminal ${id}${result.timedOut ? ` timed out after ${timeout}ms` : ' completed'}${result.exitCode !== undefined ? ` (exit code: ${result.exitCode})` : ''}:\n${result.output}${result.warning ? `\nWarning: ${result.warning}` : ''}`
					}]
				};
			}
		);

		server.registerTool(
			'getTerminalOutput',
			{
				description: 'Get the output of a terminal command previously started with runInTerminal.',
				inputSchema: {
					id: z.string().describe('The ID of the terminal to check.')
				}
			},
			async ({ id }: TerminalIdArgs) => {
				const output = this._terminalManager.getTerminalOutput(id);
				return {
					content: [{ type: 'text' as const, text: `Output of terminal ${id}:\n${output}` }]
				};
			}
		);

		server.registerTool(
			'killTerminal',
			{
				description: 'Kill a tracked terminal by its ID and return the output captured so far.',
				inputSchema: {
					id: z.string().describe('The ID of the tracked terminal to kill.')
				}
			},
			async ({ id }: TerminalIdArgs) => {
				const output = this._terminalManager.killTerminal(id);
				return {
					content: [{ type: 'text' as const, text: `Successfully killed terminal ${id}.\n${output}` }]
				};
			}
		);

		return server;
	}
}