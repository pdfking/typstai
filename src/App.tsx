import { useState } from "react";
import { ChatSidebar } from "./components/ChatSidebar";
import { DocumentPreview } from "./components/DocumentPreview";
import type { TypstOutput } from "./types";

export function App() {
  const [currentOutput, setCurrentOutput] = useState<TypstOutput | null>(null);

  return (
    <div className="app">
      <ChatSidebar onTypstOutput={setCurrentOutput} />
      <main className="main-content">
        <DocumentPreview output={currentOutput} />
      </main>
    </div>
  );
}
