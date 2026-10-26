export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatData {
  id: string;
  filename: string;
  site: string; // 'claude' | 'chatgpt' | 'gemini' | 'unknown'
  title: string;
  url: string;
  timestamp: string;
  messageCount: number;
  messages: ChatMessage[];
}

export interface Bookmark {
  id: string;
  chatId: string;
  /** The selected text snippet */
  text: string;
  /** Index of the message within the chat */
  messageIndex: number;
  /** Created timestamp */
  createdAt: string;
}
