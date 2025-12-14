import { useState, useEffect } from 'react'

interface Conversation {
  id: string
  created_at: string
  updated_at: string
  title: string | null
}

interface ConversationListProps {
  onSelect: (id: string) => void
  onClose: () => void
  currentId: string | null
}

export function ConversationList({ onSelect, onClose, currentId }: ConversationListProps) {
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/conversations')
      .then(res => res.json())
      .then(data => {
        setConversations(data.conversations || [])
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr + 'Z')
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffMins = Math.floor(diffMs / 60000)
    const diffHours = Math.floor(diffMs / 3600000)
    const diffDays = Math.floor(diffMs / 86400000)

    if (diffMins < 1) return 'Just now'
    if (diffMins < 60) return `${diffMins}m ago`
    if (diffHours < 24) return `${diffHours}h ago`
    if (diffDays < 7) return `${diffDays}d ago`
    return date.toLocaleDateString()
  }

  return (
    <div className="conversation-overlay" onClick={onClose}>
      <div className="conversation-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Conversations</h3>
          <button className="close-btn" onClick={onClose}>×</button>
        </div>

        <div className="conversation-list">
          {loading ? (
            <div className="loading-state">Loading...</div>
          ) : conversations.length === 0 ? (
            <div className="empty-state">No conversations yet</div>
          ) : (
            conversations.map(conv => (
              <button
                key={conv.id}
                className={`conversation-item ${conv.id === currentId ? 'active' : ''}`}
                onClick={() => onSelect(conv.id)}
              >
                <div className="conversation-title">
                  {conv.title || conv.id.split('_').slice(0, 2).join(' ')}
                </div>
                <div className="conversation-time">
                  {formatDate(conv.updated_at)}
                </div>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
