# Terminal MCP

VS Code extension for experimenting with a terminal-focused MCP server implementation.

This project exposes terminal-oriented MCP tools from a local extension-hosted HTTP server so you can iterate on behavior outside VS Code's built-in implementation.

## Status

- Intended for local development and GitHub-hosted experimentation.
- Uses proposed VS Code APIs, so it currently needs VS Code Insiders plus `--enable-proposed-api=jcansdale.terminal-mcp`.
- `package.json` remains marked `private` to avoid accidental npm publication.

## What it exposes

- `runInTerminal`
- `awaitTerminal`
- `getTerminalOutput`
- `killTerminal`

The tool contracts are intentionally close to VS Code's built-in terminal tools, but the implementation uses the public extension API plus the proposed `terminalDataWriteEvent` API for output capture.

## Terminal profile selection

When creating terminals, the extension checks the same chat-specific terminal profile settings used by VS Code's built-in terminal tools:

- `chat.tools.terminal.terminalProfile.osx`
- `chat.tools.terminal.terminalProfile.linux`
- `chat.tools.terminal.terminalProfile.windows`

If the platform-specific chat setting is present and contains a valid profile object with a `path`, the extension applies the supported subset through the public terminal API:

- `path`
- `args`
- `env`
- `icon`
- `color`

Example macOS configuration:

```json
{
	"chat.tools.terminal.terminalProfile.osx": {
		"title": "Copilot Bash",
		"path": "/bin/bash",
		"args": ["--noprofile", "--norc"],
		"icon": "robot",
		"env": {
			"BASH_SILENCE_DEPRECATION_WARNING": "1"
		}
	}
}
```

In the current extension implementation, `title`, `path`, `args`, `icon`, and `env` from this example are honored. The shared terminal uses the configured `title`, and background terminals use `<title>: <goal>`.

If the chat-specific setting is not configured, the extension falls back to the window's normal default integrated terminal profile.

## VS Code's built-in terminal tools

The built-in terminal tools are implemented directly in VS Code (not as an MCP server):

- **Location:** [`src/vs/workbench/contrib/terminalContrib/chatAgentTools/browser/tools/`](https://github.com/microsoft/vscode/tree/main/src/vs/workbench/contrib/terminalContrib/chatAgentTools/browser/tools)
- **Tool IDs:** `run_in_terminal`, `await_terminal`, `get_terminal_output`, `kill_terminal`, `terminal_selection`, `terminal_last_command`, `create_and_run_task`, `get_task_output`, `run_task`

These tools are registered with VS Code's internal `ILanguageModelToolsService` and have direct access to services like `ITerminalService` and `IChatService`.

## Notes

- This extension is intended for self-hosting or VS Code Insiders-style experimentation.
- It uses `contributes.mcpServerDefinitionProviders` and registers a local HTTP MCP server from the extension host.
- It relies on shell integration for the best `awaitTerminal` and exit-code behavior.
- It does not have full parity with VS Code's internal terminal tool implementation; it approximates that behavior using the public extension API.

## Development

```bash
npm install
npm run check
npm run build
npm test
```

Useful commands after loading the extension:

- `Terminal MCP: Show Server URL`
- `Terminal MCP: Restart Server`