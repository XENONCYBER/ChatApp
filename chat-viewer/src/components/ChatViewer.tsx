import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { MessageSquare, AlertTriangle, BookmarkPlus, Bookmark as BookmarkIcon, X } from 'lucide-react';
import type { ChatData, Bookmark } from '../types/chat';
import { MessageBubble } from './MessageBubble';
import { ContinueChatBtn } from './ContinueChatBtn';

interface ChatViewerProps {
  chat: ChatData | null;
  error?: string | null;
  isLoading?: boolean;
  bookmarks: Bookmark[];
  onAddBookmark: (bookmark: Omit<Bookmark, 'id' | 'createdAt'>) => void;
  onRemoveBookmark: (id: string) => void;
}

const SITE_DISPLAY_NAMES: Record<string, string> = {
  claude: 'Claude',
  chatgpt: 'ChatGPT',
  gemini: 'Gemini',
};

function formatDate(timestamp: string) {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  if (isNaN(date.getTime())) return timestamp;
  return date.toLocaleString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function ChatViewerBase({
  chat,
  error,
  isLoading,
  bookmarks,
  onAddBookmark,
  onRemoveBookmark,
}: ChatViewerProps) {
  const [showBookmarkTooltip, setShowBookmarkTooltip] = useState(false);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });
  const [selectedText, setSelectedText] = useState('');
  const [selectedMsgIndex, setSelectedMsgIndex] = useState(-1);
  const [showBookmarkPanel, setShowBookmarkPanel] = useState(false);
  
  const messagesRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  const [showMinimapList, setShowMinimapList] = useState(false);
  const [hoveredPromptIdx, setHoveredPromptIdx] = useState(-1);

  // Extract user prompts for the minimap
  const userPrompts = useMemo(() => {
    if (!chat) return [];
    return chat.messages
      .map((msg, index) => ({ ...msg, msgIndex: index }))
      .filter((msg) => msg.role === 'user');
  }, [chat]);

  // Handle text selection → show "Bookmark" floating button
  const handleMouseUp = useCallback(() => {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !chat) {
      setShowBookmarkTooltip(false);
      return;
    }

    const text = selection.toString().trim();
    if (!text || text.length < 3) {
      setShowBookmarkTooltip(false);
      return;
    }

    // Find which message index the selection is inside
    const anchorNode = selection.anchorNode;
    if (!anchorNode) return;

    const messageEl = (anchorNode instanceof Element ? anchorNode : anchorNode.parentElement)
      ?.closest('[data-msg-index]');
    if (!messageEl) {
      setShowBookmarkTooltip(false);
      return;
    }

    const msgIndex = parseInt(messageEl.getAttribute('data-msg-index') || '-1', 10);
    if (msgIndex < 0) return;

    // Position the tooltip near the selection
    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    setTooltipPos({
      x: rect.left + rect.width / 2,
      y: rect.top - 8,
    });
    setSelectedText(text.length > 200 ? text.slice(0, 200) + '…' : text);
    setSelectedMsgIndex(msgIndex);
    setShowBookmarkTooltip(true);
  }, [chat]);

  // Dismiss tooltip on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (tooltipRef.current && !tooltipRef.current.contains(e.target as Node)) {
        setShowBookmarkTooltip(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleAddBookmark = useCallback(() => {
    if (!chat || selectedMsgIndex < 0 || !selectedText) return;
    onAddBookmark({
      chatId: chat.id,
      text: selectedText,
      messageIndex: selectedMsgIndex,
    });
    setShowBookmarkTooltip(false);
    window.getSelection()?.removeAllRanges();
  }, [chat, selectedMsgIndex, selectedText, onAddBookmark]);

  // Scroll to a bookmarked message or a minimap prompt
  const scrollToMessageIndex = useCallback((msgIndex: number) => {
    if (!messagesRef.current) return;
    const msgEl = messagesRef.current.querySelector(`[data-msg-index="${msgIndex}"]`);
    if (msgEl) {
      msgEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      msgEl.classList.add('bookmark-flash');
      setTimeout(() => msgEl.classList.remove('bookmark-flash'), 1500);
    }
  }, []);

  const scrollToBookmark = useCallback((bookmark: Bookmark) => {
    scrollToMessageIndex(bookmark.messageIndex);
    setShowBookmarkPanel(false);
  }, [scrollToMessageIndex]);

  if (error && !chat) {
    return (
      <div className="main-view">
        <div className="empty-view">
          <AlertTriangle className="empty-icon" />
          <p>{error}</p>
          <p>
            Start it with <code>npm run dev</code>, or free the port with{' '}
            <code>npm run kill-port</code>.
          </p>
        </div>
      </div>
    );
  }

  if (!chat) {
    return (
      <div className="main-view">
        <div className="empty-view">
          <MessageSquare className="empty-icon" />
          <p>{isLoading ? 'Loading chats…' : 'Select a chat from the sidebar to view'}</p>
        </div>
      </div>
    );
  }

  const siteDisplayName = SITE_DISPLAY_NAMES[chat.site] || chat.site || 'Unknown';
  const messageCount = chat.messages.length;

  return (
    <div className="main-view has-minimap">
      <div className="view-header">
        <div className="view-header-info">
          <h2 className="view-header-title">{chat.title || 'Untitled Chat'}</h2>
          <div className="view-header-details">
            <span className={`site-dot ${chat.site || 'unknown'}`} />
            <span>{siteDisplayName}</span>
            <span className="dot-sep">·</span>
            <span>
              {messageCount} {messageCount === 1 ? 'message' : 'messages'}
            </span>
            {chat.timestamp && (
              <>
                <span className="dot-sep">·</span>
                <span>Exported {formatDate(chat.timestamp)}</span>
              </>
            )}
          </div>
        </div>

        <div className="view-header-actions">
          <button
            className={`btn btn-ghost bookmark-header-btn ${bookmarks.length > 0 ? 'has-bookmarks' : ''}`}
            onClick={() => setShowBookmarkPanel(!showBookmarkPanel)}
            title={`${bookmarks.length} bookmark${bookmarks.length !== 1 ? 's' : ''}`}
          >
            <BookmarkIcon size={15} />
            {bookmarks.length > 0 && (
              <span className="bookmark-count">{bookmarks.length}</span>
            )}
          </button>

          <ContinueChatBtn url={chat.url} siteName={siteDisplayName} />
        </div>
      </div>

      {showBookmarkPanel && (
        <div className="bookmark-panel">
          <div className="bookmark-panel-header">
            <span>Bookmarks ({bookmarks.length})</span>
            <button className="btn btn-ghost btn-xs" onClick={() => setShowBookmarkPanel(false)}>
              <X size={14} />
            </button>
          </div>
          {bookmarks.length === 0 ? (
            <div className="bookmark-panel-empty">
              Select text in a message and click the bookmark button to save it.
            </div>
          ) : (
            <div className="bookmark-panel-list">
              {bookmarks.map((bm) => (
                <div key={bm.id} className="bookmark-item">
                  <button
                    className="bookmark-item-text"
                    onClick={() => scrollToBookmark(bm)}
                    title="Click to scroll to this bookmark"
                  >
                    <span className="bookmark-item-snippet">"{bm.text}"</span>
                    <span className="bookmark-item-meta">
                      Message {bm.messageIndex + 1}
                    </span>
                  </button>
                  <button
                    className="btn btn-ghost btn-xs bookmark-remove-btn"
                    onClick={() => onRemoveBookmark(bm.id)}
                    title="Remove bookmark"
                  >
                    <X size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {error && <div className="error-banner">{error}</div>}

      <div className="messages-layout">
        <div className="messages-container" key={chat.id} ref={messagesRef} onMouseUp={handleMouseUp}>
          {messageCount === 0 ? (
            <div className="no-chats">
              No messages could be parsed from <code>{chat.filename}</code>.
            </div>
          ) : (
            chat.messages.map((msg, index) => {
              // Pass down only bookmarks relevant to this message
              const msgBookmarks = bookmarks.filter(b => b.messageIndex === index);
              
              return (
                <div key={`${chat.id}-${index}`} data-msg-index={index}>
                  <MessageBubble
                    message={msg}
                    siteName={siteDisplayName}
                    msgIndex={index}
                    bookmarks={msgBookmarks}
                  />
                </div>
              );
            })
          )}
        </div>

        {/* ChatGPT-style Minimap */}
        {userPrompts.length > 0 && (
          <div 
            className="chat-minimap-container"
            onMouseEnter={() => setShowMinimapList(true)}
            onMouseLeave={() => setShowMinimapList(false)}
          >
            <div className="chat-minimap-track">
              {userPrompts.map((prompt, idx) => (
                <button
                  key={prompt.msgIndex}
                  className={`minimap-bar ${hoveredPromptIdx === idx ? 'active' : ''}`}
                  onClick={() => scrollToMessageIndex(prompt.msgIndex)}
                  onMouseEnter={() => setHoveredPromptIdx(idx)}
                  onMouseLeave={() => setHoveredPromptIdx(-1)}
                  aria-label="Scroll to user message"
                />
              ))}
            </div>
            
            {showMinimapList && (
              <div className="minimap-list-box">
                {userPrompts.map((prompt, idx) => (
                  <button
                    key={prompt.msgIndex}
                    className={`minimap-list-item ${hoveredPromptIdx === idx ? 'highlighted' : ''}`}
                    onClick={() => {
                      scrollToMessageIndex(prompt.msgIndex);
                      setShowMinimapList(false);
                    }}
                    onMouseEnter={() => setHoveredPromptIdx(idx)}
                    onMouseLeave={() => setHoveredPromptIdx(-1)}
                  >
                    {prompt.content.length > 60 
                      ? prompt.content.slice(0, 60).trim() + '...' 
                      : prompt.content.trim()}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {showBookmarkTooltip && (
        <div
          ref={tooltipRef}
          className="bookmark-tooltip"
          style={{
            left: tooltipPos.x,
            top: tooltipPos.y,
          }}
        >
          <button className="bookmark-tooltip-btn" onClick={handleAddBookmark}>
            <BookmarkPlus size={14} />
            <span>Bookmark</span>
          </button>
        </div>
      )}
    </div>
  );
}

export const ChatViewer = React.memo(ChatViewerBase);
