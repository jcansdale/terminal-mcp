import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const DEFAULT_TERMINAL_NAME = 'Terminal MCP';
const CUSTOM_PROFILE_TERMINAL_NAME = 'Copilot Zsh';

/**
 * Returns the terminal names that the extension might use for the shared foreground terminal,
 * depending on whether a custom chat terminal profile is configured.
 */
function getExpectedTerminalNames(): string[] {
	return [DEFAULT_TERMINAL_NAME, CUSTOM_PROFILE_TERMINAL_NAME];
}
const SHELL_INTEGRATION_WARMUP_COMMAND = 'printf shell-integration-ready';

const PAYLOAD_LINE_COUNT = 19;
const PAYLOAD_LINES = Array.from({ length: PAYLOAD_LINE_COUNT }, (_, i) => {
	const label = `L${String(i + 1).padStart(2, '0')}`;
	return `${label} ${'a'.repeat(51)}`;
});

const MULTILINE_PAYLOAD = PAYLOAD_LINES.join('\n');

const MULTILINE_WC_COMMAND = `echo '${MULTILINE_PAYLOAD}' | wc -c`;
const MULTILINE_WC_EXPECTED_COUNT = String(Buffer.byteLength(`${MULTILINE_PAYLOAD}\n`, 'utf8'));

const LARGE_PAYLOAD_LINE_COUNT = 100;
const LARGE_PAYLOAD_LINES = Array.from({ length: LARGE_PAYLOAD_LINE_COUNT }, (_, i) => {
	const label = `L${String(i + 1).padStart(3, '0')}`;
	return `${label} ${'b'.repeat(51)}`;
});
const LARGE_MULTILINE_PAYLOAD = LARGE_PAYLOAD_LINES.join('\n');
const LARGE_MULTILINE_WC_COMMAND = `echo '${LARGE_MULTILINE_PAYLOAD}' | wc -c`;
const LARGE_MULTILINE_WC_EXPECTED_COUNT = String(Buffer.byteLength(`${LARGE_MULTILINE_PAYLOAD}\n`, 'utf8'));

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

function hasFallbackWarning(textContent: string): boolean {
	return /Shell integration did not activate/.test(textContent);
}

function assertCapturedCount(textContent: string, expectedCount: string): void {
	const capturedExpectedCount = new RegExp(`(^|\\D)${expectedCount}(\\D|$)`).test(textContent);
	if (!capturedExpectedCount) {
		console.error(`Captured textContent:\n${textContent}`);
		assert.fail(`Expected the byte count ${expectedCount} to appear in the captured command output`);
	}
}

async function waitForSharedTerminal(timeoutMs = 5000): Promise<vscode.Terminal | undefined> {
	const names = getExpectedTerminalNames();
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const terminal = vscode.window.terminals.find(candidate => names.includes(candidate.name));
		if (terminal) {
			return terminal;
		}

		await new Promise(resolve => setTimeout(resolve, 50));
	}

	return vscode.window.terminals.find(candidate => names.includes(candidate.name));
}

async function waitForShellIntegration(terminal: vscode.Terminal, timeoutMs = 5000): Promise<boolean> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (terminal.shellIntegration) {
			return true;
		}

		await new Promise(resolve => setTimeout(resolve, 50));
	}

	return terminal.shellIntegration !== undefined;
}

async function probeSharedShellIntegration(client: Client): Promise<{
	warmUpOutput: string;
	terminal: vscode.Terminal | undefined;
	hasShellIntegration: boolean;
}> {
	const warmUpOutput = await runForegroundCommand(
		client,
		SHELL_INTEGRATION_WARMUP_COMMAND,
		'Warm up the shared terminal before multiline repro checks.',
		'Allow shell integration to activate for the shared terminal.'
	);
	assertCommandFinished(warmUpOutput);

	const terminal = await waitForSharedTerminal();
	const hasShellIntegration = terminal ? await waitForShellIntegration(terminal, 15000) : false;

	return {
		warmUpOutput,
		terminal,
		hasShellIntegration,
	};
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
			const usedFallback = hasFallbackWarning(textContent);
			assert.ok(
				capturedOutput || usedFallback,
				'Expected either captured command output or the documented shell integration fallback warning'
			);
		} finally {
			await client.close();
		}
	});

	test('shared foreground terminal activates shell integration before multiline repro checks', async () => {
		const client = await createClient();

		try {
			const probe = await probeSharedShellIntegration(client);
			assert.ok(probe.terminal, `Expected a shared terminal (${getExpectedTerminalNames().join(' or ')}) to be created during warm-up.`);
			assert.ok(
				probe.hasShellIntegration && !hasFallbackWarning(probe.warmUpOutput),
				`Expected shell integration to activate for the shared foreground terminal. Output:\n${probe.warmUpOutput}`
			);
		} finally {
			await client.close();
		}
	});

	test('runInTerminal handles a multiline echo and wc command once shell integration is active', async function () {
		const client = await createClient();

		try {
			const probe = await probeSharedShellIntegration(client);
			if (!probe.terminal || !probe.hasShellIntegration || hasFallbackWarning(probe.warmUpOutput)) {
				this.skip();
			}

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

	test('runInTerminal handles a large multiline echo (100 lines) once shell integration is active', async function () {
		const client = await createClient();

		try {
			const probe = await probeSharedShellIntegration(client);
			if (!probe.terminal || !probe.hasShellIntegration || hasFallbackWarning(probe.warmUpOutput)) {
				this.skip();
			}

			const textContent = await runForegroundCommand(
				client,
				LARGE_MULTILINE_WC_COMMAND,
				'Count the bytes emitted by a large multiline echo payload.',
				'Verify a 100-line multiline command survives end-to-end execution.'
			);
			assertCommandFinished(textContent);
			assertCapturedCount(textContent, LARGE_MULTILINE_WC_EXPECTED_COUNT);
		} finally {
			await client.close();
		}
	});

	test('runInTerminal handles the same single-line command twice through the reused shell once shell integration is active', async function () {
		const client = await createClient();

		try {
			const probe = await probeSharedShellIntegration(client);
			if (!probe.terminal || !probe.hasShellIntegration || hasFallbackWarning(probe.warmUpOutput)) {
				this.skip();
			}

			const singleLineCommand = 'echo single-line-reuse-test | wc -c';
			const expectedCount = String(Buffer.byteLength('single-line-reuse-test\n', 'utf8'));

			const firstRun = await runForegroundCommand(
				client,
				singleLineCommand,
				'Count the bytes emitted by a single-line echo payload.',
				'Verify the first single-line execution in the shared shell.'
			);
			assertCommandFinished(firstRun);
			assertCapturedCount(firstRun, expectedCount);

			const secondRun = await runForegroundCommand(
				client,
				singleLineCommand,
				'Count the bytes emitted by a single-line echo payload.',
				'Verify the second single-line execution in the reused shared shell.'
			);
			assertCommandFinished(secondRun);
			assertCapturedCount(secondRun, expectedCount);
		} finally {
			await client.close();
		}
	});

	test('runInTerminal handles the same multiline command twice through the reused shell once shell integration is active', async function () {
		const client = await createClient();

		try {
			const probe = await probeSharedShellIntegration(client);
			if (!probe.terminal || !probe.hasShellIntegration || hasFallbackWarning(probe.warmUpOutput)) {
				this.skip();
			}

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

	test('large multiline command succeeds when wrapped in bracketed paste mode', async function () {
		const client = await createClient();

		try {
			const probe = await probeSharedShellIntegration(client);
			if (!probe.terminal || !probe.hasShellIntegration || hasFallbackWarning(probe.warmUpOutput)) {
				this.skip();
			}

			const terminal = probe.terminal!;
			let output = '';
			const dataListener = vscode.window.onDidWriteTerminalData(e => {
				if (e.terminal === terminal) {
					output += e.data;
				}
			});

			// Send the large multiline command wrapped in bracketed paste escape sequences
			terminal.sendText(`\x1b[200~${LARGE_MULTILINE_WC_COMMAND}\x1b[201~`);

			// Wait up to 15s for the expected byte count to appear in terminal output
			const deadline = Date.now() + 15000;
			let found = false;
			while (Date.now() < deadline) {
				if (new RegExp(`(^|\\D)${LARGE_MULTILINE_WC_EXPECTED_COUNT}(\\D|$)`).test(output)) {
					found = true;
					break;
				}
				await new Promise(resolve => setTimeout(resolve, 100));
			}

			dataListener.dispose();

			assert.ok(found, `Expected the byte count ${LARGE_MULTILINE_WC_EXPECTED_COUNT} to appear in the terminal output. Got:\n${output.slice(-500)}`);
		} finally {
			await client.close();
		}
	});

	test('two large multiline commands succeed when wrapped in bracketed paste mode', async function () {
		const client = await createClient();

		try {
			const probe = await probeSharedShellIntegration(client);
			if (!probe.terminal || !probe.hasShellIntegration || hasFallbackWarning(probe.warmUpOutput)) {
				this.skip();
			}

			const terminal = probe.terminal!;

			for (const run of ['first', 'second']) {
				let output = '';
				const dataListener = vscode.window.onDidWriteTerminalData(e => {
					if (e.terminal === terminal) {
						output += e.data;
					}
				});

				terminal.sendText(`\x1b[200~${LARGE_MULTILINE_WC_COMMAND}\x1b[201~`);

				const deadline = Date.now() + 15000;
				let found = false;
				while (Date.now() < deadline) {
					if (new RegExp(`(^|\\D)${LARGE_MULTILINE_WC_EXPECTED_COUNT}(\\D|$)`).test(output)) {
						found = true;
						break;
					}
					await new Promise(resolve => setTimeout(resolve, 100));
				}

				dataListener.dispose();

				assert.ok(found, `Expected the byte count ${LARGE_MULTILINE_WC_EXPECTED_COUNT} on the ${run} run. Got:\n${output.slice(-500)}`);
			}
		} finally {
			await client.close();
		}
	});

	test('bracketed paste mode stress test — increasing payload sizes', async function () {
		this.timeout(120000);
		const client = await createClient();

		try {
			const probe = await probeSharedShellIntegration(client);
			if (!probe.terminal || !probe.hasShellIntegration || hasFallbackWarning(probe.warmUpOutput)) {
				this.skip();
			}

			const terminal = probe.terminal!;
			const lineCounts = [100, 500, 1000, 2000, 5000];
			const results: { lines: number; bytes: number; passed: boolean; timeMs: number }[] = [];

			for (const lineCount of lineCounts) {
				const lines = Array.from({ length: lineCount }, (_, i) =>
					`L${String(i + 1).padStart(4, '0')} ${'x'.repeat(51)}`
				);
				const payload = lines.join('\n');
				const command = `echo '${payload}' | wc -c`;
				const expectedCount = String(Buffer.byteLength(`${payload}\n`, 'utf8'));
				const totalBytes = Buffer.byteLength(command, 'utf8');

				let output = '';
				const dataListener = vscode.window.onDidWriteTerminalData(e => {
					if (e.terminal === terminal) {
						output += e.data;
					}
				});

				const startTime = Date.now();
				terminal.sendText(`\x1b[200~${command}\x1b[201~`);

				const deadline = Date.now() + 30000;
				let found = false;
				while (Date.now() < deadline) {
					if (new RegExp(`(^|\\D)${expectedCount}(\\D|$)`).test(output)) {
						found = true;
						break;
					}
					await new Promise(resolve => setTimeout(resolve, 100));
				}
				const elapsed = Date.now() - startTime;

				dataListener.dispose();
				results.push({ lines: lineCount, bytes: totalBytes, passed: found, timeMs: elapsed });

				console.log(`Bracketed paste: ${lineCount} lines (${totalBytes} bytes) — ${found ? 'PASS' : 'FAIL'} in ${elapsed}ms`);

				if (!found) {
					break; // stop at first failure to avoid wasting time
				}
			}

			const summary = results.map(r =>
				`${r.lines} lines (${r.bytes} bytes): ${r.passed ? 'PASS' : 'FAIL'} (${r.timeMs}ms)`
			).join('\n');

			const allPassed = results.every(r => r.passed);
			assert.ok(allPassed, `Bracketed paste stress test results:\n${summary}`);
		} finally {
			await client.close();
		}
	});

	test.skip('runInTerminal activates shell integration with a custom Copilot Zsh terminal profile', async function () {
		const client = await createClient();

		try {
			await vscode.workspace.getConfiguration().update('chat.tools.terminal.terminalProfile.osx', {
				title: 'Copilot Zsh',
				path: '/bin/zsh',
				icon: 'robot'
			}, vscode.ConfigurationTarget.Workspace);

			const probe = await probeSharedShellIntegration(client);
			assert.ok(probe.terminal, `Expected a terminal named ${CUSTOM_PROFILE_TERMINAL_NAME} to be created during warm-up. Found: ${vscode.window.terminals.map(t => t.name).join(', ')}`);
			assert.ok(
				probe.hasShellIntegration && !hasFallbackWarning(probe.warmUpOutput),
				`Expected shell integration to activate for the custom profile terminal. Output:\n${probe.warmUpOutput}`
			);
		} finally {
			await vscode.workspace.getConfiguration().update('chat.tools.terminal.terminalProfile.osx', undefined, vscode.ConfigurationTarget.Workspace);
			await client.close();
		}
	});
});