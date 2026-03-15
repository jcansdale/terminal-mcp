import esbuild from 'esbuild';

const watch = process.argv.includes('--watch');

const context = await esbuild.context({
	entryPoints: ['src/extension.ts', 'src/test/runTest.ts', 'src/test/suite/index.ts', 'src/test/suite/terminalMcp.integrationTest.ts', 'src/test/suite/cleanTerminalOutput.test.ts'],
	outbase: 'src',
	bundle: true,
	format: 'cjs',
	platform: 'node',
	target: 'node20',
	outdir: 'dist',
	entryNames: '[dir]/[name]',
	external: ['vscode', 'mocha'],
	sourcemap: true,
	logLevel: 'info',
});

if (watch) {
	await context.watch();
} else {
	await context.rebuild();
	await context.dispose();
}