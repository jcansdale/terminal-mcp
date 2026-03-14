import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const EXPECTED_TERMINAL_NAMES = ['Terminal MCP', 'Copilot Zsh'];

const PAYLOAD_LINE_COUNT = 19;
const PAYLOAD_LINES = Array.from({ length: PAYLOAD_LINE_COUNT }, (_, i) => {
	const label = `L${String(i + 1).padStart(2, '0')}`;
	return `${label} ${'a'.repeat(51)}`;
});
const MULTILINE_PAYLOAD = PAYLOAD_LINES.join('\n');
const MULTILINE_WC_COMMAND = `echo '${MULTILINE_PAYLOAD}' | wc -c`;
const MULTILINE_WC_EXPECTED_COUNT = String(Buffer.byteLength(`${MULTILINE_PAYLOAD}\n`, 'utf8'));

const LARGE_LINE_COUNT = 100;
const LARGE_LINES = Array.from({ length: LARGE_LINE_COUNT }, (_, i) => {
	const label = `L${String(i + 1).padStart(3, '0')}`;
	return `${label} ${'b'.repeat(51)}`;
});
const LARGE_MULTILINE_PAYLOAD = LARGE_LINES.join('\n');
const LARGE_MULTILINE_WC_COMMAND = `echo '${LARGE_MULTILINE_PAYLOAD}' | wc -c`;
const LARGE_MULTILINE_WC_EXPECTED_COUNT = String(Buffer.byteLength(`${LARGE_MULTILINE_PAYLOAD}\n`, 'utf8'));

async function createClient(): Promise<Client> {
	await vscode.workspace.getConfiguration('terminal.integrated').update('shellIntegration.enabled', true, vscode.ConfigurationTarget.Workspace);
	const extension = vscode.extensions.getExtension('jcansdale.terminal-mcp');
	assert.ok(extension, 'Extension not available');
	await extension.activate();
	const serverUrl = await vscode.commands.executeCommand<string>('terminalMcp._getServerUrl');
	assert.ok(serverUrl, 'Server URL not returned');
	const transport = new StreamableHTTPClientTransport(new URL(serverUrl));
	const client = new Client({ name: 'terminal-mcp-tests', version: '0.0.1' });
	await client.connect(transport);
	return client;
}

async function runCommand(client: Client, command: string): Promise<string> {
	const result = await client.callTool({
		name: 'runInTerminal',
		arguments: { command, explanation: 'test', goal: 'test', isBackground: false, timeout: 30000 }
	});
	assert.ok(typeof result === 'object' && result !== null && 'content' in result);
	const { content } = result as { content: unknown };
	assert.ok(Array.isArray(content));
	const text = content.find((item: Record<string, unknown>) =>
		item && item.type === 'text' && typeof item.text === 'string'
	) as { text: string } | undefined;
	assert.ok(text, 'No text content');
	return text.text;
}

function assertFinished(output: string): void {
	assert.match(output, /Command finished/);
}

function assertCount(output: string, expected: string): void {
	if (!new RegExp(`(^|\\D)${expected}(\\D|$)`).test(output)) {
		assert.fail(`Expected byte count ${expected} in output:\n${output}`);
	}
}

function isFallback(output: string): boolean {
	return /Shell integration did not activate/.test(output);
}

async function findTerminal(): Promise<vscode.Terminal | undefined> {
	const deadline = Date.now() + 5000;
	while (Date.now() < deadline) {
		const t = vscode.window.terminals.find(c => EXPECTED_TERMINAL_NAMES.includes(c.name));
		if (t) return t;
		await new Promise(r => setTimeout(r, 50));
	}
	return undefined;
}

async function waitForShellIntegration(terminal: vscode.Terminal): Promise<boolean> {
	const deadline = Date.now() + 15000;
	while (Date.now() < deadline) {
		if (terminal.shellIntegration) return true;
		await new Promise(r => setTimeout(r, 50));
	}
	return false;
}

async function requireShellIntegration(client: Client, ctx: Mocha.Context): Promise<vscode.Terminal> {
	const output = await runCommand(client, 'printf ready');
	assertFinished(output);
	const terminal = await findTerminal();
	if (!terminal || !await waitForShellIntegration(terminal) || isFallback(output)) {
		ctx.skip();
	}
	return terminal!;
}

suite('Terminal MCP integration', () => {
	setup(async () => {
		await vscode.commands.executeCommand('terminalMcp._resetSharedTerminal');
	});

	test('smoke: foreground command executes end to end', async () => {
		const client = await createClient();
		try {
			const output = await runCommand(client, 'echo terminal-mcp-e2e');
			assertFinished(output);
			assert.ok(/terminal-mcp-e2e/.test(output) || isFallback(output), 'Expected output or fallback warning');
		} finally {
			await client.close();
		}
	});

	test('shell integration activates on the shared terminal', async () => {
		const client = await createClient();
		try {
			const output = await runCommand(client, 'printf ready');
			assertFinished(output);
			const terminal = await findTerminal();
			assert.ok(terminal, 'Shared terminal not found');
			assert.ok(await waitForShellIntegration(terminal), 'Shell integration did not activate');
			assert.ok(!isFallback(output), `Got fallback warning:\n${output}`);
		} finally {
			await client.close();
		}
	});

	test('single-line reuse: 10 commands through the same shell', async function () {
		const client = await createClient();
		try {
			await requireShellIntegration(client, this);
			for (let i = 1; i <= 10; i++) {
				const token = `reuse-${i}`;
				const expected = String(Buffer.byteLength(`${token}\n`, 'utf8'));
				const output = await runCommand(client, `echo ${token} | wc -c`);
				assertFinished(output);
				assertCount(output, expected);
			}
		} finally {
			await client.close();
		}
	});

	test('multiline: 19-line command succeeds on a fresh terminal', async function () {
		const client = await createClient();
		try {
			await requireShellIntegration(client, this);
			const output = await runCommand(client, MULTILINE_WC_COMMAND);
			assertFinished(output);
			assertCount(output, MULTILINE_WC_EXPECTED_COUNT);
		} finally {
			await client.close();
		}
	});

	test('multiline reuse: same 19-line command twice through the same shell', async function () {
		const client = await createClient();
		try {
			await requireShellIntegration(client, this);
			const first = await runCommand(client, MULTILINE_WC_COMMAND);
			assertFinished(first);
			assertCount(first, MULTILINE_WC_EXPECTED_COUNT);
			const second = await runCommand(client, MULTILINE_WC_COMMAND);
			assertFinished(second);
			assertCount(second, MULTILINE_WC_EXPECTED_COUNT);
		} finally {
			await client.close();
		}
	});

	test('single long line stress: increasing sizes via executeCommand', async function () {
		this.timeout(120000);
		const client = await createClient();
		try {
			await requireShellIntegration(client, this);
			const sizes = [100, 500, 1000, 2000, 5000, 10000, 20000, 50000];
			for (const size of sizes) {
				const payload = 'X'.repeat(size);
				const expected = String(Buffer.byteLength(`${payload}\n`, 'utf8'));
				const start = Date.now();
				const output = await runCommand(client, `echo '${payload}' | wc -c`);
				const elapsed = Date.now() - start;
				const passed = /Command finished/.test(output) && new RegExp(`(^|\\D)${expected}(\\D|$)`).test(output);
				console.log(`Single long line: ${size} bytes — ${passed ? 'PASS' : 'FAIL'} in ${elapsed}ms`);
				if (!passed) {
					assert.fail(`Failed at ${size} bytes:\n${output}`);
				}
			}
		} finally {
			await client.close();
		}
	});

	test('bracketed paste: 100-line multiline command via sendText', async function () {
		const client = await createClient();
		try {
			const terminal = await requireShellIntegration(client, this);
			let output = '';
			const listener = vscode.window.onDidWriteTerminalData(e => {
				if (e.terminal === terminal) output += e.data;
			});
			terminal.sendText(`\x1b[200~${LARGE_MULTILINE_WC_COMMAND}\x1b[201~`);
			const deadline = Date.now() + 30000;
			let found = false;
			while (Date.now() < deadline) {
				if (new RegExp(`(^|\\D)${LARGE_MULTILINE_WC_EXPECTED_COUNT}(\\D|$)`).test(output)) {
					found = true;
					break;
				}
				await new Promise(r => setTimeout(r, 100));
			}
			listener.dispose();
			assert.ok(found, `Expected byte count ${LARGE_MULTILINE_WC_EXPECTED_COUNT} in output:\n${output.slice(-500)}`);
		} finally {
			await client.close();
		}
	});
});
