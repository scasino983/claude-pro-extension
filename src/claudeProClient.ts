import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { execAsync } from './utils';

interface ClaudeCredentials {
  claudeAiOauth: {
    accessToken: string;
    refreshToken: string;
    expiresAt: number;
    scopes: string[];
  };
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

  async callClaude(prompt: string, maxTokens: number = 4096): Promise<string> {
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

    const data = await response.json() as any;
    return data.content[0].text;
  }

  private async refreshToken(): Promise<void> {
    // Token refresh logic - would need to implement Anthropic's OAuth refresh flow
    // For now, throw error and user needs to re-login
    throw new Error('Token expired. Please run Claude Code /login again.');
  }
}
