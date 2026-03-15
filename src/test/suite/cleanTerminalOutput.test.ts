import * as assert from 'node:assert/strict';
import { cleanTerminalOutput } from '../../terminalSessionManager';

suite('cleanTerminalOutput', () => {
	test('extracts output between 633;C and 633;D markers', () => {
		const raw = 'prompt stuff]633;C    1064\n]633;D;0more stuff';
		const result = cleanTerminalOutput(raw);
		assert.strictEqual(result, '1064');
	});

	test('uses the last 633;C...633;D block when multiple exist', () => {
		const raw = ']633;Cfirst output]633;D]633;Csecond output]633;D';
		const result = cleanTerminalOutput(raw);
		assert.strictEqual(result, 'second output');
	});

	test('strips OSC sequences with ESC prefix', () => {
		const raw = 'hello\x1b]633;P;Cwd=/path\x07world';
		const result = cleanTerminalOutput(raw);
		assert.strictEqual(result, 'helloworld');
	});

	test('strips CSI sequences (ANSI escape codes)', () => {
		const raw = '\x1b[1m\x1b[31mhello\x1b[0m world';
		const result = cleanTerminalOutput(raw);
		assert.strictEqual(result, 'hello world');
	});

	test('strips CSI sequences without ESC prefix', () => {
		const raw = '[1m[31mhello[0m world';
		const result = cleanTerminalOutput(raw);
		assert.strictEqual(result, 'hello world');
	});

	test('strips bracketed paste markers', () => {
		const raw = '[?2004hsome text[?2004l';
		const result = cleanTerminalOutput(raw);
		assert.strictEqual(result, 'some text');
	});

	test('strips zsh percent marker at end of line', () => {
		const raw = 'output%   \nmore';
		const result = cleanTerminalOutput(raw);
		assert.strictEqual(result, 'output\nmore');
	});

	test('removes lines that are just whitespace', () => {
		const raw = 'line1\n   \nline2';
		const result = cleanTerminalOutput(raw);
		assert.strictEqual(result, 'line1\nline2');
	});

	test('collapses multiple blank lines', () => {
		const raw = 'line1\n\n\n\nline2';
		const result = cleanTerminalOutput(raw);
		assert.strictEqual(result, 'line1\nline2');
	});

	test('trims leading and trailing whitespace', () => {
		const raw = '  \n  hello world  \n  ';
		const result = cleanTerminalOutput(raw);
		assert.strictEqual(result, 'hello world');
	});

	test('handles real multiline wc -c output', () => {
		// Simplified version of real captured output
		const raw = `]633;P;ContinuationPrompt=%_> ]633;P;HasRichCommandDetection=Trueecho 'L01 aaa
L02 bbb
L19 ccc[1m[7m%[27m[1m[0m
]633;D]633;P;Cwd=/path]633;A@host % ]633;Beecho 'L01 aaa
]633;Fquote> ]633;GLL02 bbb
]633;E;echo ...;nonce]633;C    1064
[1m[7m%[27m[1m[0m
]633;D;0]633;P;Cwd=/path]633;A@host % ]633;B`;
		const result = cleanTerminalOutput(raw);
		assert.strictEqual(result, '1064');
	});

	test('handles output without OSC 633 markers', () => {
		const raw = 'simple output\nwith newlines';
		const result = cleanTerminalOutput(raw);
		assert.strictEqual(result, 'simple output\nwith newlines');
	});

	test('handles git commit output', () => {
		const raw = `]633;C[main abc1234] Fix something
 1 file changed, 2 insertions(+)
]633;D;0`;
		const result = cleanTerminalOutput(raw);
		assert.strictEqual(result, '[main abc1234] Fix something\n1 file changed, 2 insertions(+)');
	});
});
