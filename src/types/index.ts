export interface Message {
  id: string;
  role: "user" | "assistant" | "tool";
  content: string;
  timestamp: Date;
  typstOutput?: TypstOutput;
  toolCall?: ToolCallInfo;
  isStreaming?: boolean;
}

export interface ToolCallInfo {
  name: string;
  status: "calling" | "executing" | "success" | "error";
  input?: { code: string; description: string };
  error?: string;
}

export interface TypstOutput {
  code: string;
  pages?: string[];
  pdfUrl?: string;
  error?: string;
}

export interface ChatState {
  messages: Message[];
  isLoading: boolean;
  error: string | null;
}

export interface TypstRenderRequest {
  code: string;
  format: "pdf" | "png" | "svg";
}

export interface TypstRenderResponse {
  success: boolean;
  data?: string;
  pages?: string[];
  mimeType?: string;
  error?: string;
}

export interface ConversationRequest {
  messages: { role: "user" | "assistant"; content: string }[];
}

export interface ConversationResponse {
  message: string;
  typstOutput?: TypstOutput;
}
