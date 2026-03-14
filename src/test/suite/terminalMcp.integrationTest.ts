import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const PAYLOAD_LINES = [
	'L01 aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
	'L02 aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
	'L03 aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
	'L04 aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
	'L05 aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
	'L06 aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
	'L07 aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
	'L08 aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
	'L09 aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
	'L10 aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
	'L11 aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
	'L12 aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
	'L13 aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
	'L14 aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
	'L15 aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
	'L16 aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
	'L17 aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
	'L18 aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
	'L19 aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
];

const MULTILINE_PAYLOAD = PAYLOAD_LINES.join('\n');
const HALF_MULTILINE_PAYLOAD = PAYLOAD_LINES.slice(0, 10).join('\n');

const MULTILINE_WC_COMMAND = `echo '${MULTILINE_PAYLOAD}' | wc -c`;
const MULTILINE_WC_EXPECTED_COUNT = String(Buffer.byteLength(`${MULTILINE_PAYLOAD}\n`, 'utf8'));
const HALF_MULTILINE_WC_COMMAND = `echo '${HALF_MULTILINE_PAYLOAD}' | wc -c`;
const HALF_MULTILINE_WC_EXPECTED_COUNT = String(Buffer.byteLength(`${HALF_MULTILINE_PAYLOAD}\n`, 'utf8'));

async function createClient(): Promise<Client> {
	await vscode.workspace.getConfiguration('terminal.integrated').update('shellIntegration.enabled', true, vscode.ConfigurationTarget.Workspace);
	await vscode.workspace.getConfiguration().update('chat.tools.terminal.terminalProfile.osx', {
		title: 'Copilot Zsh',
		path: '/bin/zsh',
		icon: 'robot'
	}, vscode.ConfigurationTarget.Workspace);

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

function assertCapturedCount(textContent: string, expectedCount: string): void {
	const capturedExpectedCount = new RegExp(`(^|\\D)${expectedCount}(\\D|$)`).test(textContent);
	if (!capturedExpectedCount) {
		console.error(`Captured textContent:\n${textContent}`);
		assert.fail(`Expected the byte count ${expectedCount} to appear in the captured command output`);
	}
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

	test('runInTerminal handles the multiline echo and wc command end to end', async () => {
		const client = await createClient();

		try {
			const textContent = await runForegroundCommand(
				client,
				MULTILINE_WC_COMMAND,
				'Count the bytes emitted by a multiline echo payload.',
				'Verify multiline commands survive end-to-end execution.'
			);
			assertCommandFinished(textContent);
			assertCapturedCount(textContent, MULTILINE_WC_EXPECTED_COUNT);
		} finally {
			await client.close();
		}
	});

	test('runInTerminal handles the half-length multiline echo and wc command end to end', async () => {
		const client = await createClient();

		try {
			const textContent = await runForegroundCommand(
				client,
				HALF_MULTILINE_WC_COMMAND,
				'Count the bytes emitted by a shorter multiline echo payload.',
				'Verify a shorter multiline command survives end-to-end execution.'
			);
			assertCommandFinished(textContent);
			assertCapturedCount(textContent, HALF_MULTILINE_WC_EXPECTED_COUNT);
		} finally {
			await client.close();
		}
	});

	test('runInTerminal can send the same multiline command twice through the reused shell', async () => {
		const client = await createClient();

		try {
			const firstRun = await runForegroundCommand(
				client,
				MULTILINE_WC_COMMAND,
				'Count the bytes emitted by a multiline echo payload.',
				'Verify the first multiline execution in the shared shell.'
			);
			assertCommandFinished(firstRun);
			assertCapturedCount(firstRun, MULTILINE_WC_EXPECTED_COUNT);

			const secondRun = await runForegroundCommand(
				client,
				MULTILINE_WC_COMMAND,
				'Count the bytes emitted by a multiline echo payload.',
				'Verify the second multiline execution in the reused shared shell.'
			);
			assertCommandFinished(secondRun);
			assertCapturedCount(secondRun, MULTILINE_WC_EXPECTED_COUNT);
		} finally {
			await client.close();
		}
	});
});