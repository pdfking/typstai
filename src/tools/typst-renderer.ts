import { join } from "path";
import { tmpdir } from "os";
import { readdir, unlink, mkdir } from "fs/promises";

const TEMP_DIR = join(tmpdir(), "typstai");

async function ensureTempDir(): Promise<void> {
  await mkdir(TEMP_DIR, { recursive: true });
}

export interface TypstRenderRequest {
  code: string;
  format: "pdf" | "png" | "svg";
}

export interface TypstRenderResponse {
  success: boolean;
  data?: string; // base64 encoded (single file for PDF)
  pages?: string[]; // base64/svg pages
  mimeType?: string;
  error?: string;
}

export async function renderTypst(
  request: TypstRenderRequest,
): Promise<TypstRenderResponse> {
  await ensureTempDir();

  const id = crypto.randomUUID();
  const inputPath = join(TEMP_DIR, `${id}.typ`);

  // For multi-page formats, typst outputs {name}-{page}.ext pattern
  const isMultiPage = request.format === "png" || request.format === "svg";
  const outputPath = isMultiPage
    ? join(TEMP_DIR, `${id}-{n}.${request.format}`)
    : join(TEMP_DIR, `${id}.${request.format}`);

  try {
    // Validate input
    if (!request.code || request.code.trim() === "") {
      return { success: false, error: "No Typst code provided" };
    }

    // Write Typst source to temp file
    await Bun.write(inputPath, request.code);

    // Run typst compile
    const proc = Bun.spawn(["typst", "compile", inputPath, outputPath], {
      stderr: "pipe",
    });

    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;

    if (exitCode !== 0) {
      return {
        success: false,
        error: stderr || `Typst exited with code ${exitCode}`,
      };
    }

    const mimeTypes: Record<string, string> = {
      pdf: "application/pdf",
      png: "image/png",
      svg: "image/svg+xml",
    };

    if (isMultiPage) {
      // Read all page files
      const files = await readdir(TEMP_DIR);
      const ext = request.format;
      const pageFiles = files
        .filter((f) => f.startsWith(`${id}-`) && f.endsWith(`.${ext}`))
        .sort((a, b) => {
          const regex = new RegExp(`-(\\d+)\\.${ext}$`);
          const numA = parseInt(a.match(regex)?.[1] || "0");
          const numB = parseInt(b.match(regex)?.[1] || "0");
          return numA - numB;
        });

      const pages: string[] = [];
      for (const pageFile of pageFiles) {
        const pagePath = join(TEMP_DIR, pageFile);
        if (request.format === "svg") {
          // SVG is text, read as string
          const svgContent = await Bun.file(pagePath).text();
          pages.push(svgContent);
        } else {
          // PNG is binary, base64 encode
          const pageData = await Bun.file(pagePath).arrayBuffer();
          pages.push(Buffer.from(pageData).toString("base64"));
        }
        await unlink(pagePath);
      }

      await unlink(inputPath);

      return {
        success: true,
        pages,
        mimeType: mimeTypes[request.format],
      };
    } else {
      // Single file output (PDF)
      const actualOutputPath = join(TEMP_DIR, `${id}.${request.format}`);
      const outputData = await Bun.file(actualOutputPath).arrayBuffer();
      const base64 = Buffer.from(outputData).toString("base64");

      await unlink(inputPath);
      await unlink(actualOutputPath);

      return {
        success: true,
        data: base64,
        mimeType: mimeTypes[request.format],
      };
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

// Tool definition for Claude
export const typstToolDefinition = {
  name: "render_typst",
  description: `Render Typst markup code to PDF or image. Use this tool to create documents, reports, academic papers, invoices, resumes, or any formatted content. Typst is a modern typesetting system similar to LaTeX but with simpler syntax.

Example Typst code:
\`\`\`typst
#set page(paper: "a4")
#set text(font: "New Computer Modern", size: 11pt)

= My Document Title

This is a paragraph with *bold* and _italic_ text.

== Section One

#table(
  columns: (1fr, 1fr),
  [Header 1], [Header 2],
  [Cell 1], [Cell 2],
)
\`\`\`

Always produce complete, valid Typst documents.`,
  input_schema: {
    type: "object" as const,
    properties: {
      code: {
        type: "string",
        description: "The Typst markup code to render",
      },
      description: {
        type: "string",
        description: "Brief description of what this document contains",
      },
    },
    required: ["code", "description"],
  },
};
