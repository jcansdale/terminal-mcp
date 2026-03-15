import * as vscode from 'vscode';
import type { AwaitTerminalResult, RunInTerminalParams, RunInTerminalResult, TerminalSessionManager } from './terminalSessionManager';

interface AwaitTerminalParams {
	id: string;
	timeout: number;
}

interface TerminalIdParams {
	id: string;
}

function createToolResult(text: string): vscode.LanguageModelToolResult {
	return new vscode.LanguageModelToolResult([
		new vscode.LanguageModelTextPart(text)
	]);
}

function formatRunInTerminalResult(result: RunInTerminalResult): string {
	if (result.id) {
		return `Started background terminal ${result.id}${result.warning ? `\nWarning: ${result.warning}` : ''}`;
	}

	return `Command finished${result.exitCode !== undefined ? ` (exit code: ${result.exitCode})` : ''}${result.timedOut ? ' after timing out' : ''}:\n${result.output ?? ''}${result.warning ? `\nWarning: ${result.warning}` : ''}`;
}

function formatAwaitTerminalResult(id: string, timeout: number, result: AwaitTerminalResult): string {
	return `Terminal ${id}${result.timedOut ? ` timed out after ${timeout}ms` : ' completed'}${result.exitCode !== undefined ? ` (exit code: ${result.exitCode})` : ''}:\n${result.output}${result.warning ? `\nWarning: ${result.warning}` : ''}`;
}

function getInvocationMessage(command: string, isBackground: boolean): string {
	const normalizedCommand = command.replace(/\r\n|\r|\n/g, ' ');
	const truncatedCommand = normalizedCommand.length > 80
		? `${normalizedCommand.slice(0, 77)}...`
		: normalizedCommand;
	return isBackground
		? `Running \`${truncatedCommand}\` in background`
		: `Running \`${truncatedCommand}\``;
}

function createRunInTerminalTool(terminalManager: TerminalSessionManager): vscode.LanguageModelTool<RunInTerminalParams> {
	return {
		prepareInvocation(options) {
			return {
				invocationMessage: getInvocationMessage(options.input.command, options.input.isBackground),
				confirmationMessages: {
					title: 'Run Command in Terminal',
					message: options.input.explanation
				}
			};
		},
		async invoke(options) {
			const result = await terminalManager.runInTerminal(options.input);
			return createToolResult(formatRunInTerminalResult(result));
		}
	};
}

function createAwaitTerminalTool(terminalManager: TerminalSessionManager): vscode.LanguageModelTool<AwaitTerminalParams> {
	return {
		prepareInvocation(options) {
			return {
				invocationMessage: `Waiting for terminal ${options.input.id}`
			};
		},
		async invoke(options) {
			const result = await terminalManager.awaitTerminal(options.input.id, options.input.timeout);
			return createToolResult(formatAwaitTerminalResult(options.input.id, options.input.timeout, result));
		}
	};
}

function createGetTerminalOutputTool(terminalManager: TerminalSessionManager): vscode.LanguageModelTool<TerminalIdParams> {
	return {
		prepareInvocation(options) {
			return {
				invocationMessage: `Getting output from terminal ${options.input.id}`
			};
		},
		async invoke(options) {
			const output = terminalManager.getTerminalOutput(options.input.id);
			return createToolResult(`Output of terminal ${options.input.id}:\n${output}`);
		}
	};
}

function createKillTerminalTool(terminalManager: TerminalSessionManager): vscode.LanguageModelTool<TerminalIdParams> {
	return {
		prepareInvocation(options) {
			return {
				invocationMessage: `Killing terminal ${options.input.id}`,
				confirmationMessages: {
					title: 'Kill Terminal',
					message: `Terminate tracked terminal ${options.input.id}.`
				}
			};
		},
		async invoke(options) {
			const output = terminalManager.killTerminal(options.input.id);
			return createToolResult(`Successfully killed terminal ${options.input.id}.\n${output}`);
		}
	};
}

export function registerTools(context: vscode.ExtensionContext, terminalManager: TerminalSessionManager): void {
	context.subscriptions.push(
		vscode.lm.registerTool<RunInTerminalParams>('runInTerminal', createRunInTerminalTool(terminalManager)),
		vscode.lm.registerTool<AwaitTerminalParams>('awaitTerminal', createAwaitTerminalTool(terminalManager)),
		vscode.lm.registerTool<TerminalIdParams>('getTerminalOutput', createGetTerminalOutputTool(terminalManager)),
		vscode.lm.registerTool<TerminalIdParams>('killTerminal', createKillTerminalTool(terminalManager)),
	);
}