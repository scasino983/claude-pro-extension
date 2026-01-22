import * as vscode from 'vscode';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
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
  private context: vscode.ExtensionContext;

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
  }

  async ensureAuthenticated(): Promise<boolean> {
    // First try to load existing credentials
    const loaded = await this.loadCredentials();
    if (loaded && this.credentials) {
      // Check if token is still valid (not expired)
      if (Date.now() < this.credentials.claudeAiOauth.expiresAt) {
        return true;
      }
    }

    // Need to authenticate
    const choice = await vscode.window.showInformationMessage(
      'Sign in to Claude to start chatting',
      'Sign In',
      'Cancel'
    );

    if (choice !== 'Sign In') {
      return false;
    }

    return await this.startOAuthFlow();
  }

  private async loadCredentials(): Promise<boolean> {
    try {
      // Try VS Code secrets first
      const stored = await this.context.secrets.get('claude-credentials');
      if (stored) {
        this.credentials = JSON.parse(stored);
        return true;
      }

      // Fall back to file system
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
          // Keychain entry doesn't exist
          return false;
        }
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

  private async startOAuthFlow(): Promise<boolean> {
    try {
      // Start local callback server on random port (like Claude Code does)
      const redirectPort = Math.floor(Math.random() * (65535 - 49152) + 49152);
      const redirectUri = `http://127.0.0.1:${redirectPort}/callback`;

      const authServer = await this.createCallbackServer(redirectPort);

      // Build the Claude.ai login URL
      // Claude Code redirects to claude.ai which handles the actual OAuth
      const state = crypto.randomBytes(16).toString('hex');
      const authUrl = `https://claude.ai/login?redirect_uri=${encodeURIComponent(redirectUri)}&state=${state}`;

      // Show message and open browser
      vscode.window.showInformationMessage(
        'Opening browser for authentication...',
        'Cancel'
      ).then(selection => {
        if (selection === 'Cancel') {
          authServer.close();
        }
      });

      // Open in external browser (like Claude Code does)
      await vscode.env.openExternal(vscode.Uri.parse(authUrl));

      // Wait for authentication
      return new Promise((resolve) => {
        authServer.once('authenticated', async (credentials: ClaudeCredentials) => {
          this.credentials = credentials;
          await this.saveCredentials(credentials);
          authServer.close();
          vscode.window.showInformationMessage('✅ Successfully signed in to Claude!');
          resolve(true);
        });

        authServer.once('error', (error: Error) => {
          authServer.close();
          vscode.window.showErrorMessage(`Authentication failed: ${error.message}`);
          resolve(false);
        });

        // Timeout after 5 minutes
        setTimeout(() => {
          authServer.close();
          vscode.window.showWarningMessage('Authentication timed out');
          resolve(false);
        }, 5 * 60 * 1000);
      });

    } catch (error: any) {
      vscode.window.showErrorMessage(`Login failed: ${error.message}`);
      return false;
    }
  }

  private async createCallbackServer(port: number): Promise<any> {
    return new Promise((resolve) => {
      const server = http.createServer(async (req, res) => {
        if (!req.url) {
          res.writeHead(404);
          res.end();
          return;
        }

        const url = new URL(req.url, `http://127.0.0.1:${port}`);
        
        if (url.pathname !== '/callback') {
          res.writeHead(404);
          res.end();
          return;
        }

        const error = url.searchParams.get('error');
        const errorDescription = url.searchParams.get('error_description');

        if (error) {
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(`
            <html>
              <head>
                <title>Authentication Failed</title>
                <style>
                  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; 
                         display: flex; align-items: center; justify-content: center; height: 100vh; 
                         margin: 0; background: #f5f5f5; }
                  .container { text-align: center; background: white; padding: 40px; 
                               border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
                  h1 { color: #d32f2f; margin: 0 0 16px 0; }
                  p { color: #666; margin: 0; }
                </style>
              </head>
              <body>
                <div class="container">
                  <h1>❌ Authentication Failed</h1>
                  <p>${errorDescription || error}</p>
                  <p style="margin-top: 20px;">You can close this window.</p>
                </div>
              </body>
            </html>
          `);
          server.emit('error', new Error(errorDescription || error));
          return;
        }

        // Extract credentials from URL parameters
        // Claude.ai passes back the OAuth tokens in the redirect
        const accessToken = url.searchParams.get('access_token');
        const refreshToken = url.searchParams.get('refresh_token');
        const expiresIn = url.searchParams.get('expires_in');

        if (!accessToken || !refreshToken) {
          res.writeHead(400);
          res.end('Missing authentication tokens');
          server.emit('error', new Error('Missing authentication tokens'));
          return;
        }

        try {
          const credentials: ClaudeCredentials = {
            claudeAiOauth: {
              accessToken: accessToken,
              refreshToken: refreshToken,
              expiresAt: Date.now() + (parseInt(expiresIn || '3600') * 1000),
              scopes: ['user:inference', 'user:profile']
            }
          };

          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(`
            <html>
              <head>
                <title>Authentication Successful</title>
                <style>
                  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; 
                         display: flex; align-items: center; justify-content: center; height: 100vh; 
                         margin: 0; background: #f5f5f5; }
                  .container { text-align: center; background: white; padding: 40px; 
                               border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
                  h1 { color: #4caf50; margin: 0 0 16px 0; }
                  p { color: #666; margin: 0; }
                  .emoji { font-size: 48px; margin-bottom: 16px; }
                </style>
              </head>
              <body>
                <div class="container">
                  <div class="emoji">🎉</div>
                  <h1>Successfully Signed In!</h1>
                  <p>You can now close this window and return to VS Code.</p>
                </div>
                <script>
                  // Auto-close after 3 seconds
                  setTimeout(() => window.close(), 3000);
                </script>
              </body>
            </html>
          `);
          
          server.emit('authenticated', credentials);
        } catch (error: any) {
          res.writeHead(500);
          res.end('Internal server error');
          server.emit('error', error);
        }
      });

      server.listen(port, '127.0.0.1', () => {
        resolve(server);
      });

      server.on('error', (err: any) => {
        if (err.code === 'EADDRINUSE') {
          // Port in use, try another one
          console.log(`Port ${port} in use, will try another`);
        }
      });
    });
  }

  private async saveCredentials(credentials: ClaudeCredentials): Promise<void> {
    try {
      // Save to VS Code secrets
      await this.context.secrets.store('claude-credentials', JSON.stringify(credentials));

      // Also save to file system for compatibility with Claude Code CLI
      const credPath = path.join(os.homedir(), '.claude', '.credentials.json');
      const credDir = path.dirname(credPath);
      
      if (!fs.existsSync(credDir)) {
        fs.mkdirSync(credDir, { recursive: true });
      }
      
      fs.writeFileSync(credPath, JSON.stringify(credentials, null, 2));

      // On macOS, also save to Keychain
      if (os.platform() === 'darwin') {
        const credJson = JSON.stringify(credentials);
        await execAsync(
          `security add-generic-password -a "$(whoami)" -s "Claude Code-credentials" -w "${credJson.replace(/"/g, '\\"')}" -U`
        );
      }
    } catch (error) {
      console.error('Failed to save credentials:', error);
      throw error;
    }
  }

  async signOut(): Promise<void> {
    try {
      // Clear from VS Code secrets
      await this.context.secrets.delete('claude-credentials');

      // Clear from file system
      const credPath = path.join(os.homedir(), '.claude', '.credentials.json');
      if (fs.existsSync(credPath)) {
        fs.unlinkSync(credPath);
      }

      // Clear from macOS Keychain
      if (os.platform() === 'darwin') {
        try {
          await execAsync('security delete-generic-password -s "Claude Code-credentials"');
        } catch {
          // Ignore if not found
        }
      }

      this.credentials = null;
      vscode.window.showInformationMessage('Signed out of Claude');
    } catch (error) {
      console.error('Failed to sign out:', error);
      throw error;
    }
  }

  async sendMessage(messages: Message[], onChunk?: (text: string) => void): Promise<string> {
    if (!this.credentials) {
      throw new Error('Not authenticated. Please sign in first.');
    }

    // Check if token expired
    if (Date.now() >= this.credentials.claudeAiOauth.expiresAt) {
      throw new Error('Token expired. Please sign in again.');
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
      const data = await response.json() as any;
      return data.content[0].text;
    }
  }

  isAuthenticated(): boolean {
    return this.credentials !== null;
  }
}
