import { useState, useRef, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import type { Message, TypstOutput } from "../types";

interface ChatSidebarProps {
  conversationId: string | null;
  onConversationChange: (id: string | null) => void;
  onTypstOutput: (output: TypstOutput | null) => void;
  onShowHistory: () => void;
  onNewChat: () => void;
}

export function ChatSidebar({
  conversationId,
  onConversationChange,
  onTypstOutput,
  onShowHistory,
  onNewChat,
}: ChatSidebarProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Load conversation when ID changes
  useEffect(() => {
    if (conversationId) {
      loadConversation(conversationId);
    } else {
      setMessages([]);
      onTypstOutput(null);
    }
  }, [conversationId]);

  const loadConversation = async (id: string) => {
    try {
      const response = await fetch(`/api/conversations/${id}`);
      if (!response.ok) return;

      const data = await response.json();

      // Convert DB messages to UI messages
      const uiMessages: Message[] = [];
      for (const msg of data.messages) {
        if (msg.source === "user" || msg.source === "assistant") {
          const content = JSON.parse(msg.content);
          uiMessages.push({
            id: String(msg.id),
            role: msg.source,
            content: msg.source === "user" ? content.content : content.message,
            timestamp: new Date(msg.timestamp),
          });
        }
      }
      setMessages(uiMessages);

      // Restore Typst output
      if (data.typstOutput) {
        onTypstOutput(data.typstOutput);
      }
    } catch (error) {
      console.error("Error loading conversation:", error);
    }
  };

  const sendMessage = async () => {
    if (!input.trim() || isLoading) return;

    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content: input,
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setIsLoading(true);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [...messages, userMessage].map((m) => ({
            role: m.role,
            content: m.content,
          })),
          conversationId,
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to send message");
      }

      const data = await response.json();

      // Update conversation ID if new
      if (data.conversationId && data.conversationId !== conversationId) {
        onConversationChange(data.conversationId);
      }

      const assistantMessage: Message = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: data.message,
        timestamp: new Date(),
        typstOutput: data.typstOutput,
      };

      setMessages((prev) => [...prev, assistantMessage]);

      if (data.typstOutput) {
        onTypstOutput(data.typstOutput);
      }
    } catch (error) {
      console.error("Error sending message:", error);
      const errorMessage: Message = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: "Sorry, there was an error processing your request.",
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  return (
    <div className="chat-sidebar">
      <div className="chat-header">
        <h2>Typst AI</h2>
        <div className="header-actions">
          <button
            className="header-btn"
            onClick={onShowHistory}
            title="History"
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
          </button>
          <button className="header-btn" onClick={onNewChat} title="New Chat">
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </button>
        </div>
      </div>

      <div className="chat-messages">
        {messages.length === 0 && (
          <div className="chat-welcome">
            <p>Welcome! I can help you create PDF documents using Typst.</p>
            <p>Try asking me to create:</p>
            <ul>
              <li>A resume or CV</li>
              <li>An invoice</li>
              <li>A report or paper</li>
              <li>A letter or memo</li>
            </ul>
          </div>
        )}

        {messages.map((message) => (
          <div key={message.id} className={`chat-message ${message.role}`}>
            <div className="message-content">
              <ReactMarkdown>{message.content}</ReactMarkdown>
            </div>
            {message.typstOutput?.error && (
              <div className="typst-error">
                Error: {message.typstOutput.error}
              </div>
            )}
          </div>
        ))}

        {isLoading && (
          <div className="chat-message assistant">
            <div className="message-content loading">
              <span className="dot">.</span>
              <span className="dot">.</span>
              <span className="dot">.</span>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      <div className="chat-input-container">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask me to create a document..."
          disabled={isLoading}
          rows={3}
        />
        <button onClick={sendMessage} disabled={isLoading || !input.trim()}>
          Send
        </button>
      </div>
    </div>
  );
}
