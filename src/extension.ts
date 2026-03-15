import * as vscode from 'vscode';
import { TerminalSessionManager } from './terminalSessionManager';
import { registerTools } from './tools';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
	const terminalManager = new TerminalSessionManager();

	registerTools(context, terminalManager);

	const showShellIntegrationStatus = vscode.commands.registerCommand('terminalMcp.showShellIntegrationStatus', async () => {
		const terminal = vscode.window.activeTerminal;
		if (!terminal) {
			void vscode.window.showInformationMessage('No active terminal to inspect for shell integration.');
			return;
		}

		const status = terminal.shellIntegration ? 'active' : 'not active';
		void vscode.window.showInformationMessage(`Shell integration is ${status} for the active terminal: ${terminal.name}`);
	});

	const resetSharedTerminal = vscode.commands.registerCommand('terminalMcp._resetSharedTerminal', () => {
		terminalManager.resetSharedTerminal();
	});

	context.subscriptions.push(
		terminalManager,
		showShellIntegrationStatus,
		resetSharedTerminal,
	);

	void vscode.window.setStatusBarMessage('Terminal MCP tools registered', 5000);
}

export function deactivate(): void {
	// All cleanup is handled via extension subscriptions.
}