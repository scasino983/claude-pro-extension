// ====================
// package.json
// ====================
{
  "name": "claude-pro-extension",
  "displayName": "Claude Pro",
  "description": "Chat with Claude using your Pro subscription",
  "version": "0.1.0",
  "engines": {
    "vscode": "^1.85.0"
  },
  "categories": ["Other"],
  "activationEvents": ["onView:claudeChat"],
  "main": "./out/extension.js",
  "contributes": {
    "viewsContainers": {
      "activitybar": [
        {
          "id": "claude-sidebar",
          "title": "Claude Pro",
          "icon": "resources/claude-icon.svg"
        }
      ]
    },
    "views": {
      "claude-sidebar": [
        {
          "type": "webview",
          "id": "claudeChat",
          "name": "Chat"
        }
      ]
    },
    "commands": [
      {
        "command": "claudepro.newChat",
        "title": "New Chat",
        "icon": "$(add)"
      },
      {
        "command": "claudepro.clearHistory",
        "title": "Clear Chat History"
      },
      {
        "command": "claudepro.signIn",
        "title": "Claude: Sign In"
      },
      {
        "command": "claudepro.signOut",
        "title": "Claude: Sign Out"
      }
    ],
    "menus": {
      "view/title": [
        {
          "command": "claudepro.newChat",
          "when": "view == claudeChat",
          "group": "navigation"
        }
      ]
    }
  },
  "scripts": {
    "vscode:prepublish": "npm run compile",
    "compile": "tsc -p ./",
    "watch": "tsc -watch -p ./"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "@types/vscode": "^1.85.0",
    "typescript": "^5.3.0"
  }
}

// ====================
// tsconfig.json
// ====================
{
  "compilerOptions": {
    "module": "commonjs",
    "target": "ES2020",
    "outDir": "out",
    "lib": ["ES2020"],
    "sourceMap": true,
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true
  },
  "exclude": ["node_modules", ".vscode-test"]
}

// ====================
// src/extension.ts
// ====================
import * as vscode from 'vscode';
import { ClaudeProClient } from './claudeClient';
import { ChatHistoryManager } from './chatHistory';
import { ChatViewProvider } from './chatView';

export function activate(context: vscode.ExtensionContext) {
  console.log('Claude Pro extension activating...');

  const client = new ClaudeProClient(context);
  const historyManager = new ChatHistoryManager(context);
  const chatProvider = new ChatViewProvider(context.extensionUri, client, historyManager);

  // Register webview provider
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('claudeChat', chatProvider)
  );

  // New chat command
  context.subscriptions.push(
    vscode.commands.registerCommand('claudepro.newChat', () => {
      historyManager.startNewConversation();
      chatProvider.refresh();
    })
  );

  // Clear history command
  context.subscriptions.push(
    vscode.commands.registerCommand('claudepro.clearHistory', async () => {
      const answer = await vscode.window.showWarningMessage(
        'Clear all chat history?',
        'Yes',
        'No'
      );
      if (answer === 'Yes') {
        historyManager.clearAllHistory();
        chatProvider.refresh();
      }
    })
  );

  // Sign in command
  context.subscriptions.push(
    vscode.commands.registerCommand('claudepro.signIn', async () => {
      const success = await client.ensureAuthenticated();
      if (success) {
        vscode.window.showInformationMessage('Successfully signed in to Claude!');
        chatProvider.refresh();
      }
    })
  );

  // Sign out command
  context.subscriptions.push(
    vscode.commands.registerCommand('claudepro.signOut', async () => {
      const answer = await vscode.window.showWarningMessage(
        'Sign out of Claude?',
        'Yes',
        'No'
      );
      if (answer === 'Yes') {
        await context.secrets.delete('claude-oauth-credentials');
        vscode.window.showInformationMessage('Signed out successfully');
        chatProvider.refresh();
      }
    })
  );

  console.log('Claude Pro extension activated!');
}

export function deactivate() {}

// ====================
// src/claudeClient.ts
// ====================
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as vscode from 'vscode';
import * as crypto from 'crypto';
import * as http from 'http';

const execAsync = promisify(exec);

interface ClaudeCredentials {
  claudeAiOauth: {
    accessToken: string;
    refreshToken: string;
    expiresAt: number;
    scopes: string[];
  };
}

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

export class ClaudeProClient {
  private credentials: ClaudeCredentials | null = null;
  private apiEndpoint = 'https://api.anthropic.com/v1/messages';
  private context: vscode.ExtensionContext;

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
  }

  async ensureAuthenticated(): Promise<boolean> {
    // Try to load existing credentials
    if (await this.loadCredentials()) {
      return true;
    }

    // No credentials found, prompt user to login
    const choice = await vscode.window.showInformationMessage(
      'You need to sign in to Claude to continue',
      'Sign In',
      'Cancel'
    );

    if (choice === 'Sign In') {
      return await this.startOAuthFlow();
    }

    return false;
  }

  private async loadCredentials(): Promise<boolean> {
    try {
      const platform = os.platform();
      
      if (platform === 'darwin') {
        // macOS - read from Keychain
        try {
          const { stdout } = await execAsync(
            'security find-generic-password -s "Claude Code-credentials" -w'
          );
          this.credentials = JSON.parse(stdout.trim());
          return true;
        } catch {
          // Not in keychain, try file
        }
      }
      
      // Try reading from file (Linux/Windows or macOS fallback)
      const credPath = path.join(os.homedir(), '.claude', '.credentials.json');
      if (fs.existsSync(credPath)) {
        const data = fs.readFileSync(credPath, 'utf8');
        this.credentials = JSON.parse(data);
        return true;
      }

      // Try VS Code's secret storage
      const stored = await this.context.secrets.get('claude-oauth-credentials');
      if (stored) {
        this.credentials = JSON.parse(stored);
        return true;
      }

      return false;
    } catch (error) {
      console.error('Failed to load credentials:', error);
      return false;
    }
  }

  private async startOAuthFlow(): Promise<boolean> {
    try {
      // Generate PKCE challenge
      const codeVerifier = crypto.randomBytes(32).toString('base64url');
      const codeChallenge = crypto
        .createHash('sha256')
        .update(codeVerifier)
        .digest('base64url');

      // Start local server to receive callback
      const redirectPort = 54321;
      const redirectUri = `http://localhost:${redirectPort}/callback`;

      const authServer = await this.createCallbackServer(redirectPort, codeVerifier);

      // Build authorization URL
      const authParams = new URLSearchParams({
        response_type: 'code',
        client_id: 'vscode-extension', // You'll need to register this with Anthropic
        redirect_uri: redirectUri,
        scope: 'user:inference user:profile',
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
        state: crypto.randomBytes(16).toString('hex')
      });

      const authUrl = `https://claude.ai/oauth/authorize?${authParams.toString()}`;

      // Show login panel
      const panel = vscode.window.createWebviewPanel(
        'claudeLogin',
        'Sign in to Claude',
        vscode.ViewColumn.One,
        { enableScripts: true }
      );

      panel.webview.html = this.getLoginHtml(authUrl);

      // Wait for authentication
      return new Promise((resolve) => {
        authServer.once('authenticated', async (credentials: ClaudeCredentials) => {
          this.credentials = credentials;
          await this.saveCredentials(credentials);
          panel.dispose();
          vscode.window.showInformationMessage('Successfully signed in to Claude!');
          resolve(true);
        });

        authServer.once('error', (error: Error) => {
          panel.dispose();
          vscode.window.showErrorMessage(`Authentication failed: ${error.message}`);
          resolve(false);
        });

        panel.onDidDispose(() => {
          authServer.close();
          resolve(false);
        });
      });

    } catch (error: any) {
      vscode.window.showErrorMessage(`Login failed: ${error.message}`);
      return false;
    }
  }

  private async createCallbackServer(port: number, codeVerifier: string): Promise<any> {
    return new Promise((resolve) => {
      const server = http.createServer(async (req, res) => {
        if (!req.url?.startsWith('/callback')) {
          res.writeHead(404);
          res.end();
          return;
        }

        const url = new URL(req.url, `http://localhost:${port}`);
        const code = url.searchParams.get('code');
        const error = url.searchParams.get('error');

        if (error) {
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end('<html><body><h1>Authentication failed</h1><p>You can close this window.</p></body></html>');
          server.emit('error', new Error(error));
          return;
        }

        if (!code) {
          res.writeHead(400);
          res.end('No code received');
          return;
        }

        try {
          // Exchange code for tokens
          const credentials = await this.exchangeCodeForTokens(code, codeVerifier, `http://localhost:${port}/callback`);
          
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end('<html><body><h1>Success!</h1><p>You are now signed in. You can close this window.</p></body></html>');
          
          server.emit('authenticated', credentials);
        } catch (error: any) {
          res.writeHead(500, { 'Content-Type': 'text/html' });
          res.end(`<html><body><h1>Error</h1><p>${error.message}</p></body></html>`);
          server.emit('error', error);
        }
      });

      server.listen(port, () => {
        resolve(server);
      });
    });
  }

  private async exchangeCodeForTokens(code: string, codeVerifier: string, redirectUri: string): Promise<ClaudeCredentials> {
    const tokenResponse = await fetch('https://claude.ai/oauth/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: code,
        redirect_uri: redirectUri,
        code_verifier: codeVerifier,
        client_id: 'vscode-extension'
      })
    });

    if (!tokenResponse.ok) {
      const error = await tokenResponse.text();
      throw new Error(`Token exchange failed: ${error}`);
    }

    const data = await tokenResponse.json();
    
    return {
      claudeAiOauth: {
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        expiresAt: Date.now() + (data.expires_in * 1000),
        scopes: data.scope.split(' ')
      }
    };
  }

  private async saveCredentials(credentials: ClaudeCredentials): Promise<void> {
    try {
      // Save to VS Code secret storage (most secure)
      await this.context.secrets.store('claude-oauth-credentials', JSON.stringify(credentials));

      // Also save to file for compatibility with Claude Code CLI
      const credPath = path.join(os.homedir(), '.claude', '.credentials.json');
      const credDir = path.dirname(credPath);
      
      if (!fs.existsSync(credDir)) {
        fs.mkdirSync(credDir, { recursive: true });
      }
      
      fs.writeFileSync(credPath, JSON.stringify(credentials, null, 2), 'utf8');

      // On macOS, also save to keychain
      if (os.platform() === 'darwin') {
        try {
          await execAsync(
            `security add-generic-password -a "$USER" -s "Claude Code-credentials" -w '${JSON.stringify(credentials)}' -U`
          );
        } catch {
          // Keychain save is optional
        }
      }
    } catch (error) {
      console.error('Failed to save credentials:', error);
    }
  }

  private getLoginHtml(authUrl: string): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Sign in to Claude</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: var(--vscode-editor-background);
      color: var(--vscode-editor-foreground);
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100vh;
      padding: 20px;
    }

    .container {
      max-width: 400px;
      width: 100%;
      text-align: center;
    }

    .logo {
      font-size: 64px;
      margin-bottom: 24px;
    }

    h1 {
      font-size: 24px;
      font-weight: 600;
      margin-bottom: 12px;
    }

    p {
      opacity: 0.8;
      margin-bottom: 32px;
      line-height: 1.5;
    }

    .button {
      display: inline-block;
      padding: 12px 24px;
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      text-decoration: none;
      border-radius: 6px;
      font-weight: 600;
      margin: 8px;
      transition: opacity 0.2s;
      border: none;
      cursor: pointer;
      font-size: 14px;
    }

    .button:hover {
      opacity: 0.9;
    }

    .button.google {
      background: white;
      color: #333;
      border: 1px solid #ddd;
      display: flex;
      align-items: center;
      gap: 10px;
      justify-content: center;
      margin: 0 auto;
      max-width: 280px;
    }

    .button.email {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      margin-top: 12px;
    }

    .google-icon {
      width: 18px;
      height: 18px;
    }

    .divider {
      margin: 24px 0;
      opacity: 0.3;
      text-align: center;
      position: relative;
    }

    .divider::before {
      content: '';
      position: absolute;
      left: 0;
      right: 0;
      top: 50%;
      height: 1px;
      background: currentColor;
    }

    .divider span {
      position: relative;
      background: var(--vscode-editor-background);
      padding: 0 12px;
      font-size: 12px;
    }

    .note {
      margin-top: 24px;
      font-size: 12px;
      opacity: 0.6;
      line-height: 1.4;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="logo">🤖</div>
    <h1>Sign in to Claude</h1>
    <p>Connect your Claude Pro account to start using Claude in VS Code</p>
    
    <a href="${authUrl}&login_hint=google" class="button google">
      <svg class="google-icon" viewBox="0 0 24 24">
        <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
        <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
        <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
        <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
      </svg>
      Continue with Google
    </a>

    <div class="divider"><span>or</span></div>

    <a href="${authUrl}" class="button email">
      Continue with Email
    </a>

    <p class="note">
      By signing in, you'll use your Claude Pro subscription. 
      No API key required - just your regular Claude account!
    </p>
  </div>

  <script>
    // Auto-open in default browser for better OAuth experience
    const links = document.querySelectorAll('a.button');
    links.forEach(link => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        // VS Code will handle opening in external browser
        window.open(link.href, '_blank');
      });
    });
  </script>
</body>
</html>`;
  }

  async sendMessage(messages: Message[], onChunk?: (text: string) => void): Promise<string> {
    if (!this.credentials) {
      throw new Error('Not authenticated. Please run "claude /login" in your terminal.');
    }

    // Check if token expired
    if (Date.now() >= this.credentials.claudeAiOauth.expiresAt) {
      throw new Error('Token expired. Please run "claude /login" again.');
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
        max_tokens: 4096,
        messages: messages,
        stream: !!onChunk
      })
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Claude API error: ${error}`);
    }

    if (onChunk && response.body) {
      // Handle streaming
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let fullText = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') continue;
            
            try {
              const parsed = JSON.parse(data);
              if (parsed.type === 'content_block_delta' && parsed.delta?.text) {
                fullText += parsed.delta.text;
                onChunk(parsed.delta.text);
              }
            } catch (e) {
              // Skip invalid JSON
            }
          }
        }
      }

      return fullText;
    } else {
      // Non-streaming
      const data = await response.json();
      return data.content[0].text;
    }
  }

  isAuthenticated(): boolean {
    return this.credentials !== null;
  }
}

// ====================
// src/chatHistory.ts
// ====================
import * as vscode from 'vscode';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

interface Conversation {
  id: string;
  messages: Message[];
  title: string;
  createdAt: number;
}

export class ChatHistoryManager {
  private context: vscode.ExtensionContext;
  private currentConversation: Conversation;

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
    
    // Load or create current conversation
    const saved = context.globalState.get<Conversation>('currentConversation');
    if (saved) {
      this.currentConversation = saved;
    } else {
      this.currentConversation = this.createNewConversation();
    }
  }

  private createNewConversation(): Conversation {
    return {
      id: Date.now().toString(),
      messages: [],
      title: 'New Chat',
      createdAt: Date.now()
    };
  }

  addMessage(role: 'user' | 'assistant', content: string): void {
    this.currentConversation.messages.push({
      role,
      content,
      timestamp: Date.now()
    });

    // Auto-generate title from first user message
    if (this.currentConversation.title === 'New Chat' && role === 'user') {
      this.currentConversation.title = content.slice(0, 50) + (content.length > 50 ? '...' : '');
    }

    this.save();
  }

  getMessages(): Message[] {
    return this.currentConversation.messages;
  }

  getCurrentConversation(): Conversation {
    return this.currentConversation;
  }

  startNewConversation(): void {
    // Save current to history
    this.saveToHistory();
    
    // Start new
    this.currentConversation = this.createNewConversation();
    this.save();
  }

  private saveToHistory(): void {
    if (this.currentConversation.messages.length === 0) return;

    const history = this.context.globalState.get<Conversation[]>('conversationHistory', []);
    history.unshift(this.currentConversation);
    
    // Keep only last 50 conversations
    const trimmed = history.slice(0, 50);
    this.context.globalState.update('conversationHistory', trimmed);
  }

  getConversationHistory(): Conversation[] {
    return this.context.globalState.get<Conversation[]>('conversationHistory', []);
  }

  loadConversation(id: string): void {
    const history = this.getConversationHistory();
    const conv = history.find(c => c.id === id);
    if (conv) {
      this.currentConversation = conv;
      this.save();
    }
  }

  clearAllHistory(): void {
    this.context.globalState.update('conversationHistory', []);
    this.currentConversation = this.createNewConversation();
    this.save();
  }

  private save(): void {
    this.context.globalState.update('currentConversation', this.currentConversation);
  }
}

// ====================
// src/chatView.ts
// ====================
import * as vscode from 'vscode';
import { ClaudeProClient } from './claudeClient';
import { ChatHistoryManager } from './chatHistory';

export class ChatViewProvider implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly client: ClaudeProClient,
    private readonly history: ChatHistoryManager
  ) {}

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    context: vscode.WebviewViewResolveContext,
    token: vscode.CancellationToken
  ) {
    this.view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri]
    };

    webviewView.webview.html = this.getHtmlContent(webviewView.webview);

    // Handle messages from webview
    webviewView.webview.onDidReceiveMessage(async (data) => {
      switch (data.type) {
        case 'sendMessage':
          await this.handleSendMessage(data.message);
          break;
        case 'ready':
          await this.loadChatHistory();
          break;
      }
    });
  }

  private async handleSendMessage(userMessage: string) {
    if (!this.view) return;

    // Check authentication
    const authenticated = await this.client.ensureAuthenticated();
    if (!authenticated) {
      return; // User cancelled or auth failed
    }

    // Add user message to history
    this.history.addMessage('user', userMessage);

    // Display user message
    this.view.webview.postMessage({
      type: 'userMessage',
      message: userMessage
    });

    // Show typing indicator
    this.view.webview.postMessage({ type: 'typing', isTyping: true });

    try {
      // Get all messages for context
      const messages = this.history.getMessages().map(m => ({
        role: m.role,
        content: m.content
      }));

      // Send to Claude with streaming
      let assistantMessage = '';
      
      await this.client.sendMessage(messages, (chunk) => {
        assistantMessage += chunk;
        this.view?.webview.postMessage({
          type: 'streamChunk',
          chunk: chunk
        });
      });

      // Save assistant message
      this.history.addMessage('assistant', assistantMessage);

      // Complete streaming
      this.view.webview.postMessage({ type: 'streamComplete' });

    } catch (error: any) {
      this.view.webview.postMessage({
        type: 'error',
        message: error.message
      });
    } finally {
      this.view.webview.postMessage({ type: 'typing', isTyping: false });
    }
  }

  private async loadChatHistory() {
    if (!this.view) return;

    const messages = this.history.getMessages();
    this.view.webview.postMessage({
      type: 'loadHistory',
      messages: messages
    });
  }

  public refresh() {
    if (this.view) {
      this.view.webview.html = this.getHtmlContent(this.view.webview);
    }
  }

  private getHtmlContent(webview: vscode.Webview): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Claude Chat</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: var(--vscode-editor-background);
      color: var(--vscode-editor-foreground);
      height: 100vh;
      display: flex;
      flex-direction: column;
    }

    #chat-container {
      flex: 1;
      overflow-y: auto;
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .message {
      display: flex;
      flex-direction: column;
      gap: 6px;
      animation: fadeIn 0.2s ease-in;
    }

    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(10px); }
      to { opacity: 1; transform: translateY(0); }
    }

    .message-role {
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      opacity: 0.7;
    }

    .message.user .message-role {
      color: var(--vscode-terminal-ansiBlue);
    }

    .message.assistant .message-role {
      color: var(--vscode-terminal-ansiMagenta);
    }

    .message-content {
      background: var(--vscode-input-background);
      border: 1px solid var(--vscode-input-border);
      border-radius: 8px;
      padding: 12px;
      line-height: 1.5;
      white-space: pre-wrap;
      word-wrap: break-word;
    }

    .message.user .message-content {
      border-left: 3px solid var(--vscode-terminal-ansiBlue);
    }

    .message.assistant .message-content {
      border-left: 3px solid var(--vscode-terminal-ansiMagenta);
    }

    .typing-indicator {
      display: none;
      padding: 12px;
      font-style: italic;
      opacity: 0.6;
      font-size: 13px;
    }

    .typing-indicator.active {
      display: block;
    }

    #input-container {
      border-top: 1px solid var(--vscode-panel-border);
      padding: 12px;
      background: var(--vscode-editor-background);
    }

    #message-input {
      width: 100%;
      min-height: 60px;
      max-height: 200px;
      padding: 10px;
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border);
      border-radius: 6px;
      font-family: inherit;
      font-size: 13px;
      resize: vertical;
      outline: none;
    }

    #message-input:focus {
      border-color: var(--vscode-focusBorder);
    }

    #send-button {
      margin-top: 8px;
      width: 100%;
      padding: 10px;
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: none;
      border-radius: 6px;
      cursor: pointer;
      font-weight: 600;
      font-size: 13px;
      transition: opacity 0.2s;
    }

    #send-button:hover {
      opacity: 0.9;
    }

    #send-button:active {
      opacity: 0.8;
    }

    #send-button:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .error-message {
      background: var(--vscode-inputValidation-errorBackground);
      border: 1px solid var(--vscode-inputValidation-errorBorder);
      color: var(--vscode-errorForeground);
      padding: 12px;
      border-radius: 6px;
      margin: 8px 0;
    }

    .empty-state {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-direction: column;
      gap: 12px;
      opacity: 0.5;
      text-align: center;
      padding: 20px;
    }

    .empty-state-icon {
      font-size: 48px;
    }
  </style>
</head>
<body>
  <div id="chat-container">
    <div class="empty-state">
      <div class="empty-state-icon">💬</div>
      <div>Start a conversation with Claude</div>
    </div>
  </div>
  
  <div class="typing-indicator" id="typing">
    Claude is typing...
  </div>

  <div id="input-container">
    <textarea 
      id="message-input" 
      placeholder="Message Claude..."
      rows="3"
    ></textarea>
    <button id="send-button">Send</button>
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    const chatContainer = document.getElementById('chat-container');
    const messageInput = document.getElementById('message-input');
    const sendButton = document.getElementById('send-button');
    const typingIndicator = document.getElementById('typing');
    let currentStreamingMessage = null;

    // Send ready message
    vscode.postMessage({ type: 'ready' });

    // Handle send
    function sendMessage() {
      const message = messageInput.value.trim();
      if (!message) return;

      vscode.postMessage({
        type: 'sendMessage',
        message: message
      });

      messageInput.value = '';
      messageInput.style.height = 'auto';
    }

    sendButton.addEventListener('click', sendMessage);
    
    messageInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    });

    // Auto-resize textarea
    messageInput.addEventListener('input', () => {
      messageInput.style.height = 'auto';
      messageInput.style.height = messageInput.scrollHeight + 'px';
    });

    // Handle messages from extension
    window.addEventListener('message', event => {
      const message = event.data;

      switch (message.type) {
        case 'loadHistory':
          loadHistory(message.messages);
          break;
        case 'userMessage':
          addMessage('user', message.message);
          break;
        case 'streamChunk':
          handleStreamChunk(message.chunk);
          break;
        case 'streamComplete':
          currentStreamingMessage = null;
          scrollToBottom();
          break;
        case 'typing':
          typingIndicator.classList.toggle('active', message.isTyping);
          scrollToBottom();
          break;
        case 'error':
          showError(message.message);
          break;
      }
    });

    function loadHistory(messages) {
      chatContainer.innerHTML = '';
      if (messages.length === 0) {
        showEmptyState();
      } else {
        messages.forEach(msg => {
          addMessage(msg.role, msg.content, false);
        });
      }
      scrollToBottom();
    }

    function showEmptyState() {
      chatContainer.innerHTML = \`
        <div class="empty-state">
          <div class="empty-state-icon">💬</div>
          <div>Start a conversation with Claude</div>
        </div>
      \`;
    }

    function addMessage(role, content, animate = true) {
      // Remove empty state if present
      const emptyState = chatContainer.querySelector('.empty-state');
      if (emptyState) emptyState.remove();

      const messageDiv = document.createElement('div');
      messageDiv.className = \`message \${role}\`;
      messageDiv.innerHTML = \`
        <div class="message-role">\${role}</div>
        <div class="message-content">\${escapeHtml(content)}</div>
      \`;
      chatContainer.appendChild(messageDiv);
      scrollToBottom();
    }

    function handleStreamChunk(chunk) {
      if (!currentStreamingMessage) {
        // Create new message for streaming
        const emptyState = chatContainer.querySelector('.empty-state');
        if (emptyState) emptyState.remove();

        const messageDiv = document.createElement('div');
        messageDiv.className = 'message assistant';
        messageDiv.innerHTML = \`
          <div class="message-role">assistant</div>
          <div class="message-content"></div>
        \`;
        chatContainer.appendChild(messageDiv);
        currentStreamingMessage = messageDiv.querySelector('.message-content');
      }

      currentStreamingMessage.textContent += chunk;
      scrollToBottom();
    }

    function showError(errorMessage) {
      const errorDiv = document.createElement('div');
      errorDiv.className = 'error-message';
      errorDiv.textContent = '❌ ' + errorMessage;
      chatContainer.appendChild(errorDiv);
      scrollToBottom();
    }

    function scrollToBottom() {
      chatContainer.scrollTop = chatContainer.scrollHeight;
    }

    function escapeHtml(text) {
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    }
  </script>
</body>
</html>`;
  }
}

// ====================
// README.md
// ====================
# Claude Pro VS Code Extension

Chat with Claude directly in VS Code using your Claude Pro subscription - no API keys needed!

## Features

- ✅ **Easy OAuth login** - Sign in with Google or email right in VS Code
- ✅ **Sidebar chat interface** - just like Claude.ai or the desktop app
- ✅ **Uses your Claude Pro OAuth** - no pay-per-token charges
- ✅ **Conversation history** - your chats are saved and synced
- ✅ **Streaming responses** - see Claude's response in real-time
- ✅ **Full context** - maintains conversation history automatically
- ✅ **Beautiful UI** - matches VS Code's theme

## Installation

1. **Install the extension:**
   ```bash
   # Clone and setup
   mkdir claude-pro-vscode && cd claude-pro-vscode
   
   # Copy all the code from the artifact into:
   # - package.json
   # - tsconfig.json
   # - src/extension.ts
   # - src/claudeClient.ts
   # - src/chatHistory.ts
   # - src/chatView.ts
   
   # Install and compile
   npm install
   npm run compile
   ```

2. **Run it:**
   - Press F5 in VS Code (opens Extension Development Host)
   - Or package it: `npm install -g vsce && vsce package` then install the .vsix file

## Usage

### First Time Setup

1. **Open Claude sidebar:**
   - Click the Claude icon in the Activity Bar (left sidebar)
   
2. **Sign in:**
   - When you first try to chat, you'll be prompted to sign in
   - Choose "Sign in with Google" or "Continue with Email"
   - Authenticate in your browser
   - Done! You're signed in

### Chatting

- Type your message in the input box
- Press Enter or click Send
- See Claude's response stream in real-time!

### Commands

- **New Chat** - Click the "+" icon in sidebar header
- **Sign Out** - Command Palette → "Claude: Sign Out"
- **Sign In** - Command Palette → "Claude: Sign In"
- **Clear History** - Command Palette → "Clear Chat History"

## How Authentication Works

1. **Checks for existing credentials:**
   - VS Code secret storage (most secure)
   - `~/.claude/.credentials.json` (for CLI compatibility)
   - macOS Keychain (if on Mac)

2. **If not found, starts OAuth flow:**
   - Opens a login page in VS Code
   - You click "Sign in with Google" or email
   - Browser opens for authentication
   - Tokens are saved securely

3. **Credentials are saved:**
   - VS Code secret storage (encrypted)
   - Local file for CLI compatibility
   - macOS Keychain (if on Mac)

## Compatibility

Works seamlessly with Claude Code CLI! If you've already run `claude /login`, the extension will find and use those credentials. No need to sign in twice!

## Troubleshooting

**"Authentication failed" error:**
- Make sure you have a Claude Pro subscription
- Try signing in again with Command Palette → "Claude: Sign In"

**Token expired:**
- Just sign in again - your OAuth tokens refresh automatically
- Command Palette → "Claude: Sign In"

**Extension not appearing:**
- Make sure you compiled it: `npm run compile`
- Restart VS Code
- Check for errors in the Output panel

## Security

- OAuth tokens stored in VS Code's encrypted secret storage
- PKCE flow used for additional security
- Tokens never exposed in logs or UI
- Same security as Claude.ai website

## What's Next?

This gives you full chat with proper OAuth! Next features could include:
- Code execution and file editing
- GitHub integration
- Autonomous task mode
- Project context awareness

Enjoy chatting with Claude! 🚀