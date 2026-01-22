"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __addDisposableResource = (this && this.__addDisposableResource) || function (env, value, async) {
    if (value !== null && value !== void 0) {
        if (typeof value !== "object" && typeof value !== "function") throw new TypeError("Object expected.");
        var dispose, inner;
        if (async) {
            if (!Symbol.asyncDispose) throw new TypeError("Symbol.asyncDispose is not defined.");
            dispose = value[Symbol.asyncDispose];
        }
        if (dispose === void 0) {
            if (!Symbol.dispose) throw new TypeError("Symbol.dispose is not defined.");
            dispose = value[Symbol.dispose];
            if (async) inner = dispose;
        }
        if (typeof dispose !== "function") throw new TypeError("Object not disposable.");
        if (inner) dispose = function() { try { inner.call(this); } catch (e) { return Promise.reject(e); } };
        env.stack.push({ value: value, dispose: dispose, async: async });
    }
    else if (async) {
        env.stack.push({ async: true });
    }
    return value;
};
var __disposeResources = (this && this.__disposeResources) || (function (SuppressedError) {
    return function (env) {
        function fail(e) {
            env.error = env.hasError ? new SuppressedError(e, env.error, "An error was suppressed during disposal.") : e;
            env.hasError = true;
        }
        var r, s = 0;
        function next() {
            while (r = env.stack.pop()) {
                try {
                    if (!r.async && s === 1) return s = 0, env.stack.push(r), Promise.resolve().then(next);
                    if (r.dispose) {
                        var result = r.dispose.call(r.value);
                        if (r.async) return s |= 2, Promise.resolve(result).then(next, function(e) { fail(e); return next(); });
                    }
                    else s |= 1;
                }
                catch (e) {
                    fail(e);
                }
            }
            if (s === 1) return env.hasError ? Promise.reject(env.error) : Promise.resolve();
            if (env.hasError) throw env.error;
        }
        return next();
    };
})(typeof SuppressedError === "function" ? SuppressedError : function (error, suppressed, message) {
    var e = new Error(message);
    return e.name = "SuppressedError", e.error = error, e.suppressed = suppressed, e;
});
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
// ====================
// package.json
// ====================
{
    "name";
    "claude-pro-extension",
        "displayName";
    "Claude Pro Autonomous Agent",
        "description";
    "Use your Claude Pro subscription for autonomous coding tasks",
        "version";
    "0.1.0",
        "engines";
    {
        "vscode";
        "^1.85.0";
    }
    "categories";
    ["Other"],
        "activationEvents";
    ["onCommand:claudepro.runTask", "onCommand:claudepro.workOnIssue"],
        "main";
    "./out/extension.js",
        "contributes";
    {
        "commands";
        [
            {
                "command": "claudepro.runTask",
                "title": "Claude: Run Task"
            },
            {
                "command": "claudepro.workOnIssue",
                "title": "Claude: Work on GitHub Issue"
            }
        ];
    }
    "scripts";
    {
        "vscode:prepublish";
        "npm run compile",
            "compile";
        "tsc -p ./",
            "watch";
        "tsc -watch -p ./";
    }
    "devDependencies";
    {
        "@types/node";
        "^20.0.0",
            "@types/vscode";
        "^1.85.0",
            "typescript";
        "^5.3.0";
    }
}
// ====================
// tsconfig.json
// ====================
{
    "compilerOptions";
    {
        "module";
        "commonjs",
            "target";
        "ES2020",
            "outDir";
        "out",
            "lib";
        ["ES2020"],
            "sourceMap";
        true,
            "rootDir";
        "src",
            "strict";
        true,
            "esModuleInterop";
        true;
    }
    "exclude";
    ["node_modules", ".vscode-test"];
}
// ====================
// extension.ts - Main extension file
// ====================
const vscode = __importStar(require("vscode"));
const os = __importStar(require("os"));
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const child_process_1 = require("child_process");
const util_1 = require("util");
const execAsync = (0, util_1.promisify)(child_process_1.exec);
class ClaudeProClient {
    constructor() {
        this.credentials = null;
        this.apiEndpoint = 'https://api.anthropic.com/v1/messages';
    }
    async loadCredentials() {
        try {
            const platform = os.platform();
            if (platform === 'darwin') {
                // macOS - read from Keychain
                const { stdout } = await execAsync('security find-generic-password -s "Claude Code-credentials" -w');
                this.credentials = JSON.parse(stdout.trim());
                return true;
            }
            else {
                // Linux/Windows - read from file
                const credPath = path.join(os.homedir(), '.claude', '.credentials.json');
                if (fs.existsSync(credPath)) {
                    const data = fs.readFileSync(credPath, 'utf8');
                    this.credentials = JSON.parse(data);
                    return true;
                }
            }
            return false;
        }
        catch (error) {
            console.error('Failed to load credentials:', error);
            return false;
        }
    }
    async callClaude(prompt, maxTokens = 4096) {
        if (!this.credentials) {
            throw new Error('Not authenticated. Please run Claude Code /login first.');
        }
        // Check if token expired, refresh if needed
        if (Date.now() >= this.credentials.claudeAiOauth.expiresAt) {
            await this.refreshToken();
        }
        const response = await fetch(this.apiEndpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.credentials.claudeAiOauth.accessToken}`,
                'anthropic-version': '2023-06-01'
            },
            body: JSON.stringify({
                model: 'claude-sonnet-4-20250514',
                max_tokens: maxTokens,
                messages: [
                    { role: 'user', content: prompt }
                ]
            })
        });
        if (!response.ok) {
            const error = await response.text();
            throw new Error(`Claude API error: ${error}`);
        }
        const data = await response.json();
        return data.content[0].text;
    }
    async refreshToken() {
        // Token refresh logic - would need to implement Anthropic's OAuth refresh flow
        // For now, throw error and user needs to re-login
        throw new Error('Token expired. Please run Claude Code /login again.');
    }
}
class ClaudeTaskManager {
    constructor(client, outputChannel) {
        this.client = client;
        this.outputChannel = outputChannel;
        this.ghClient = new GitHubClient(outputChannel);
    }
    async executeTask(task) {
        this.outputChannel.appendLine(`\n🤖 Starting task: ${task}`);
        this.outputChannel.show();
        try {
            // Get workspace context
            const workspace = vscode.workspace.workspaceFolders?.[0];
            if (!workspace) {
                throw new Error('No workspace folder open');
            }
            // Build context for Claude
            const context = await this.buildContext(workspace, task);
            // Create the prompt
            const prompt = `You are an autonomous coding assistant. Complete this task without asking for approval at each step.

Task: ${task}

Context:
${context}

Instructions:
1. Analyze the task and workspace
2. Make all necessary code changes
3. Use GitHub CLI commands when needed
4. Return a JSON response with your actions

Response format:
{
  "actions": [
    {"type": "file_write", "path": "...", "content": "..."},
    {"type": "file_delete", "path": "..."},
    {"type": "command", "cmd": "..."}
  ],
  "summary": "What you did"
}`;
            // Call Claude
            this.outputChannel.appendLine('🧠 Thinking...');
            const response = await this.client.callClaude(prompt, 8000);
            // Parse and execute actions
            const result = this.parseResponse(response);
            await this.executeActions(result.actions, workspace.uri.fsPath);
            this.outputChannel.appendLine(`\n✅ Task completed: ${result.summary}`);
        }
        catch (error) {
            this.outputChannel.appendLine(`\n❌ Error: ${error}`);
            throw error;
        }
    }
    async buildContext(workspace, task) {
        const context = [];
        // Get relevant files based on task
        const files = await vscode.workspace.findFiles('**/*.{ts,js,py,java,go}', '**/node_modules/**', 20);
        context.push('Files in workspace:');
        for (const file of files) {
            const relativePath = vscode.workspace.asRelativePath(file);
            context.push(`- ${relativePath}`);
        }
        // Get git status if available
        const gitStatus = await this.ghClient.getStatus(workspace.uri.fsPath);
        if (gitStatus) {
            context.push('\nGit status:');
            context.push(gitStatus);
        }
        return context.join('\n');
    }
    parseResponse(response) {
        // Extract JSON from response (Claude might wrap it in markdown)
        const jsonMatch = response.match(/```json\s*([\s\S]*?)\s*```/) ||
            response.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
            throw new Error('Could not parse Claude response');
        }
        return JSON.parse(jsonMatch[1] || jsonMatch[0]);
    }
    async executeActions(actions, workspacePath) {
        for (const action of actions) {
            this.outputChannel.appendLine(`\n▶️  Executing: ${action.type}`);
            switch (action.type) {
                case 'file_write':
                    await this.writeFile(workspacePath, action.path, action.content);
                    break;
                case 'file_delete':
                    await this.deleteFile(workspacePath, action.path);
                    break;
                case 'command':
                    await this.runCommand(workspacePath, action.cmd);
                    break;
                default:
                    this.outputChannel.appendLine(`⚠️  Unknown action type: ${action.type}`);
            }
        }
    }
    async writeFile(workspacePath, filePath, content) {
        const fullPath = path.join(workspacePath, filePath);
        const dir = path.dirname(fullPath);
        // Create directory if it doesn't exist
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(fullPath, content, 'utf8');
        this.outputChannel.appendLine(`   📝 Wrote: ${filePath}`);
    }
    async deleteFile(workspacePath, filePath) {
        const fullPath = path.join(workspacePath, filePath);
        if (fs.existsSync(fullPath)) {
            fs.unlinkSync(fullPath);
            this.outputChannel.appendLine(`   🗑️  Deleted: ${filePath}`);
        }
    }
    async runCommand(workspacePath, cmd) {
        try {
            const { stdout, stderr } = await execAsync(cmd, { cwd: workspacePath });
            this.outputChannel.appendLine(`   💻 Command: ${cmd}`);
            if (stdout)
                this.outputChannel.appendLine(`   Output: ${stdout.trim()}`);
            if (stderr)
                this.outputChannel.appendLine(`   Stderr: ${stderr.trim()}`);
        }
        catch (error) {
            this.outputChannel.appendLine(`   ❌ Command failed: ${error.message}`);
            throw error;
        }
    }
}
class GitHubClient {
    constructor(outputChannel) {
        this.outputChannel = outputChannel;
    }
    async getStatus(workspacePath) {
        try {
            const { stdout } = await execAsync('gh auth status && git status', { cwd: workspacePath });
            return stdout.trim();
        }
        catch {
            return null;
        }
    }
    async createPR(workspacePath, title, body) {
        const cmd = `gh pr create --title "${title}" --body "${body}"`;
        await execAsync(cmd, { cwd: workspacePath });
        this.outputChannel.appendLine(`   ✅ Created PR: ${title}`);
    }
    async checkoutBranch(workspacePath, branch) {
        await execAsync(`git checkout -b ${branch}`, { cwd: workspacePath });
        this.outputChannel.appendLine(`   🌿 Created branch: ${branch}`);
    }
    async commit(workspacePath, message) {
        await execAsync(`git add . && git commit -m "${message}"`, { cwd: workspacePath });
        this.outputChannel.appendLine(`   💾 Committed: ${message}`);
    }
    async push(workspacePath) {
        await execAsync('git push', { cwd: workspacePath });
        this.outputChannel.appendLine(`   ⬆️  Pushed to remote`);
    }
}
function activate(context) {
    const outputChannel = vscode.window.createOutputChannel('Claude Pro');
    const client = new ClaudeProClient();
    const taskManager = new ClaudeTaskManager(client, outputChannel);
    // Register command: Claude: Run Task
    const runTaskCommand = vscode.commands.registerCommand('claudepro.runTask', async () => {
        // Load credentials first
        const loaded = await client.loadCredentials();
        if (!loaded) {
            vscode.window.showErrorMessage('Claude credentials not found. Please run "claude /login" in your terminal first.');
            return;
        }
        // Get task from user
        const task = await vscode.window.showInputBox({
            prompt: 'What task should Claude complete?',
            placeHolder: 'e.g., Add error handling to the login function'
        });
        if (!task)
            return;
        try {
            await taskManager.executeTask(task);
            vscode.window.showInformationMessage('✅ Task completed!');
        }
        catch (error) {
            vscode.window.showErrorMessage(`❌ Task failed: ${error.message}`);
        }
    });
    // Register command: Claude: Work on GitHub Issue
    const workOnIssueCommand = vscode.commands.registerCommand('claudepro.workOnIssue', async () => {
        const loaded = await client.loadCredentials();
        if (!loaded) {
            vscode.window.showErrorMessage('Claude credentials not found. Please run "claude /login" in your terminal first.');
            return;
        }
        const issueNumber = await vscode.window.showInputBox({
            prompt: 'Enter GitHub issue number',
            placeHolder: 'e.g., 123'
        });
        if (!issueNumber)
            return;
        // Get issue details using gh CLI
        const workspace = vscode.workspace.workspaceFolders?.[0];
        if (!workspace) {
            vscode.window.showErrorMessage('No workspace folder open');
            return;
        }
        try {
            const { stdout } = await execAsync(`gh issue view ${issueNumber} --json title,body`, {
                cwd: workspace.uri.fsPath
            });
            const issue = JSON.parse(stdout);
            const task = `Work on GitHub issue #${issueNumber}: ${issue.title}\n\nDescription:\n${issue.body}`;
            await taskManager.executeTask(task);
            vscode.window.showInformationMessage('✅ Issue work completed!');
        }
        catch (error) {
            vscode.window.showErrorMessage(`❌ Failed: ${error.message}`);
        }
    });
    context.subscriptions.push(runTaskCommand, workOnIssueCommand, outputChannel);
}
function deactivate() { }
// ====================
// README.md
// ====================
#;
Claude;
Pro;
Autonomous;
VS;
Code;
Extension;
Use;
your;
Claude;
Pro;
subscription;
for (autonomous; coding; tasks in VS)
    Code - no;
API;
keys;
needed;
#;
#;
Features
    - ;
Uses;
your;
Claude;
Pro;
OAuth;
credentials(no, pay - per - token)
    - ;
Runs;
autonomously;
without;
constant;
approval;
prompts
    - ;
Integrates;
with (GitHub)
    CLI;
for (repo; operations
    - ; )
    ;
Works;
on;
GitHub;
issues;
automatically
    - ;
Makes;
code;
changes, commits, and;
creates;
PRs;
#;
#;
Prerequisites;
1. ** Claude;
Pro;
subscription ** ($20 / month);
2. ** Claude;
Code;
CLI ** installed;
and;
logged in ;
`` `bash
   npm install -g @anthropic-ai/claude-code
   claude /login
   ` ``;
3. ** GitHub;
CLI ** ();
for (GitHub; integration;)
    : `` `bash
   # macOS
   brew install gh
   
   # Login
   gh auth login
   ` ``;
#;
#;
Installation;
1. ** Clone;
or;
download;
this;
extension:  **
    `` `bash
   mkdir claude-pro-extension
   cd claude-pro-extension
   # Copy the files from the artifact
   ` ``;
2. ** Install;
dependencies:  **
    `` `bash
   npm install
   ` ``;
3. ** Compile;
the;
extension:  **
    `` `bash
   npm run compile
   ` ``;
4. ** Open in VS;
Code;
and;
press;
F5 ** to;
run;
the;
extension in a;
new window;
OR;
5. ** Package;
and;
install:  **
    `` `bash
   npm install -g vsce
   vsce package
   code --install-extension claude-pro-extension-0.1.0.vsix
   ` ``;
#;
#;
Usage;
#;
#;
#;
Run;
a;
Task;
1.;
Open;
Command;
Palette(Cmd / Ctrl + Shift + P);
2.;
Type;
"Claude: Run Task";
3.;
Enter;
your;
task(e.g., "Add error handling to the login function");
4.;
Claude;
will;
autonomously;
complete;
the;
task;
#;
#;
#;
Work;
on;
GitHub;
Issue;
1.;
Make;
sure;
you;
're in a GitHub repo;
2.;
Open;
Command;
Palette;
3.;
Type;
"Claude: Work on GitHub Issue";
4.;
Enter;
the;
issue;
number;
5.;
Claude;
will;
fetch;
the;
issue;
and;
complete;
it;
autonomously;
#;
#;
How;
It;
Works;
1. ** Reads;
your;
Claude;
Pro;
OAuth;
credentials:  **
    -macOS;
From;
Keychain(`Claude Code-credentials`)
    - Linux;
From `~/.claude/.credentials.json`;
2. ** Calls;
Claude;
API;
var your, Pro, subscription, tokens;
const env_1 = { stack: [], error: void 0, hasError: false };
try {
    your = __addDisposableResource(env_1, void 0, false), Pro = __addDisposableResource(env_1, void 0, false), subscription = __addDisposableResource(env_1, void 0, false), tokens = __addDisposableResource(env_1, void 0, false);
     **
        -Uses;
    the;
    same;
    auth;
    Code;
    CLI
        - Flat;
    $20 / month;
    rate, no;
    per - token;
    charges;
    3. ** Executes;
    autonomously:  **
        -No;
    approval;
    prompts;
    for (each; action
        - Makes; all)
        changes;
    and;
    commits;
    automatically
        - Integrates;
    with (GitHub)
        CLI;
    for (repo; operations; #)
        #;
    Configuration;
    The;
    extension;
    works;
    out - of - the - box, but;
    you;
    can;
    customize;
    behavior;
    by;
    modifying;
    the;
    code: - ** Model ** ;
    Change `claude-sonnet-4-20250514`;
    to;
    another;
    model
        -  ** Max;
    tokens ** ;
    Adjust;
    the `maxTokens`;
    parameter
        -  ** Auto - commit ** ;
    Enable / disable;
    automatic;
    git;
    commits;
    #;
    #;
    Troubleshooting;
    #;
    #;
    #;
    "Claude credentials not found"
        - Make;
    sure;
    you;
    've run `claude /login` in your terminal
        - Verify;
    credentials;
    exist: -macOS;
    `security find-generic-password -s "Claude Code-credentials" -w`
        - Linux;
    `cat ~/.claude/.credentials.json`;
    #;
    #;
    #;
    "Token expired"
        - Run `claude /login`;
    again;
    to;
    refresh;
    your;
    OAuth;
    tokens;
    #;
    #;
    #;
    "gh not found"
        - Install;
    GitHub;
    CLI: `brew install gh`;
    or;
    visit;
    https: //cli.github.com
     -Run `gh auth login`;
    #;
    #;
    Security;
    Notes
        - Your;
    OAuth;
    credentials;
    never;
    leave;
    your;
    machine
        - All;
    API;
    calls;
    go;
    directly;
    to;
    Anthropic;
    's servers
        - Same;
    security;
    Code;
    CLI
        - Credentials;
    stored in OS;
    keychain(macOS);
    or;
    secured;
    file(Linux);
    #;
    #;
    Limitations
        - Requires;
    Claude;
    Pro;
    subscription
        - GitHub;
    CLI;
    must;
    be;
    installed;
    for (repo; operations
        - Token; refresh)
        not;
    yet;
    implemented(need, to, re - login, periodically)
        - Credentials;
    from;
    Claude;
    Code;
    CLI(doesn, 't create its own OAuth flow), , , Future, Improvements
        - [], Implement, proper, OAuth, token, refresh
        - [], Add, configuration, UI
        - [], Support);
    for (more; git; operations
        - [])
        Better;
    error;
    handling;
    and;
    recovery
        - [];
    Streaming;
    responses;
    for (real - time; feedback
        - []; Support)
        for (other; AI; models)
            via;
    API;
    switcher;
    #;
    #;
    License;
    MIT;
    #;
    #;
    Disclaimer;
    This;
    extension;
    uses;
    your;
    Claude;
    Pro;
    subscription;
    and;
    makes;
    API;
    calls;
    on;
    your;
    behalf.Use;
    responsibly;
    and;
    be;
    aware;
    of;
    any;
    usage;
    limits in your;
    subscription;
    tier.;
}
catch (e_1) {
    env_1.error = e_1;
    env_1.hasError = true;
}
finally {
    __disposeResources(env_1);
}
//# sourceMappingURL=extension.js.map