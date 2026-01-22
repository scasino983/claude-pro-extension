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
