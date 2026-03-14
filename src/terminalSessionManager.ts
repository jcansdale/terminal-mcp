import { randomUUID } from 'node:crypto';
import * as vscode from 'vscode';

const SHELL_INTEGRATION_WAIT_MS = 3000;
const OUTPUT_LIMIT = 60 * 1024;

const CHAT_TERMINAL_PROFILE_SETTING_BY_PLATFORM: Partial<Record<NodeJS.Platform, string>> = {
	aix: undefined,
	android: 'chat.tools.terminal.terminalProfile.linux',
	darwin: 'chat.tools.terminal.terminalProfile.osx',
	freebsd: 'chat.tools.terminal.terminalProfile.linux',
	linux: 'chat.tools.terminal.terminalProfile.linux',
	openbsd: 'chat.tools.terminal.terminalProfile.linux',
	sunos: 'chat.tools.terminal.terminalProfile.linux',
	win32: 'chat.tools.terminal.terminalProfile.windows',
	cygwin: 'chat.tools.terminal.terminalProfile.windows',
	netbsd: 'chat.tools.terminal.terminalProfile.linux',
};

interface TerminalChatProfile {
	title?: string;
	path: string;
	args?: string[] | string;
	env?: Record<string, string | null>;
	icon?: string;
	color?: string;
}

export interface RunInTerminalParams {
	command: string;
	explanation: string;
	goal: string;
	isBackground: boolean;
	timeout: number;
}

export interface RunInTerminalResult {
	id?: string;
	output?: string;
	exitCode?: number;
	timedOut?: boolean;
	warning?: string;
}

export interface AwaitTerminalResult {
	output: string;
	exitCode?: number;
	timedOut: boolean;
	warning?: string;
}

interface ExecutionRecord {
	id: string;
	terminal: vscode.Terminal;
	command: string;
	isBackground: boolean;
	startTime: number;
	output: string;
	exitCode: number | undefined;
	completed: boolean;
	completionPromise: Promise<void>;
	resolveCompletion: () => void;
	rejectCompletion: (error: Error) => void;
	useRawDataCapture: boolean;
	canAwait: boolean;
	warning?: string;
}

export class TerminalSessionManager implements vscode.Disposable {
	private readonly _disposables: vscode.Disposable[] = [];
	private readonly _executions = new Map<string, ExecutionRecord>();
	private _sharedTerminal: vscode.Terminal | undefined;

	constructor() {
		this._disposables.push(vscode.window.onDidWriteTerminalData(event => {
			for (const execution of this._executions.values()) {
				if (execution.useRawDataCapture && execution.terminal === event.terminal) {
					this._appendOutput(execution, event.data);
				}
			}
		}));

		this._disposables.push(vscode.window.onDidCloseTerminal(terminal => {
			if (this._sharedTerminal === terminal) {
				this._sharedTerminal = undefined;
			}

			for (const execution of this._executions.values()) {
				if (execution.terminal === terminal && !execution.completed) {
					execution.exitCode = terminal.exitStatus?.code;
					execution.completed = true;
					execution.resolveCompletion();
				}
			}
		}));
	}

	public dispose(): void {
		for (const execution of this._executions.values()) {
			execution.terminal.dispose();
		}
		this._executions.clear();
		this._sharedTerminal?.dispose();
		this._sharedTerminal = undefined;
		vscode.Disposable.from(...this._disposables).dispose();
	}

	public resetSharedTerminal(): void {
		this._sharedTerminal?.dispose();
		this._sharedTerminal = undefined;
	}

	public async runInTerminal(params: RunInTerminalParams): Promise<RunInTerminalResult> {
		const terminal = params.isBackground ? this._createBackgroundTerminal(params.goal) : this._getOrCreateSharedTerminal();
		const execution = this._createExecutionRecord(terminal, params);

		const shellIntegration = await this._waitForShellIntegration(terminal, SHELL_INTEGRATION_WAIT_MS);
		if (!shellIntegration) {
			execution.canAwait = false;
			execution.useRawDataCapture = true;
			execution.warning = 'Shell integration did not activate. Output capture is best-effort and completion tracking is unavailable for this command.';
			terminal.sendText(params.command, true);

			if (params.isBackground) {
				return {
					id: execution.id,
					warning: execution.warning,
				};
			}

			return {
				output: this._finalizeOutput(execution.output),
				warning: execution.warning,
				timedOut: false,
			};
		}

		const shellExecution = shellIntegration.executeCommand(params.command);
		void this._consumeExecutionOutput(execution, shellExecution);
		const completionDisposable = vscode.window.onDidEndTerminalShellExecution(event => {
			if (event.execution === shellExecution) {
				execution.exitCode = event.exitCode;
				execution.completed = true;
				execution.resolveCompletion();
				completionDisposable.dispose();
			}
		});

		if (params.isBackground) {
			return { id: execution.id };
		}

		const didTimeOut = await this._awaitWithTimeout(execution.completionPromise, Math.max(0, params.timeout));
		return {
			output: this._finalizeOutput(execution.output),
			exitCode: didTimeOut ? undefined : execution.exitCode,
			timedOut: didTimeOut,
			warning: execution.warning,
		};
	}

	public async awaitTerminal(id: string, timeout: number): Promise<AwaitTerminalResult> {
		const execution = this._getExecution(id);
		if (!execution.canAwait) {
			return {
				output: this._finalizeOutput(execution.output),
				timedOut: false,
				warning: execution.warning ?? 'Completion tracking is unavailable for this terminal execution.',
			};
		}

		const didTimeOut = await this._awaitWithTimeout(execution.completionPromise, Math.max(0, timeout));
		return {
			output: this._finalizeOutput(execution.output),
			exitCode: didTimeOut ? undefined : execution.exitCode,
			timedOut: didTimeOut,
			warning: execution.warning,
		};
	}

	public getTerminalOutput(id: string): string {
		return this._finalizeOutput(this._getExecution(id).output);
	}

	public killTerminal(id: string): string {
		const execution = this._getExecution(id);
		const output = this._finalizeOutput(execution.output);
		execution.terminal.dispose();
		this._executions.delete(id);
		return output;
	}

	private _getExecution(id: string): ExecutionRecord {
		const execution = this._executions.get(id);
		if (!execution) {
			throw new Error(`No active terminal execution found with ID ${id}.`);
		}
		return execution;
	}


	private _createBackgroundTerminal(goal: string): vscode.Terminal {
		const profile = this._getChatTerminalProfile();
		return vscode.window.createTerminal({
			...this._getBaseTerminalOptions(profile),
			name: `${this._getTerminalBaseName(profile)}: ${goal}`,
		});
	}

	private _getOrCreateSharedTerminal(): vscode.Terminal {
		if (this._sharedTerminal) {
			return this._sharedTerminal;
		}

		this._sharedTerminal = vscode.window.createTerminal({
			...this._getBaseTerminalOptions(),
			name: this._getTerminalBaseName(),
		});
		return this._sharedTerminal;
	}

	private _getBaseTerminalOptions(profile = this._getChatTerminalProfile()): vscode.TerminalOptions {
		return {
			cwd: this._getWorkspaceFolderUri(),
			shellPath: profile?.path,
			shellArgs: profile?.args,
			env: profile?.env,
			iconPath: profile?.icon ? new vscode.ThemeIcon(profile.icon) : undefined,
			color: profile?.color ? new vscode.ThemeColor(profile.color) : undefined,
		};
	}

	private _getTerminalBaseName(profile = this._getChatTerminalProfile()): string {
		return profile?.title || 'Terminal MCP';
	}

	private _getChatTerminalProfile(): TerminalChatProfile | undefined {
		const setting = CHAT_TERMINAL_PROFILE_SETTING_BY_PLATFORM[process.platform];
		if (!setting) {
			return undefined;
		}

		const profile = vscode.workspace.getConfiguration().get<unknown>(setting);
		if (!this._isTerminalChatProfile(profile)) {
			return undefined;
		}

		return profile;
	}

	private _isTerminalChatProfile(profile: unknown): profile is TerminalChatProfile {
		if (!profile || typeof profile !== 'object') {
			return false;
		}

		const candidate = profile as Partial<TerminalChatProfile>;
		if (typeof candidate.path !== 'string') {
			return false;
		}

		if (candidate.title !== undefined && typeof candidate.title !== 'string') {
			return false;
		}

		if (candidate.args !== undefined && !this._isShellArgs(candidate.args)) {
			return false;
		}

		if (candidate.icon !== undefined && typeof candidate.icon !== 'string') {
			return false;
		}

		if (candidate.color !== undefined && typeof candidate.color !== 'string') {
			return false;
		}

		if (candidate.env !== undefined && !this._isTerminalEnvironment(candidate.env)) {
			return false;
		}

		return true;
	}

	private _isShellArgs(args: unknown): args is string[] | string {
		return typeof args === 'string' || (Array.isArray(args) && args.every(arg => typeof arg === 'string'));
	}

	private _isTerminalEnvironment(env: unknown): env is Record<string, string | null> {
		if (!env || typeof env !== 'object' || Array.isArray(env)) {
			return false;
		}

		return Object.values(env).every(value => typeof value === 'string' || value === null);
	}

	private _getWorkspaceFolderUri(): vscode.Uri | undefined {
		return vscode.workspace.workspaceFolders?.[0]?.uri;
	}

	private _createExecutionRecord(terminal: vscode.Terminal, params: RunInTerminalParams): ExecutionRecord {
		const id = randomUUID();
		let resolveCompletion!: () => void;
		let rejectCompletion!: (error: Error) => void;
		const completionPromise = new Promise<void>((resolve, reject) => {
			resolveCompletion = resolve;
			rejectCompletion = reject;
		});

		const execution: ExecutionRecord = {
			id,
			terminal,
			command: params.command,
			isBackground: params.isBackground,
			startTime: Date.now(),
			output: '',
			exitCode: undefined,
			completed: false,
			completionPromise,
			resolveCompletion,
			rejectCompletion,
			useRawDataCapture: false,
			canAwait: true,
		};

		this._executions.set(id, execution);
		return execution;
	}

	private async _waitForShellIntegration(terminal: vscode.Terminal, timeoutMs: number): Promise<vscode.TerminalShellIntegration | undefined> {
		if (terminal.shellIntegration) {
			return terminal.shellIntegration;
		}

		return await new Promise<vscode.TerminalShellIntegration | undefined>(resolve => {
			const timeoutHandle = setTimeout(() => {
				disposable.dispose();
				resolve(undefined);
			}, timeoutMs);

			const disposable = vscode.window.onDidChangeTerminalShellIntegration(event => {
				if (event.terminal === terminal) {
					clearTimeout(timeoutHandle);
					disposable.dispose();
					resolve(event.shellIntegration);
				}
			});
		});
	}

	private async _consumeExecutionOutput(execution: ExecutionRecord, shellExecution: vscode.TerminalShellExecution): Promise<void> {
		try {
			for await (const chunk of shellExecution.read()) {
				this._appendOutput(execution, chunk);
			}
		} catch (error) {
			execution.warning = error instanceof Error ? error.message : String(error);
		}
	}

	private _appendOutput(execution: ExecutionRecord, chunk: string): void {
		if (!chunk) {
			return;
		}

		execution.output += chunk;
		if (execution.output.length > OUTPUT_LIMIT) {
			execution.output = `[output truncated to last ${OUTPUT_LIMIT} bytes]\n${execution.output.slice(-OUTPUT_LIMIT)}`;
		}
	}

	private _finalizeOutput(output: string): string {
		return output.trimEnd();
	}

	private async _awaitWithTimeout(promise: Promise<void>, timeoutMs: number): Promise<boolean> {
		if (timeoutMs <= 0) {
			await promise;
			return false;
		}

		return await new Promise<boolean>(resolve => {
			const timeoutHandle = setTimeout(() => resolve(true), timeoutMs);
			void promise.finally(() => {
				clearTimeout(timeoutHandle);
				resolve(false);
			});
		});
	}
}