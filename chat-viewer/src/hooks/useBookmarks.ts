import { useState, useCallback, useEffect } from 'react';
import type { Bookmark } from '../types/chat';

const STORAGE_KEY = 'chat-viewer-bookmarks';

function loadBookmarks(): Record<string, Bookmark[]> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveBookmarks(all: Record<string, Bookmark[]>) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
}

export function useBookmarks(chatId: string | null) {
  const [allBookmarks, setAllBookmarks] = useState<Record<string, Bookmark[]>>(loadBookmarks);

  // Persist on every change
  useEffect(() => {
    saveBookmarks(allBookmarks);
  }, [allBookmarks]);

  const bookmarks: Bookmark[] = chatId ? (allBookmarks[chatId] || []) : [];

  const addBookmark = useCallback((bookmark: Omit<Bookmark, 'id' | 'createdAt'>) => {
    const newBookmark: Bookmark = {
      ...bookmark,
      id: `bm-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      createdAt: new Date().toISOString(),
    };
    setAllBookmarks((prev) => {
      const chatBookmarks = prev[bookmark.chatId] || [];
      // Don't add duplicate text in the same message
      if (chatBookmarks.some((b) => b.text === bookmark.text && b.messageIndex === bookmark.messageIndex)) {
        return prev;
      }
      return { ...prev, [bookmark.chatId]: [...chatBookmarks, newBookmark] };
    });
    return newBookmark;
  }, []);

  const removeBookmark = useCallback((bookmarkId: string) => {
    setAllBookmarks((prev) => {
      const updated = { ...prev };
      for (const key of Object.keys(updated)) {
        updated[key] = updated[key].filter((b) => b.id !== bookmarkId);
        if (updated[key].length === 0) delete updated[key];
      }
      return updated;
    });
  }, []);

  return { bookmarks, addBookmark, removeBookmark };
}
