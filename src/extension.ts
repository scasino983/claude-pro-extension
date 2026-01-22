import * as vscode from 'vscode';
import { ClaudeProClient } from './claudeProClient';
import { ClaudeTaskManager } from './claudeTaskManager';
import { execAsync } from './utils';

export function activate(context: vscode.ExtensionContext) {
  const outputChannel = vscode.window.createOutputChannel('Claude Pro');
  const client = new ClaudeProClient();
  const taskManager = new ClaudeTaskManager(client, outputChannel);

  // Register command: Claude: Run Task
  const runTaskCommand = vscode.commands.registerCommand('claudepro.runTask', async () => {
    // Load credentials first
    const loaded = await client.loadCredentials();
    if (!loaded) {
      vscode.window.showErrorMessage(
        'Claude credentials not found. Please run "claude /login" in your terminal first.'
      );
      return;
    }

    // Get task from user
    const task = await vscode.window.showInputBox({
      prompt: 'What task should Claude complete?',
      placeHolder: 'e.g., Add error handling to the login function'
    });

    if (!task) return;

    try {
      await taskManager.executeTask(task);
      vscode.window.showInformationMessage('✅ Task completed!');
    } catch (error: any) {
      vscode.window.showErrorMessage(`❌ Task failed: ${error.message}`);
    }
  });

  // Register command: Claude: Work on GitHub Issue
  const workOnIssueCommand = vscode.commands.registerCommand('claudepro.workOnIssue', async () => {
    const loaded = await client.loadCredentials();
    if (!loaded) {
      vscode.window.showErrorMessage(
        'Claude credentials not found. Please run "claude /login" in your terminal first.'
      );
      return;
    }

    const issueNumber = await vscode.window.showInputBox({
      prompt: 'Enter GitHub issue number',
      placeHolder: 'e.g., 123'
    });

    if (!issueNumber) return;

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
    } catch (error: any) {
      vscode.window.showErrorMessage(`❌ Failed: ${error.message}`);
    }
  });

  context.subscriptions.push(runTaskCommand, workOnIssueCommand, outputChannel);
}

export function deactivate() {}
