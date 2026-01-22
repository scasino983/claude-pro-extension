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

  const client = new ClaudeProClient();
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

  async loadCredentials(): Promise<boolean> {
    try {
      const platform = os.platform();
      
      if (platform === 'darwin') {
        // macOS - read from Keychain
        const { stdout } = await execAsync(
          'security find-generic-password -s "Claude Code-credentials" -w'
        );
        this.credentials = JSON.parse(stdout.trim());
        return true;
      } else {
        // Linux/Windows - read from file
        const credPath = path.join(os.homedir(), '.claude', '.credentials.json');
        if (fs.existsSync(credPath)) {
          const data = fs.readFileSync(credPath, 'utf8');
          this.credentials = JSON.parse(data);
          return true;
        }
      }
      return false;
    } catch (error) {
      console.error('Failed to load credentials:', error);
      return false;
    }
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
    const authenticated = await this.client.loadCredentials();
    if (!authenticated) {
      this.view.webview.postMessage({
        type: 'error',
        message: 'Not authenticated. Please run "claude /login" in your terminal first.'
      });
      return;
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

- ✅ **Sidebar chat interface** - just like Claude.ai or the desktop app
- ✅ **Uses your Claude Pro OAuth** - no pay-per-token charges
- ✅ **Conversation history** - your chats are saved and synced
- ✅ **Streaming responses** - see Claude's response in real-time
- ✅ **Full context** - maintains conversation history automatically
- ✅ **Beautiful UI** - matches VS Code's theme

## Installation

1. **Prerequisites:**
   ```bash
   # Install Claude Code CLI and login with your Pro account
   npm install -g @anthropic-ai/claude-code
   claude /login
   ```

2. **Install the extension:**
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

3. **Run it:**
   - Press F5 in VS Code (opens Extension Development Host)
   - Or package it: `vsce package` then install the .vsix file

## Usage

1. **Open Claude sidebar:**
   - Click the Claude icon in the Activity Bar (left sidebar)
   
2. **Start chatting:**
   - Type your message in the input box
   - Press Enter or click Send
   - See Claude's response stream in real-time!

3. **New conversation:**
   - Click the "+" icon in the sidebar header
   - Or use Command Palette: "New Chat"

## How It Works

- Reads your Claude Pro OAuth credentials (same as Claude Code CLI)
- Sends messages to Claude API using your Pro subscription tokens
- Maintains full conversation context automatically
- Saves chat history locally in VS Code

## Troubleshooting

**"Not authenticated" error:**
```bash
# Make sure you're logged in
claude /login

# Verify credentials exist
# macOS:
security find-generic-password -s "Claude Code-credentials" -w

# Linux:
cat ~/.claude/.credentials.json
```

**Token expired:**
```bash
# Just login again
claude /login
```

## What's Next?

This gives you the chat interface! Next features could include:
- Code execution and file editing
- GitHub integration
- Autonomous task mode
- Project context awareness

Enjoy chatting with Claude! 🚀