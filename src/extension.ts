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
