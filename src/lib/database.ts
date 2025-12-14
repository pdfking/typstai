import { Database } from "bun:sqlite";
import { join } from "path";

const DB_PATH = join(import.meta.dir, "../../data/typstai.db");

// Ensure data directory exists
await Bun.write(join(import.meta.dir, "../../data/.gitkeep"), "");

const db = new Database(DB_PATH, { create: true });

// Initialize schema
db.run(`
  CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    title TEXT,
    typst_code TEXT,
    typst_pages TEXT
  )
`);

db.run(`
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id TEXT NOT NULL,
    source TEXT NOT NULL CHECK (source IN ('user', 'assistant', 'tool_call', 'tool_result')),
    content TEXT NOT NULL,
    timestamp TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (conversation_id) REFERENCES conversations(id)
  )
`);

db.run(`
  CREATE INDEX IF NOT EXISTS idx_messages_conversation
  ON messages(conversation_id)
`);

db.run(`
  CREATE INDEX IF NOT EXISTS idx_messages_timestamp
  ON messages(timestamp)
`);

// Migration: add typst columns if they don't exist
try {
  db.run(`ALTER TABLE conversations ADD COLUMN typst_code TEXT`);
} catch {
  /* column exists */
}

try {
  db.run(`ALTER TABLE conversations ADD COLUMN typst_pages TEXT`);
} catch {
  /* column exists */
}

export type MessageSource = "user" | "assistant" | "tool_call" | "tool_result";

export interface Conversation {
  id: string;
  created_at: string;
  updated_at: string;
  title: string | null;
  typst_code: string | null;
  typst_pages: string | null; // JSON array of base64 pages
}

export interface Message {
  id: number;
  conversation_id: string;
  source: MessageSource;
  content: string;
  timestamp: string;
}

export function generateConversationId(): string {
  const now = new Date();
  const dateStr = now.toISOString().split("T")[0];
  const timeStr = now.toTimeString().split(" ")[0].replace(/:/g, "-");
  const random = Math.random().toString(36).substring(2, 8);
  return `${dateStr}_${timeStr}_${random}`;
}

export function createConversation(id: string, title?: string): Conversation {
  const stmt = db.prepare(`
    INSERT INTO conversations (id, title) VALUES (?, ?)
    RETURNING *
  `);
  return stmt.get(id, title || null) as Conversation;
}

export function getConversation(id: string): Conversation | null {
  const stmt = db.prepare("SELECT * FROM conversations WHERE id = ?");
  return stmt.get(id) as Conversation | null;
}

export function updateConversationTitle(id: string, title: string): void {
  const stmt = db.prepare(`
    UPDATE conversations SET title = ?, updated_at = datetime('now') WHERE id = ?
  `);
  stmt.run(title, id);
}

export function updateConversationTypst(
  id: string,
  code: string,
  pages: string[],
): void {
  const stmt = db.prepare(`
    UPDATE conversations SET typst_code = ?, typst_pages = ?, updated_at = datetime('now') WHERE id = ?
  `);
  stmt.run(code, JSON.stringify(pages), id);
}

export function listConversations(limit = 50, offset = 0): Conversation[] {
  const stmt = db.prepare(`
    SELECT id, created_at, updated_at, title FROM conversations
    ORDER BY updated_at DESC
    LIMIT ? OFFSET ?
  `);
  return stmt.all(limit, offset) as Conversation[];
}

export function logMessage(
  conversationId: string,
  source: MessageSource,
  content: unknown,
): Message {
  // Ensure conversation exists
  if (!getConversation(conversationId)) {
    createConversation(conversationId);
  }

  const contentStr =
    typeof content === "string" ? content : JSON.stringify(content);

  const stmt = db.prepare(`
    INSERT INTO messages (conversation_id, source, content)
    VALUES (?, ?, ?)
    RETURNING *
  `);
  const message = stmt.get(conversationId, source, contentStr) as Message;

  // Update conversation timestamp
  db.prepare(
    `
    UPDATE conversations SET updated_at = datetime('now') WHERE id = ?
  `,
  ).run(conversationId);

  return message;
}

export function getMessages(conversationId: string): Message[] {
  const stmt = db.prepare(`
    SELECT * FROM messages
    WHERE conversation_id = ?
    ORDER BY timestamp ASC
  `);
  return stmt.all(conversationId) as Message[];
}

export function getRecentMessages(limit = 100): Message[] {
  const stmt = db.prepare(`
    SELECT * FROM messages
    ORDER BY timestamp DESC
    LIMIT ?
  `);
  return stmt.all(limit) as Message[];
}

export { db };
