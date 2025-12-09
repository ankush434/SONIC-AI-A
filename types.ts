export enum Sender {
  USER = 'user',
  SONIC = 'sonic',
  SYSTEM = 'system'
}

export interface Message {
  id: string;
  sender: Sender;
  text: string;
  timestamp: number;
  imageSrc?: string; // For generated images
  isThinking?: boolean;
  attachment?: {
    mimeType: string;
    data: string; // base64
  };
}

export interface ChatSession {
  id: string;
  title: string;
  messages: Message[];
  timestamp: number;
}

export enum AppMode {
  CHAT = 'chat',
  VOICE = 'voice'
}

export interface AudioVisualizerState {
  isListening: boolean;
  volume: number;
}