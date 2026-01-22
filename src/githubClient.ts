import * as vscode from 'vscode';
import { execAsync } from './utils';

export class GitHubClient {
  private outputChannel: vscode.OutputChannel;

  constructor(outputChannel: vscode.OutputChannel) {
    this.outputChannel = outputChannel;
  }

  async getStatus(workspacePath: string): Promise<string | null> {
    try {
      const { stdout } = await execAsync('gh auth status && git status', { cwd: workspacePath });
      return stdout.trim();
    } catch {
      return null;
    }
  }

  async createPR(workspacePath: string, title: string, body: string): Promise<void> {
    const cmd = `gh pr create --title "${title}" --body "${body}"`;
    await execAsync(cmd, { cwd: workspacePath });
    this.outputChannel.appendLine(`   ✅ Created PR: ${title}`);
  }

  async checkoutBranch(workspacePath: string, branch: string): Promise<void> {
    await execAsync(`git checkout -b ${branch}`, { cwd: workspacePath });
    this.outputChannel.appendLine(`   🌿 Created branch: ${branch}`);
  }

  async commit(workspacePath: string, message: string): Promise<void> {
    await execAsync(`git add . && git commit -m "${message}"`, { cwd: workspacePath });
    this.outputChannel.appendLine(`   💾 Committed: ${message}`);
  }

  async push(workspacePath: string): Promise<void> {
    await execAsync('git push', { cwd: workspacePath });
    this.outputChannel.appendLine(`   ⬆️  Pushed to remote`);
  }
}
