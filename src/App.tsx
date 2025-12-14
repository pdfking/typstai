import { useState, useEffect } from "react";
import { ChatSidebar } from "./components/ChatSidebar";
import { DocumentPreview } from "./components/DocumentPreview";
import { ConversationList } from "./components/ConversationList";
import type { TypstOutput } from "./types";

function getConversationIdFromUrl(): string | null {
  const match = window.location.pathname.match(/^\/c\/(.+)$/);
  return match ? match[1] : null;
}

export function App() {
  const [currentOutput, setCurrentOutput] = useState<TypstOutput | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(
    getConversationIdFromUrl(),
  );
  const [showHistory, setShowHistory] = useState(false);

  // Handle browser navigation
  useEffect(() => {
    const handlePopState = () => {
      const id = getConversationIdFromUrl();
      setConversationId(id);
      if (!id) {
        setCurrentOutput(null);
      }
    };

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  const handleConversationChange = (id: string | null) => {
    setConversationId(id);
    if (id) {
      window.history.pushState({}, "", `/c/${id}`);
    } else {
      window.history.pushState({}, "", "/");
      setCurrentOutput(null);
    }
  };

  const handleSelectConversation = (id: string) => {
    handleConversationChange(id);
    setShowHistory(false);
  };

  const handleNewChat = () => {
    handleConversationChange(null);
    setShowHistory(false);
  };

  return (
    <div className="app">
      <ChatSidebar
        conversationId={conversationId}
        onConversationChange={handleConversationChange}
        onTypstOutput={setCurrentOutput}
        onShowHistory={() => setShowHistory(true)}
        onNewChat={handleNewChat}
      />
      <main className="main-content">
        <DocumentPreview output={currentOutput} />
      </main>

      {showHistory && (
        <ConversationList
          onSelect={handleSelectConversation}
          onClose={() => setShowHistory(false)}
          currentId={conversationId}
        />
      )}
    </div>
  );
}
