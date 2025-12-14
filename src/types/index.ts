export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
  typstOutput?: TypstOutput;
}

export interface TypstOutput {
  code: string;
  pages?: string[]; // base64 encoded page images
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
  data?: string; // base64 encoded (single file)
  pages?: string[]; // base64 encoded pages
  mimeType?: string;
  error?: string;
}

export interface ToolCall {
  name: "render_typst";
  input: {
    code: string;
    description: string;
  };
}

export interface ConversationRequest {
  messages: { role: "user" | "assistant"; content: string }[];
}

export interface ConversationResponse {
  message: string;
  typstOutput?: TypstOutput;
}
