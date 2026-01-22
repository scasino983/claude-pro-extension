import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { ClaudeProClient } from './claudeProClient';
import { GitHubClient } from './githubClient';
import { execAsync } from './utils';

export class ClaudeTaskManager {
  private client: ClaudeProClient;
  private outputChannel: vscode.OutputChannel;
  private ghClient: GitHubClient;

  constructor(client: ClaudeProClient, outputChannel: vscode.OutputChannel) {
    this.client = client;
    this.outputChannel = outputChannel;
    this.ghClient = new GitHubClient(outputChannel);
  }

  async executeTask(task: string): Promise<void> {
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
    } catch (error) {
      this.outputChannel.appendLine(`\n❌ Error: ${error}`);
      throw error;
    }
  }

  private async buildContext(workspace: vscode.WorkspaceFolder, task: string): Promise<string> {
    const context: string[] = [];
    
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

  private parseResponse(response: string): any {
    // Extract JSON from response (Claude might wrap it in markdown)
    const jsonMatch = response.match(/```json\s*([\s\S]*?)\s*```/) || 
                      response.match(/\{[\s\S]*\}/);
    
    if (!jsonMatch) {
      throw new Error('Could not parse Claude response');
    }

    return JSON.parse(jsonMatch[1] || jsonMatch[0]);
  }

  private async executeActions(actions: any[], workspacePath: string): Promise<void> {
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

  private async writeFile(workspacePath: string, filePath: string, content: string): Promise<void> {
    const fullPath = path.join(workspacePath, filePath);
    const dir = path.dirname(fullPath);
    
    // Create directory if it doesn't exist
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    
    fs.writeFileSync(fullPath, content, 'utf8');
    this.outputChannel.appendLine(`   📝 Wrote: ${filePath}`);
  }

  private async deleteFile(workspacePath: string, filePath: string): Promise<void> {
    const fullPath = path.join(workspacePath, filePath);
    if (fs.existsSync(fullPath)) {
      fs.unlinkSync(fullPath);
      this.outputChannel.appendLine(`   🗑️  Deleted: ${filePath}`);
    }
  }

  private async runCommand(workspacePath: string, cmd: string): Promise<void> {
    try {
      const { stdout, stderr } = await execAsync(cmd, { cwd: workspacePath });
      this.outputChannel.appendLine(`   💻 Command: ${cmd}`);
      if (stdout) this.outputChannel.appendLine(`   Output: ${stdout.trim()}`);
      if (stderr) this.outputChannel.appendLine(`   Stderr: ${stderr.trim()}`);
    } catch (error: any) {
      this.outputChannel.appendLine(`   ❌ Command failed: ${error.message}`);
      throw error;
    }
  }
}
