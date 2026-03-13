import * as vscode from 'vscode';
import { TERMINAL_MCP_METADATA, TERMINAL_MCP_VERSION, TerminalMcpHttpServer } from './server';
import { TerminalSessionManager } from './terminalSessionManager';

const MCP_PROVIDER_ID = 'terminal-mcp.provider';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
	const terminalManager = new TerminalSessionManager();
	const mcpServer = new TerminalMcpHttpServer(terminalManager);
	await mcpServer.start();

	const showServerUrl = vscode.commands.registerCommand('terminalMcp.showServerUrl', async () => {
		const serverUrl = mcpServer.url.toString();
		await vscode.env.clipboard.writeText(serverUrl);
		void vscode.window.showInformationMessage(`Terminal MCP server URL copied to clipboard: ${serverUrl}`);
	});

	const restartServer = vscode.commands.registerCommand('terminalMcp.restartServer', async () => {
		await mcpServer.stop();
		const restartedUrl = await mcpServer.start();
		void vscode.window.showInformationMessage(`Terminal MCP server restarted at ${restartedUrl.toString()}`);
	});

	const provider = vscode.lm.registerMcpServerDefinitionProvider(MCP_PROVIDER_ID, {
		provideMcpServerDefinitions(): vscode.ProviderResult<vscode.McpServerDefinition[]> {
			return [new vscode.McpHttpServerDefinition2('Terminal MCP', vscode.Uri.parse(mcpServer.url.toString()), undefined, TERMINAL_MCP_VERSION, TERMINAL_MCP_METADATA)];
		},
		async resolveMcpServerDefinition(server): Promise<vscode.McpServerDefinition> {
			const serverUrl = await mcpServer.start();
			if (server instanceof vscode.McpHttpServerDefinition) {
				server.uri = vscode.Uri.parse(serverUrl.toString());
			}
			return server;
		}
	});

	context.subscriptions.push(
		terminalManager,
		showServerUrl,
		restartServer,
		provider,
		new vscode.Disposable(() => {
			void mcpServer.stop();
		})
	);

	void vscode.window.setStatusBarMessage(`Terminal MCP ready: ${mcpServer.url.toString()}`, 5000);
}

export function deactivate(): void {
	// All cleanup is handled via extension subscriptions.
}