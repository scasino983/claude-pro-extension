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
