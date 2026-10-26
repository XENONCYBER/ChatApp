import { useCallback, useEffect, useRef, useState } from 'react';
import { Sidebar } from './components/Sidebar';
import { ChatViewer } from './components/ChatViewer';
import type { ChatData } from './types/chat';
import { useBookmarks } from './hooks/useBookmarks';
import './styles/main.css';

const POLL_INTERVAL = 5000;
const MIN_SIDEBAR_WIDTH = 200;
const MAX_SIDEBAR_WIDTH = 600;

export function App() {
  const [chats, setChats] = useState<ChatData[]>([]);
  const [selectedChatId, setSelectedChatId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedFilter, setSelectedFilter] = useState('all');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = Number(localStorage.getItem('sidebarWidth'));
    return saved >= MIN_SIDEBAR_WIDTH && saved <= MAX_SIDEBAR_WIDTH ? saved : 320;
  });
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(
    () => localStorage.getItem('sidebarCollapsed') === 'true'
  );

  // Avoids a state update after unmount when the poll resolves late.
  const mounted = useRef(true);

  // Requests go through the Vite dev proxy (see vite.config.ts) so the
  // backend port is not hardcoded into the bundle.
  const fetchChats = useCallback(async () => {
    try {
      const res = await fetch('/api/chats');
      if (!res.ok) throw new Error(`API returned ${res.status} ${res.statusText}`);
      const data: ChatData[] = await res.json();
      if (!mounted.current) return;
      setChats(data);
      setError(null);
    } catch (err) {
      if (!mounted.current) return;
      setError(
        err instanceof Error
          ? `Cannot reach the chat API. Is the server running? (${err.message})`
          : 'Cannot reach the chat API.'
      );
    } finally {
      if (mounted.current) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    fetchChats();
    const interval = setInterval(fetchChats, POLL_INTERVAL);
    return () => {
      mounted.current = false;
      clearInterval(interval);
    };
  }, [fetchChats]);

  // Auto-select the newest chat, and recover if the selected file disappears.
  useEffect(() => {
    if (chats.length === 0) {
      if (selectedChatId !== null) setSelectedChatId(null);
      return;
    }
    if (!selectedChatId || !chats.some((c) => c.id === selectedChatId)) {
      setSelectedChatId(chats[0].id);
    }
  }, [chats, selectedChatId]);

  const handleWidthChange = useCallback((width: number) => {
    const clamped = Math.max(MIN_SIDEBAR_WIDTH, Math.min(width, MAX_SIDEBAR_WIDTH));
    setSidebarWidth(clamped);
    localStorage.setItem('sidebarWidth', String(clamped));
  }, []);

  const handleDeleteChat = useCallback((id: string) => {
    // Optimistically remove so the UI feels instant; the poll reconciles any
    // disagreement with the filesystem moments later.
    setChats((prev) => prev.filter((c) => c.id !== id));
    if (selectedChatId === id) setSelectedChatId(null);
    fetch(`/api/chats/${encodeURIComponent(id)}`, { method: 'DELETE' }).catch((err) => {
      console.error('Delete failed:', err);
      setError(err instanceof Error ? `Failed to delete chat: ${err.message}` : 'Failed to delete chat.');
    });
  }, [selectedChatId]);

  const handleRenameChat = useCallback(async (id: string, newTitle: string) => {
    const clean = newTitle.trim();
    if (!clean) return;
    try {
      const res = await fetch(`/api/chats/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: clean }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error || `Rename failed (${res.status})`);
      }
      const data = await res.json();
      // Renaming also renames the physical file, so the chat id changes.
      setChats((prev) =>
        prev.map((c) =>
          c.id === id ? { ...c, id: data.id, filename: data.filename, title: data.title } : c
        )
      );
      setSelectedChatId((prev) => (prev === id ? data.id : prev));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Rename failed.');
    }
  }, []);

  const handleToggleCollapse = useCallback(() => {
    setIsSidebarCollapsed((prev) => {
      localStorage.setItem('sidebarCollapsed', String(!prev));
      return !prev;
    });
  }, []);

  const selectedChat = chats.find((c) => c.id === selectedChatId) || null;
  const { bookmarks, addBookmark, removeBookmark } = useBookmarks(selectedChatId);

  return (
    <div className="app-container">
      <Sidebar
        chats={chats}
        selectedChatId={selectedChatId}
        onSelectChat={setSelectedChatId}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        selectedFilter={selectedFilter}
        onFilterChange={setSelectedFilter}
        width={sidebarWidth}
        onWidthChange={handleWidthChange}
        minWidth={MIN_SIDEBAR_WIDTH}
        maxWidth={MAX_SIDEBAR_WIDTH}
        isCollapsed={isSidebarCollapsed}
        onToggleCollapse={handleToggleCollapse}
        isLoading={isLoading}
        onDeleteChat={handleDeleteChat}
        onRenameChat={handleRenameChat}
      />
      <ChatViewer
        chat={selectedChat}
        error={error}
        isLoading={isLoading}
        bookmarks={bookmarks}
        onAddBookmark={addBookmark}
        onRemoveBookmark={removeBookmark}
      />
    </div>
  );
}

export default App;
