import { useState, useRef, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import type { Message, TypstOutput, ToolCallInfo } from "../types";

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
  const abortControllerRef = useRef<AbortController | null>(null);

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
        const content = JSON.parse(msg.content);

        if (msg.source === "user") {
          uiMessages.push({
            id: String(msg.id),
            role: "user",
            content: content.content,
            timestamp: new Date(msg.timestamp),
          });
        } else if (msg.source === "tool_call") {
          uiMessages.push({
            id: String(msg.id),
            role: "tool",
            content: "",
            timestamp: new Date(msg.timestamp),
            toolCall: {
              name: content.tool,
              status: "calling",
              input: content.input,
            },
          });
        } else if (msg.source === "tool_result") {
          // Update the previous tool message with result
          const lastToolIdx = uiMessages.findLastIndex(
            (m) => m.role === "tool",
          );
          if (lastToolIdx !== -1) {
            uiMessages[lastToolIdx] = {
              ...uiMessages[lastToolIdx],
              toolCall: {
                ...uiMessages[lastToolIdx].toolCall!,
                status: content.success ? "success" : "error",
                error: content.error,
              },
            };
          }
        } else if (msg.source === "assistant") {
          uiMessages.push({
            id: String(msg.id),
            role: "assistant",
            content: content.message,
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

    // Create streaming assistant message
    const assistantId = crypto.randomUUID();
    setMessages((prev) => [
      ...prev,
      {
        id: assistantId,
        role: "assistant",
        content: "",
        timestamp: new Date(),
        isStreaming: true,
      },
    ]);

    abortControllerRef.current = new AbortController();

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [...messages, userMessage]
            .filter((m) => m.role === "user" || m.role === "assistant")
            .map((m) => ({
              role: m.role,
              content: m.content,
            })),
          conversationId,
        }),
        signal: abortControllerRef.current.signal,
      });

      if (!response.ok) throw new Error("Failed to send message");

      const reader = response.body?.getReader();
      if (!reader) throw new Error("No reader");

      const decoder = new TextDecoder();
      let buffer = "";
      let currentToolId: string | null = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.startsWith("event: ")) {
            const event = line.slice(7);
            const dataLine = lines[lines.indexOf(line) + 1];
            if (dataLine?.startsWith("data: ")) {
              const data = JSON.parse(dataLine.slice(6));

              switch (event) {
                case "conversation_id":
                  if (data.conversationId !== conversationId) {
                    onConversationChange(data.conversationId);
                  }
                  break;

                case "text":
                  setMessages((prev) =>
                    prev.map((m) =>
                      m.id === assistantId
                        ? { ...m, content: m.content + data.text }
                        : m,
                    ),
                  );
                  break;

                case "tool_start":
                  currentToolId = crypto.randomUUID();
                  setMessages((prev) => {
                    // Insert tool message before the streaming assistant message
                    const assistantIdx = prev.findIndex(
                      (m) => m.id === assistantId,
                    );
                    const newMessages = [...prev];
                    newMessages.splice(assistantIdx, 0, {
                      id: currentToolId!,
                      role: "tool",
                      content: "",
                      timestamp: new Date(),
                      toolCall: {
                        name: data.tool,
                        status: "calling",
                      },
                    });
                    return newMessages;
                  });
                  break;

                case "tool_input":
                  if (currentToolId) {
                    setMessages((prev) =>
                      prev.map((m) =>
                        m.id === currentToolId
                          ? {
                              ...m,
                              toolCall: { ...m.toolCall!, input: data.input },
                            }
                          : m,
                      ),
                    );
                  }
                  break;

                case "tool_executing":
                  if (currentToolId) {
                    setMessages((prev) =>
                      prev.map((m) =>
                        m.id === currentToolId
                          ? {
                              ...m,
                              toolCall: { ...m.toolCall!, status: "executing" },
                            }
                          : m,
                      ),
                    );
                  }
                  break;

                case "tool_result":
                  if (currentToolId) {
                    setMessages((prev) =>
                      prev.map((m) =>
                        m.id === currentToolId
                          ? {
                              ...m,
                              toolCall: {
                                ...m.toolCall!,
                                status: data.success ? "success" : "error",
                                error: data.error,
                              },
                            }
                          : m,
                      ),
                    );
                  }
                  if (data.success && data.output) {
                    onTypstOutput(data.output);
                  } else if (!data.success) {
                    onTypstOutput({ code: data.code, error: data.error });
                  }
                  currentToolId = null;
                  break;

                case "done":
                  setMessages((prev) =>
                    prev.map((m) =>
                      m.id === assistantId ? { ...m, isStreaming: false } : m,
                    ),
                  );
                  break;

                case "error":
                  setMessages((prev) =>
                    prev.map((m) =>
                      m.id === assistantId
                        ? {
                            ...m,
                            content: `Error: ${data.error}`,
                            isStreaming: false,
                          }
                        : m,
                    ),
                  );
                  break;
              }
            }
          }
        }
      }
    } catch (error) {
      if ((error as Error).name !== "AbortError") {
        console.error("Error sending message:", error);
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? {
                  ...m,
                  content: "Sorry, there was an error processing your request.",
                  isStreaming: false,
                }
              : m,
          ),
        );
      }
    } finally {
      setIsLoading(false);
      abortControllerRef.current = null;
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
            {message.role === "tool" && message.toolCall && (
              <ToolCallDisplay toolCall={message.toolCall} />
            )}
            {message.role !== "tool" && (
              <div
                className={`message-content ${message.isStreaming ? "streaming" : ""}`}
              >
                <ReactMarkdown>
                  {message.content || (message.isStreaming ? "..." : "")}
                </ReactMarkdown>
              </div>
            )}
          </div>
        ))}

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
          {isLoading ? "Generating..." : "Send"}
        </button>
      </div>
    </div>
  );
}

function ToolCallDisplay({ toolCall }: { toolCall: ToolCallInfo }) {
  const [expanded, setExpanded] = useState(false);

  const statusIcon = {
    calling: "📝",
    executing: "⚙️",
    success: "✅",
    error: "❌",
  }[toolCall.status];

  const statusText = {
    calling: "Preparing document...",
    executing: "Rendering...",
    success: "Document rendered",
    error: "Rendering failed",
  }[toolCall.status];

  return (
    <div className={`tool-call ${toolCall.status}`}>
      <div className="tool-header" onClick={() => setExpanded(!expanded)}>
        <span className="tool-icon">{statusIcon}</span>
        <span className="tool-name">{statusText}</span>
        {toolCall.input?.description && (
          <span className="tool-desc">{toolCall.input.description}</span>
        )}
        <span className={`tool-expand ${expanded ? "open" : ""}`}>▶</span>
      </div>
      {expanded && toolCall.input?.code && (
        <pre className="tool-code">{toolCall.input.code}</pre>
      )}
      {toolCall.error && <div className="tool-error">{toolCall.error}</div>}
    </div>
  );
}
