import Anthropic from "@anthropic-ai/sdk";
import { renderTypst, typstToolDefinition } from "../tools/typst-renderer";
import type { ConversationRequest, TypstOutput } from "../types";
import {
  logMessage,
  generateConversationId,
  listConversations,
  getMessages,
  getConversation,
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

Always produce complete, well-structured Typst documents with appropriate page and text settings.`;

interface MessageParam {
  role: "user" | "assistant";
  content: string;
}

interface ConversationRequestWithId extends ConversationRequest {
  conversationId?: string;
}

async function handleChat(req: Request): Promise<Response> {
  try {
    const body = (await req.json()) as ConversationRequestWithId;
    const { messages } = body;
    const conversationId = body.conversationId || generateConversationId();

    // Log the user message (last one in the array)
    const lastUserMessage = messages[messages.length - 1];
    if (lastUserMessage) {
      logMessage(conversationId, "user", lastUserMessage);
    }

    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      tools: [typstToolDefinition],
      messages: messages as MessageParam[],
    });

    let assistantMessage = "";
    let typstOutput: TypstOutput | undefined;

    for (const block of response.content) {
      if (block.type === "text") {
        assistantMessage += block.text;
      } else if (block.type === "tool_use" && block.name === "render_typst") {
        const input = block.input as { code: string; description: string };

        // Log tool call
        logMessage(conversationId, "tool_call", {
          tool: "render_typst",
          input,
        });

        // Render the Typst code to PNG pages
        const renderResult = await renderTypst({
          code: input.code,
          format: "png",
        });

        // Log tool result
        logMessage(conversationId, "tool_result", {
          tool: "render_typst",
          success: renderResult.success,
          pageCount: renderResult.pages?.length,
          error: renderResult.error,
        });

        if (renderResult.success && renderResult.pages) {
          typstOutput = {
            code: input.code,
            pages: renderResult.pages.map((p) => `data:image/png;base64,${p}`),
          };

          // Also render PDF for download
          const pdfResult = await renderTypst({
            code: input.code,
            format: "pdf",
          });

          if (pdfResult.success && pdfResult.data) {
            typstOutput.pdfUrl = `data:application/pdf;base64,${pdfResult.data}`;
          }
        } else {
          typstOutput = {
            code: input.code,
            error: renderResult.error,
          };
        }

        // Get tool result response from Claude
        const toolResultResponse = await anthropic.messages.create({
          model: "claude-sonnet-4-20250514",
          max_tokens: 1024,
          system: SYSTEM_PROMPT,
          tools: [typstToolDefinition],
          messages: [
            ...(messages as MessageParam[]),
            {
              role: "assistant",
              content: response.content,
            },
            {
              role: "user",
              content: [
                {
                  type: "tool_result",
                  tool_use_id: block.id,
                  content: renderResult.success
                    ? `Document rendered successfully: ${input.description}`
                    : `Error rendering document: ${renderResult.error}`,
                },
              ],
            },
          ] as Anthropic.MessageParam[],
        });

        // Extract text from tool result response
        for (const resultBlock of toolResultResponse.content) {
          if (resultBlock.type === "text") {
            assistantMessage +=
              (assistantMessage ? "\n\n" : "") + resultBlock.text;
          }
        }
      }
    }

    // Log assistant response
    logMessage(conversationId, "assistant", {
      message: assistantMessage,
      hasTypstOutput: !!typstOutput,
      typstCode: typstOutput?.code,
      typstError: typstOutput?.error,
    });

    return Response.json({
      message: assistantMessage,
      typstOutput,
      conversationId,
    });
  } catch (error) {
    console.error("Chat error:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}

function handleListConversations(req: Request): Response {
  const url = new URL(req.url);
  const limit = parseInt(url.searchParams.get("limit") || "50");
  const offset = parseInt(url.searchParams.get("offset") || "0");

  const conversations = listConversations(limit, offset);
  return Response.json({ conversations });
}

function handleGetConversation(conversationId: string): Response {
  const conversation = getConversation(conversationId);
  if (!conversation) {
    return Response.json({ error: "Conversation not found" }, { status: 404 });
  }

  const messages = getMessages(conversationId);
  return Response.json({ conversation, messages });
}

const PORT = process.env.PORT || 3000;

const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);

    // API routes
    if (url.pathname === "/api/chat" && req.method === "POST") {
      return handleChat(req);
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

    let filePath = url.pathname === "/" ? "/index.html" : url.pathname;
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
