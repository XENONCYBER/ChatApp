import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Search, MessageSquare, PanelLeftClose, PanelLeftOpen, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import type { ChatData } from '../types/chat';

interface SidebarProps {
  chats: ChatData[];
  selectedChatId: string | null;
  onSelectChat: (id: string) => void;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  selectedFilter: string;
  onFilterChange: (filter: string) => void;
  width: number;
  onWidthChange: (width: number) => void;
  minWidth: number;
  maxWidth: number;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  onDeleteChat: (id: string) => void;
  onRenameChat: (id: string, newTitle: string) => void;
  isLoading?: boolean;
}

const FILTERS = ['all', 'claude', 'chatgpt', 'gemini'] as const;

const MENU_WIDTH = 152;

export const Sidebar: React.FC<SidebarProps> = ({
  chats,
  selectedChatId,
  onSelectChat,
  searchQuery,
  onSearchChange,
  selectedFilter,
  onFilterChange,
  width,
  onWidthChange,
  minWidth,
  maxWidth,
  isCollapsed,
  onToggleCollapse,
  onDeleteChat,
  onRenameChat,
  isLoading = false,
}) => {
  const [isResizing, setIsResizing] = useState(false);
  const sidebarRef = useRef<HTMLElement | null>(null);

  /* --- Chat-item popover menu ------------------------------------------ */
  const [menuChatId, setMenuChatId] = useState<string | null>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const commitRenameRef = useRef(false);

  const openMenu = useCallback((e: React.MouseEvent<HTMLButtonElement>, id: string) => {
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    // Keep the menu inside the window; it is `position: fixed` so the
    // sidebar's overflow never clips it.
    const left = Math.min(rect.left, window.innerWidth - MENU_WIDTH - 8);
    setMenuPos({ top: rect.bottom + 6, left });
    setMenuChatId(id);
  }, []);

  const closeMenu = useCallback(() => {
    setMenuChatId(null);
    setMenuPos(null);
  }, []);

  // Close the menu on any outside interaction (Escape, scroll, click).
  useEffect(() => {
    if (!menuChatId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeMenu();
    };
    const onPointer = (e: PointerEvent) => {
      if (e.button !== 0) return;
      const el = e.target as HTMLElement | null;
      if (el?.closest('.chat-item-menu')) return;
      closeMenu();
    };
    const onScroll = () => closeMenu();
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    document.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('scroll', onScroll, true);
    };
  }, [menuChatId, closeMenu]);

  const startRename = useCallback(
    (id: string, currentTitle: string) => {
      closeMenu();
      commitRenameRef.current = false;
      setRenameValue(currentTitle);
      setRenamingId(id);
    },
    [closeMenu]
  );

  const commitRename = useCallback(
    (id: string) => {
      commitRenameRef.current = true;
      setRenamingId(null);
      const next = renameValue.trim();
      if (!next) return;
      const chat = chats.find((c) => c.id === id);
      if (chat && next !== chat.title) onRenameChat(id, next);
    },
    [chats, onRenameChat, renameValue]
  );

  const handleDeleteFromMenu = useCallback(
    (chat: ChatData) => {
      closeMenu();
      const confirmed = window.confirm(
        `Delete "${chat.title}"?\n\nThis permanently removes the chat file from the chats directory. This cannot be undone.`
      );
      if (confirmed) onDeleteChat(chat.id);
    },
    [closeMenu, onDeleteChat]
  );

  /* --- Resizing ---------------------------------------------------------
     Uses Pointer Events with capture so the drag keeps tracking even when
     the cursor leaves the 6px handle, and listeners only exist while a
     drag is actually in progress. */
  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    setIsResizing(true);
  }, []);

  useEffect(() => {
    if (!isResizing) return;

    const onMove = (e: PointerEvent) => {
      // Measure from the sidebar's own left edge so the handle stays under
      // the cursor even if the layout is offset.
      const left = sidebarRef.current?.getBoundingClientRect().left ?? 0;
      onWidthChange(e.clientX - left);
    };
    const stop = () => setIsResizing(false);

    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', stop);
    document.addEventListener('pointercancel', stop);

    // Suppress text selection and keep the resize cursor during the drag.
    const prevCursor = document.body.style.cursor;
    const prevSelect = document.body.style.userSelect;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    return () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', stop);
      document.removeEventListener('pointercancel', stop);
      document.body.style.cursor = prevCursor;
      document.body.style.userSelect = prevSelect;
    };
  }, [isResizing, onWidthChange]);

  // Keyboard resizing for accessibility.
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      const step = e.shiftKey ? 40 : 10;
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        onWidthChange(width - step);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        onWidthChange(width + step);
      }
    },
    [width, onWidthChange]
  );

  const filteredChats = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return chats.filter((chat) => {
      const matchesFilter =
        selectedFilter === 'all' || (chat.site || '').toLowerCase() === selectedFilter;
      if (!matchesFilter) return false;
      if (!q) return true;
      return (
        (chat.title || '').toLowerCase().includes(q) ||
        chat.messages.some((m) => m.content.toLowerCase().includes(q))
      );
    });
  }, [chats, searchQuery, selectedFilter]);

  function formatDate(timestamp: string) {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    if (isNaN(date.getTime())) return timestamp;
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  if (isCollapsed) {
    return (
      <aside className="sidebar collapsed">
        <button
          className="icon-btn"
          onClick={onToggleCollapse}
          title="Expand sidebar"
          aria-label="Expand sidebar"
        >
          <PanelLeftOpen size={16} />
        </button>
      </aside>
    );
  }

  return (
    <aside
      ref={sidebarRef}
      className={`sidebar${isResizing ? ' resizing' : ''}`}
      style={{ width }}
    >
      <div className="sidebar-header">
        <div className="brand">
          <div className="brand-left">
            <div className="brand-icon">
              <MessageSquare size={18} />
            </div>
            <span className="brand-title">Chattie</span>
          </div>
          <button
            className="icon-btn"
            onClick={onToggleCollapse}
            title="Collapse sidebar"
            aria-label="Collapse sidebar"
          >
            <PanelLeftClose size={16} />
          </button>
        </div>

        <div className="search-box">
          <Search size={14} className="search-icon" />
          <input
            type="text"
            className="search-input"
            placeholder="Search chats..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            aria-label="Search chats"
          />
        </div>

        <div className="filter-pills">
          {FILTERS.map((f) => (
            <button
              key={f}
              className={`filter-pill ${selectedFilter === f ? 'active' : ''}`}
              onClick={() => onFilterChange(f)}
              aria-pressed={selectedFilter === f}
            >
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>
      </div>

      <div className="chat-list">
        {filteredChats.length === 0 ? (
          <div className="no-chats">
            {isLoading
              ? 'Loading chats…'
              : chats.length === 0
              ? 'No saved chats found in /chats'
              : 'No matching chats found'}
          </div>
        ) : (
          filteredChats.map((chat) => {
            const isRenaming = renamingId === chat.id;
            return (
              <div
                key={chat.id}
                className={`chat-item ${selectedChatId === chat.id ? 'active' : ''}${isRenaming ? ' renaming' : ''}`}
              >
                {isRenaming ? (
                  <input
                    className="rename-input"
                    type="text"
                    autoFocus
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        commitRename(chat.id);
                      } else if (e.key === 'Escape') {
                        commitRenameRef.current = true;
                        setRenamingId(null);
                      }
                    }}
                    onBlur={() => {
                      if (!commitRenameRef.current) setRenamingId(null);
                    }}
                    aria-label="Rename chat"
                  />
                ) : (
                  <>
                    <button
                      type="button"
                      className="chat-item-select"
                      onClick={() => onSelectChat(chat.id)}
                      aria-current={selectedChatId === chat.id}
                    >
                      <span className="chat-item-title">{chat.title || 'Untitled Chat'}</span>
                      <span className="chat-item-meta">
                        <span className={`site-dot ${chat.site || 'unknown'}`} />
                        <span className="chat-item-site">{chat.site || 'unknown'}</span>
                        <span className="dot-sep">·</span>
                        <span>{formatDate(chat.timestamp)}</span>
                      </span>
                    </button>
                    <button
                      type="button"
                      className="chat-item-menu-btn"
                      onClick={(e) => openMenu(e, chat.id)}
                      aria-label={`Options for ${chat.title || 'chat'}`}
                      aria-haspopup="menu"
                      aria-expanded={menuChatId === chat.id}
                    >
                      <MoreHorizontal size={15} />
                    </button>
                  </>
                )}
              </div>
            );
          })
        )}
      </div>

      {menuChatId && menuPos && (
        <div className="chat-item-menu" role="menu" style={{ top: menuPos.top, left: menuPos.left }}>
          <button
            type="button"
            className="menu-item"
            role="menuitem"
            onClick={() => {
              const chat = chats.find((c) => c.id === menuChatId);
              if (chat) startRename(chat.id, chat.title || '');
            }}
          >
            <Pencil size={14} />
            <span>Rename</span>
          </button>
          <button
            type="button"
            className="menu-item danger"
            role="menuitem"
            onClick={() => {
              const chat = chats.find((c) => c.id === menuChatId);
              if (chat) handleDeleteFromMenu(chat);
            }}
          >
            <Trash2 size={14} />
            <span>Delete</span>
          </button>
        </div>
      )}

      <div
        className="sidebar-resizer"
        onPointerDown={handlePointerDown}
        onKeyDown={handleKeyDown}
        onDoubleClick={() => onWidthChange(320)}
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize sidebar"
        aria-valuenow={width}
        aria-valuemin={minWidth}
        aria-valuemax={maxWidth}
        tabIndex={0}
        title="Drag to resize · double-click to reset"
      />
    </aside>
  );
};
