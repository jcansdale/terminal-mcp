import * as path from 'node:path';
import { runTests } from '@vscode/test-electron';

async function main(): Promise<void> {
	const extensionDevelopmentPath = path.resolve(__dirname, '../..');
	const extensionTestsPath = path.resolve(__dirname, './suite/index.js');

	await runTests({
		version: 'insiders',
		extensionDevelopmentPath,
		extensionTestsPath,
		launchArgs: [extensionDevelopmentPath, '--disable-extensions', '--enable-proposed-api=jcansdale.terminal-mcp'],
	});
}

void main().catch(error => {
	console.error('Failed to run extension tests', error);
	process.exitCode = 1;
});