import Anthropic from "@anthropic-ai/sdk";
import { renderTypst, typstToolDefinition } from "../tools/typst-renderer";
import type { TypstOutput } from "../types";
import {
  logMessage,
  generateConversationId,
  listConversations,
  getMessages,
  getConversation,
  updateConversationTypst,
} from "../lib/database";
import { join } from "path";

const anthropic = new Anthropic();

const SYSTEM_PROMPT = `You are a specialized assistant for creating PDF documents using Typst, a modern typesetting system.

Your role is to help users create beautifully formatted documents including:
- Reports and academic papers
- Resumes and CVs
- Invoices and business documents
- Letters and memos
- Presentations
- Any formatted text content

When the user asks you to create a document:
1. Understand their requirements
2. Use the render_typst tool to generate the document
3. Explain what you created

Typst syntax quick reference:
- Headings: = Level 1, == Level 2, etc.
- Bold: *text*
- Italic: _text_
- Lists: - item or + numbered
- Code: \`inline\` or \`\`\`block\`\`\`
- Math: $equation$ inline or $ equation $ display
- Functions: #function-name(args)
- Set rules: #set element(property: value)
- Tables: #table(columns: (...), [...cells])
- Images: #image("path.png")
- Page setup: #set page(paper: "a4", margin: 2cm)
- Text setup: #set text(font: "...", size: 11pt)

IMPORTANT escaping rules:
- @ symbol creates label references in Typst. For email addresses or social handles, escape with backslash: user\\@domain.com or \\@username
- < and > create labels. Escape as \\< and \\> when needed literally
- # starts function calls. In regular text use \\#

Always produce complete, well-structured Typst documents with appropriate page and text settings.`;

interface MessageParam {
  role: "user" | "assistant";
  content: string;
}

interface ConversationRequest {
  messages: { role: "user" | "assistant"; content: string }[];
  conversationId?: string;
}

async function handleChatStream(req: Request): Promise<Response> {
  const body = (await req.json()) as ConversationRequest;
  const { messages } = body;
  const conversationId = body.conversationId || generateConversationId();

  // Log the user message
  const lastUserMessage = messages[messages.length - 1];
  if (lastUserMessage) {
    logMessage(conversationId, "user", lastUserMessage);
  }

  const encoder = new TextEncoder();
  let controllerClosed = false;

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        if (controllerClosed) return;
        try {
          controller.enqueue(
            encoder.encode(
              `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`,
            ),
          );
        } catch {
          // Controller may be closed
        }
      };

      const close = () => {
        if (!controllerClosed) {
          controllerClosed = true;
          try {
            controller.close();
          } catch {
            // Already closed
          }
        }
      };

      try {
        // Send conversation ID immediately
        send("conversation_id", { conversationId });

        let currentText = "";
        let typstOutput: TypstOutput | undefined;

        // First API call
        const response = await anthropic.messages.create({
          model: "claude-sonnet-4-20250514",
          max_tokens: 4096,
          system: SYSTEM_PROMPT,
          tools: [typstToolDefinition],
          messages: messages as MessageParam[],
          stream: true,
        });

        let toolUseId = "";
        let toolName = "";
        let toolInput = "";

        for await (const event of response) {
          if (event.type === "content_block_start") {
            if (event.content_block.type === "text") {
              // Text block starting
            } else if (event.content_block.type === "tool_use") {
              toolUseId = event.content_block.id;
              toolName = event.content_block.name;
              toolInput = "";
              send("tool_start", { tool: toolName, id: toolUseId });
            }
          } else if (event.type === "content_block_delta") {
            if (event.delta.type === "text_delta") {
              currentText += event.delta.text;
              send("text", { text: event.delta.text });
            } else if (event.delta.type === "input_json_delta") {
              toolInput += event.delta.partial_json;
            }
          } else if (event.type === "content_block_stop") {
            // If we were building a tool use, execute it now
            if (toolName && toolInput) {
              let input: { code: string; description: string };
              try {
                input = JSON.parse(toolInput);
              } catch {
                input = { code: "", description: "" };
              }

              // Log tool call
              logMessage(conversationId, "tool_call", {
                tool: toolName,
                input,
              });

              send("tool_input", { tool: toolName, input });
              send("tool_executing", { tool: toolName });

              // Execute the tool
              const renderResult = await renderTypst({
                code: input.code,
                format: "png",
              });

              // Log tool result
              logMessage(conversationId, "tool_result", {
                tool: toolName,
                success: renderResult.success,
                pageCount: renderResult.pages?.length,
                error: renderResult.error,
              });

              if (renderResult.success && renderResult.pages) {
                const pages = renderResult.pages.map(
                  (p) => `data:image/png;base64,${p}`,
                );
                typstOutput = { code: input.code, pages };

                // Save to DB
                updateConversationTypst(conversationId, input.code, pages);

                // Render PDF
                const pdfResult = await renderTypst({
                  code: input.code,
                  format: "pdf",
                });

                if (pdfResult.success && pdfResult.data) {
                  typstOutput.pdfUrl = `data:application/pdf;base64,${pdfResult.data}`;
                }

                send("tool_result", {
                  tool: toolName,
                  success: true,
                  output: typstOutput,
                });
              } else {
                typstOutput = { code: input.code, error: renderResult.error };
                send("tool_result", {
                  tool: toolName,
                  success: false,
                  error: renderResult.error,
                  code: input.code,
                });
              }

              // Reset for next tool
              toolName = "";
              toolInput = "";
            }
          } else if (event.type === "message_stop") {
            // Message complete
          }
        }

        // Check if we need a follow-up for tool result
        if (toolUseId && typstOutput) {
          send("assistant_continue", {});

          const followUpResponse = await anthropic.messages.create({
            model: "claude-sonnet-4-20250514",
            max_tokens: 1024,
            system: SYSTEM_PROMPT,
            tools: [typstToolDefinition],
            messages: [
              ...(messages as MessageParam[]),
              {
                role: "assistant",
                content: [
                  ...(currentText
                    ? [{ type: "text" as const, text: currentText }]
                    : []),
                  {
                    type: "tool_use" as const,
                    id: toolUseId,
                    name: "render_typst",
                    input: JSON.parse(toolInput || "{}"),
                  },
                ],
              },
              {
                role: "user",
                content: [
                  {
                    type: "tool_result" as const,
                    tool_use_id: toolUseId,
                    content: typstOutput.error
                      ? `Error: ${typstOutput.error}`
                      : "Document rendered successfully",
                  },
                ],
              },
            ],
            stream: true,
          });

          for await (const event of followUpResponse) {
            if (
              event.type === "content_block_delta" &&
              event.delta.type === "text_delta"
            ) {
              currentText += event.delta.text;
              send("text", { text: event.delta.text });
            }
          }
        }

        // Log final assistant message
        logMessage(conversationId, "assistant", {
          message: currentText,
          hasTypstOutput: !!typstOutput,
          typstCode: typstOutput?.code,
          typstError: typstOutput?.error,
        });

        send("done", { message: currentText });
        close();
      } catch (error) {
        console.error("Stream error:", error);
        send("error", {
          error: error instanceof Error ? error.message : "Unknown error",
        });
        close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

function handleListConversations(req: Request): Response {
  const url = new URL(req.url);
  const limit = parseInt(url.searchParams.get("limit") || "50");
  const offset = parseInt(url.searchParams.get("offset") || "0");

  const conversations = listConversations(limit, offset);
  return Response.json({ conversations });
}

async function handleGetConversation(
  conversationId: string,
): Promise<Response> {
  const conversation = getConversation(conversationId);
  if (!conversation) {
    return Response.json({ error: "Conversation not found" }, { status: 404 });
  }

  const messages = getMessages(conversationId);

  // Parse typst_pages and regenerate PDF if present
  let typstOutput = null;
  if (conversation.typst_code && conversation.typst_pages) {
    typstOutput = {
      code: conversation.typst_code,
      pages: JSON.parse(conversation.typst_pages),
    };

    // Regenerate PDF for download
    const pdfResult = await renderTypst({
      code: conversation.typst_code,
      format: "pdf",
    });

    if (pdfResult.success && pdfResult.data) {
      typstOutput.pdfUrl = `data:application/pdf;base64,${pdfResult.data}`;
    }
  }

  return Response.json({
    conversation: {
      id: conversation.id,
      created_at: conversation.created_at,
      updated_at: conversation.updated_at,
      title: conversation.title,
    },
    messages,
    typstOutput,
  });
}

const PORT = process.env.PORT || 3000;

const server = Bun.serve({
  port: PORT,
  idleTimeout: 120, // 2 minutes for long renders
  async fetch(req) {
    const url = new URL(req.url);

    // API routes
    if (url.pathname === "/api/chat" && req.method === "POST") {
      return handleChatStream(req);
    }

    if (url.pathname === "/api/conversations" && req.method === "GET") {
      return handleListConversations(req);
    }

    if (
      url.pathname.startsWith("/api/conversations/") &&
      req.method === "GET"
    ) {
      const conversationId = url.pathname.replace("/api/conversations/", "");
      return handleGetConversation(conversationId);
    }

    if (url.pathname === "/api/health") {
      return Response.json({ status: "ok" });
    }

    // Serve static files
    const publicDir = join(import.meta.dir, "../../public");

    // For SPA routing, serve index.html for /c/* paths
    let filePath = url.pathname;
    if (filePath === "/" || filePath.startsWith("/c/")) {
      filePath = "/index.html";
    }

    const file = Bun.file(join(publicDir, filePath));

    if (await file.exists()) {
      return new Response(file);
    }

    // SPA fallback
    const indexFile = Bun.file(join(publicDir, "index.html"));
    if (await indexFile.exists()) {
      return new Response(indexFile);
    }

    return new Response("Not Found", { status: 404 });
  },
});

console.log(`Server running on http://localhost:${server.port}`);
