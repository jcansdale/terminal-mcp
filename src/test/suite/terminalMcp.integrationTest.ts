import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

async function createClient(): Promise<Client> {
	await vscode.workspace.getConfiguration('terminal.integrated').update('shellIntegration.enabled', true, vscode.ConfigurationTarget.Workspace);

	const extension = vscode.extensions.getExtension('jcansdale.terminal-mcp');
	assert.ok(extension, 'Expected extension to be available in the extension host');
	await extension.activate();

	const serverUrl = await vscode.commands.executeCommand<string>('terminalMcp._getServerUrl');
	assert.ok(serverUrl, 'Expected test command to return the MCP server URL');

	const transport = new StreamableHTTPClientTransport(new URL(serverUrl));
	const client = new Client({ name: 'terminal-mcp-tests', version: '0.0.1' });
	await client.connect(transport);

	const tools = await client.listTools();
	assert.ok(tools.tools.some(tool => tool.name === 'runInTerminal'), 'Expected runInTerminal tool to be registered');

	return client;
}

function getTextContent(result: unknown): string {
	assert.ok(typeof result === 'object' && result !== null && 'content' in result, 'Expected tool call to return content');
	const { content } = result as { content: unknown };
	assert.ok(Array.isArray(content), 'Expected tool call content to be an array');
	const textContent = content.find((item): item is { type: 'text'; text: string } => {
		return typeof item === 'object'
			&& item !== null
			&& 'type' in item
			&& item.type === 'text'
			&& 'text' in item
			&& typeof item.text === 'string';
	});
	assert.ok(textContent, 'Expected text content from tool call');
	return textContent.text;
}

async function runForegroundCommand(client: Client, command: string, explanation: string, goal: string): Promise<string> {
	const result = await client.callTool({
		name: 'runInTerminal',
		arguments: {
			command,
			explanation,
			goal,
			isBackground: false,
			timeout: 15000,
		}
	});

	return getTextContent(result);
}

function assertCommandFinished(textContent: string): void {
	assert.match(textContent, /Command finished/, 'Expected the server to report a completed foreground execution');
}

suite('Terminal MCP integration', () => {
	test('runInTerminal executes a foreground command end to end', async () => {
		const client = await createClient();

		try {
			const textContent = await runForegroundCommand(
				client,
				'echo terminal-mcp-e2e',
				'Print a stable test token.',
				'Verify end-to-end terminal execution.'
			);
			assertCommandFinished(textContent);

			const capturedOutput = /terminal-mcp-e2e/.test(textContent);
			const usedFallback = /Shell integration did not activate/.test(textContent);
			assert.ok(
				capturedOutput || usedFallback,
				'Expected either captured command output or the documented shell integration fallback warning'
			);
		} finally {
			await client.close();
		}
	});
});