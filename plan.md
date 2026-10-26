# AI Chat Scraper & Viewer — Project Plan

## Project Overview

A two-part system for scraping and viewing AI chat conversations offline:

1. **Browser Extension** (`chat-scraper-extension/`) — scrapes chats from Claude.ai, ChatGPT.com, and Gemini.google.com
2. **Local Web Viewer** (`chat-viewer/`) — reads saved chat files and renders them in a Claude.ai-style interface

---

## Part 1: Browser Extension

### Goal
Navigate to any chat on Claude.ai, ChatGPT, or Gemini → click extension → it extracts the full conversation separating user input from AI response → saves as a file locally in `chats/` folder.

### Architecture
- **Manifest V3** Chrome/Chromium extension
- **Content Script** (`content.js`): Injected into all 3 domains. Contains site-specific scrapers with 3 fallback strategies each (data-testid selectors → class-name selectors → generic structural traversal)
- **Background Service Worker** (`background.js`): Converts scraped data to Markdown or JSON, triggers `chrome.downloads` API with data URLs (not `URL.createObjectURL` — unavailable in MV3 workers)
- **Popup UI** (`popup.html/css/js`): Dark glassmorphism theme. Auto-detects site, lets user pick format (Markdown / JSON / Both), shows preview after scraping

### Supported Sites
| Site | Host Patterns |
|------|--------------|
| Claude | `claude.ai` |
| ChatGPT | `chatgpt.com`, `chat.openai.com` |
| Gemini | `gemini.google.com` |

### Export Formats
- **Markdown** (`.md`): Human-readable with `👤 You` / `🤖 Assistant` headers, metadata block, preserved code blocks
- **JSON** (`.json`): Structured `{ site, title, url, timestamp, messageCount, messages[] }`

### File Naming
`chats/{site}_{safe_title}_{ISO_timestamp}.md` (or `.json`)

---

## Part 2: Local Web Viewer App

### Goal
Run `npm run dev` → opens a local web app that auto-populates all chats from `chats/` folder → Claude.ai-style clean reader interface → click any chat in sidebar to view → "Continue Chat" button to jump back to the original conversation.

### Tech Stack
| Layer | Technology | Why |
|-------|-----------|-----|
| Frontend | **React + TypeScript + Vite** | Fast dev server, type safety, component-based architecture |
| Styling | **Vanilla CSS** | Full control over Claude.ai-inspired warm dark design system |
| Markdown Rendering | **react-markdown + remark-gfm** | GFM tables, lists, code fences, blockquotes |
| Icons | **lucide-react** | Clean, consistent icon set |
| Backend API | **Express + Node.js** (run via `tsx`) | Reads filesystem, serves parsed chat data |
| Concurrency | **concurrently** | Single `npm run dev` launches both API server + Vite frontend |

### Architecture

```
chat-viewer/
├── server/
│   └── server.ts            ← Express API (port 3001)
│                                GET /api/chats     → list all chats
│                                GET /api/chats/:id → single chat detail
├── src/
│   ├── App.tsx               ← Root: fetches chats, manages selection state
│   ├── main.tsx              ← React entrypoint
│   ├── types/
│   │   └── chat.ts           ← ChatData + ChatMessage interfaces
│   ├── components/
│   │   ├── Sidebar.tsx       ← Chat list + search bar + platform filter pills
│   │   ├── ChatViewer.tsx    ← Header + message thread + floating button
│   │   ├── MessageBubble.tsx ← Individual message (Markdown + code copy)
│   │   └── ContinueChatBtn.tsx ← Floating bottom-right "Continue Chat" link
│   └── styles/
│       └── main.css          ← Full design system (Claude.ai warm dark palette)
└── package.json
```

### UI Components

#### Sidebar
- **Brand header**: "Chattie" with icon
- **Search bar**: Filters by title or message content
- **Platform filter pills**: `All` | `Claude` | `ChatGPT` | `Gemini`
- **Chat list**: Title, site badge (color-coded), timestamp
- **Selection highlight**: Active chat has accent border
- **Collapsible & Resizable**: Drag handle on the right to resize (200px - 600px). Toggle button to collapse completely to 60px wide.

#### Main Chat View
- **Header bar**: Chat title, site badge, message count, export date
- **Message thread**: Scrollable list of messages
  - **User messages**: Warm-toned card with border (like Claude.ai user turns)
  - **Assistant messages**: Clean flat text with Markdown formatting
  - **Code blocks**: Dark background, language label, copy-to-clipboard button
  - **Tables**: Fully rendered markdown tables with proper borders and padding
  - **Inline code**: Accented text distinct from block code
- **No input box, no avatars, no login buttons** — pure reading experience

#### Floating Action Button
- **Position**: Fixed bottom-right corner
- **Label**: "Continue Chat on {SiteName} ↗"
- **Behavior**: Opens original chat URL in a new browser tab
- **Styling**: Gradient accent button with hover lift animation

### Data Flow
1. `npm run dev` starts Express server (port 3001) + Vite (port 5173)
2. Express scans `../../chats/` directory for `.md` and `.json` files
3. Parses each file into `ChatData` objects (title, site, url, timestamp, messages)
4. React app fetches `GET /api/chats` on mount and auto-selects first chat
5. Polls every 5 seconds for newly exported files (auto-populate)
6. User clicks sidebar item → full chat renders in main view

### Design System (CSS Variables)
```css
--bg-primary: #171513       /* Main background */
--bg-secondary: #1e1b18     /* Sidebar background */
--bg-tertiary: #27231f      /* Cards, hover states */
--accent-claude: #d97757    /* Claude terracotta */
--accent-chatgpt: #10a37f   /* ChatGPT green */
--accent-gemini: #4285f4    /* Gemini blue */
--text-primary: #ece6e2     /* Main text */
--text-secondary: #a39b94   /* Subdued text */
--font-main: Inter          /* UI typography */
--font-code: JetBrains Mono /* Code blocks */
```

---

## Running the Project

```bash
# Start the web viewer (from chat-viewer/)
npm run dev
# → Express API: http://localhost:3001
# → React App:   http://localhost:5173

# Install the extension
# 1. chrome://extensions → Developer mode ON → Load unpacked → select chat-scraper-extension/
```

---

## Future Improvements
- [ ] WebSocket-based live updates (replace polling)
- [ ] Full-text search across all message content
- [ ] Chat export to PDF
- [ ] Dark/light theme toggle
- [ ] Tag / folder organization for chats
- [ ] Keyboard shortcuts (↑↓ to navigate sidebar, Ctrl+K to search)
