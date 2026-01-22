# Claude Pro Autonomous VS Code Extension

Use your Claude Pro subscription for autonomous coding tasks in VS Code - no API keys needed!

## Features

- ✅ Uses your Claude Pro OAuth credentials (no pay-per-token!)
- ✅ Runs autonomously without constant approval prompts
- ✅ Integrates with GitHub CLI for repo operations
- ✅ Works on GitHub issues automatically
- ✅ Makes code changes, commits, and creates PRs

## Prerequisites

1. **Claude Pro subscription** ($20/month)
2. **Claude Code CLI** installed and logged in:
   ```bash
   npm install -g @anthropic-ai/claude-code
   claude /login
   ```
3. **GitHub CLI** (for GitHub integration):
   ```bash
   # macOS
   brew install gh
   
   # Login
   gh auth login
   ```

## Installation

1. **Clone or download this extension:**
   ```bash
   mkdir claude-pro-extension
   cd claude-pro-extension
   # Copy the files from the artifact
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Compile the extension:**
   ```bash
   npm run compile
   ```

4. **Open in VS Code and press F5** to run the extension in a new window

   OR

5. **Package and install:**
   ```bash
   npm install -g vsce
   vsce package
   code --install-extension claude-pro-extension-0.1.0.vsix
   ```

## Usage

### Run a Task

1. Open Command Palette (Cmd/Ctrl + Shift + P)
2. Type "Claude: Run Task"
3. Enter your task (e.g., "Add error handling to the login function")
4. Claude will autonomously complete the task!

### Work on GitHub Issue

1. Make sure you're in a GitHub repo
2. Open Command Palette
3. Type "Claude: Work on GitHub Issue"
4. Enter the issue number
5. Claude will fetch the issue and complete it autonomously

## How It Works

1. **Reads your Claude Pro OAuth credentials:**
   - macOS: From Keychain (`Claude Code-credentials`)
   - Linux: From `~/.claude/.credentials.json`

2. **Calls Claude API using your Pro subscription tokens**
   - Uses the same auth as Claude Code CLI
   - Flat $20/month rate, no per-token charges

3. **Executes autonomously:**
   - No approval prompts for each action
   - Makes all changes and commits automatically
   - Integrates with GitHub CLI for repo operations

## Configuration

The extension works out-of-the-box, but you can customize behavior by modifying the code:

- **Model**: Change `claude-sonnet-4-20250514` to another model
- **Max tokens**: Adjust the `maxTokens` parameter
- **Auto-commit**: Enable/disable automatic git commits

## Troubleshooting

### "Claude credentials not found"
- Make sure you've run `claude /login` in your terminal
- Verify credentials exist:
  - macOS: `security find-generic-password -s "Claude Code-credentials" -w`
  - Linux: `cat ~/.claude/.credentials.json`

### "Token expired"
- Run `claude /login` again to refresh your OAuth tokens

### "gh not found"
- Install GitHub CLI: `brew install gh` or visit https://cli.github.com
- Run `gh auth login`

## Security Notes

- Your OAuth credentials never leave your machine
- All API calls go directly to Anthropic's servers
- Same security as Claude Code CLI
- Credentials stored in OS keychain (macOS) or secured file (Linux)

## Limitations

- Requires Claude Pro subscription
- GitHub CLI must be installed for repo operations
- Token refresh not yet implemented (need to re-login periodically)
- Credentials from Claude Code CLI (doesn't create its own OAuth flow)

## Future Improvements

- [ ] Implement proper OAuth token refresh
- [ ] Add configuration UI
- [ ] Support for more git operations
- [ ] Better error handling and recovery
- [ ] Streaming responses for real-time feedback
- [ ] Support for other AI models via API switcher

## License

MIT

## Disclaimer

This extension uses your Claude Pro subscription and makes API calls on your behalf. Use responsibly and be aware of any usage limits in your subscription tier.
