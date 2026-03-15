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

	export class McpServerDefinition {
		label: string;
		constructor(label: string);
	}

	export class McpHttpServerDefinition extends McpServerDefinition {
		uri: Uri;
		headers?: Record<string, string>;
		version?: string;
		constructor(label: string, uri: Uri, headers?: Record<string, string>, version?: string);
	}

	export class McpHttpServerDefinition2 extends McpHttpServerDefinition {
		metadata?: McpServerMetadata;
		constructor(label: string, uri: Uri, headers?: Record<string, string>, version?: string, metadata?: McpServerMetadata, authentication?: { providerId: string; scopes: string[] });
	}

	export interface McpServerDefinitionProvider {
		provideMcpServerDefinitions(): ProviderResult<McpServerDefinition[]>;
		resolveMcpServerDefinition?(server: McpServerDefinition): ProviderResult<McpServerDefinition>;
	}

	export namespace lm {
		export function registerMcpServerDefinitionProvider(id: string, provider: McpServerDefinitionProvider): Disposable;
	}
}