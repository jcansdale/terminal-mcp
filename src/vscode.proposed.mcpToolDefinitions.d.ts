import 'vscode';

declare module 'vscode' {
	export enum McpToolAvailability {
		Initial = 0,
		Dynamic = 1,
	}

	export interface McpServerLanguageModelToolDefinition {
		definition?: unknown;
		availability: McpToolAvailability;
	}

	export interface McpServerMetadata {
		tools?: McpServerLanguageModelToolDefinition[];
		instructions?: string;
		capabilities?: unknown;
		serverInfo?: unknown;
	}

	export class McpHttpServerDefinition2 extends McpHttpServerDefinition {
		metadata?: McpServerMetadata;
		constructor(label: string, uri: Uri, headers?: Record<string, string>, version?: string, metadata?: McpServerMetadata, authentication?: { providerId: string; scopes: string[] });
	}
}