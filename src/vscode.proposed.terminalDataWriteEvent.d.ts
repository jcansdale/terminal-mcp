declare module 'vscode' {
	export interface TerminalDataWriteEvent {
		readonly terminal: Terminal;
		readonly data: string;
	}

	namespace window {
		export const onDidWriteTerminalData: Event<TerminalDataWriteEvent>;
	}
}