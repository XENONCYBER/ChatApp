import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import http from 'http';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const DEFAULT_PORT = Number(process.env.PORT) || 3001;

app.use(cors());
app.use(express.json());

const CHATS_DIR = path.resolve(__dirname, '/home/cyber/Downloads/chats');

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatData {
  id: string;
  filename: string;
  site: string; // 'claude' | 'chatgpt' | 'gemini' | 'unknown'
  title: string;
  url: string;
  timestamp: string;
  messageCount: number;
  messages: ChatMessage[];
}

/* ============================================================
   MARKDOWN PARSING
   ============================================================ */

/** Matches the machine-readable turn delimiters written by the extension. */
const MSG_BLOCK_RE = /<!--\s*MSG\s+role="(user|assistant)"(?:\s+index="\d+")?\s*-->([\s\S]*?)<!--\s*\/MSG\s*-->/gi;

/** `### 👤 You` / `### 🤖 Claude` style turn headings (legacy files). */
const ROLE_HEADING_RE = /^###\s+(?:👤|🤖|🧑|💬)?\s*(You|User|Human|Me|Assistant|Claude|ChatGPT|GPT(?:-\d\S*)?|Gemini|Bot|AI)\s*:?\s*$/i;

const USER_LABELS = new Set(['you', 'user', 'human', 'me']);

/** Strip the leading role heading from a turn body, if present. */
function stripRoleHeading(body: string): string {
  const lines = body.split('\n');
  let i = 0;
  while (i < lines.length && !lines[i].trim()) i++;
  if (i < lines.length && ROLE_HEADING_RE.test(lines[i].trim())) {
    lines.splice(0, i + 1);
  }
  return lines.join('\n');
}

/**
 * Trim a turn body without destroying markdown structure.
 * Only removes leading/trailing blank lines and a trailing `---` separator
 * that lives *outside* any fenced code block.
 */
function cleanTurnBody(body: string): string {
  let text = body.replace(/\r\n?/g, '\n');
  text = stripRoleHeading(text);
  text = mergeOrphanedFragments(text);

  const lines = text.split('\n');

  // Drop a trailing horizontal rule (the separator between turns).
  let end = lines.length;
  while (end > 0 && !lines[end - 1].trim()) end--;
  if (end > 0 && /^\s{0,3}(-{3,}|\*{3,}|_{3,})\s*$/.test(lines[end - 1])) {
    // Only if it is not the closing fence of a code block.
    if (!isInsideCodeFence(lines, end - 1)) end--;
  }

  return lines.slice(0, end).join('\n').replace(/^\n+/, '').replace(/\s+$/, '');
}

/**
 * Merge orphaned single-line "paragraphs" back into their surrounding text.
 *
 * The scraper sometimes wraps inline elements (katex spans, styled code) in
 * block-level containers, producing markdown like:
 *
 *   some text that mentions
 *
 *   K→A→B
 *
 *    where
 *
 *   A
 *
 *    and
 *
 *   B
 *
 *    are both non-key.
 *
 * This function detects runs of short "orphan" lines (≤ ~60 chars, no markdown
 * block syntax) separated by single blank lines, preceded and/or followed by a
 * normal paragraph line, and collapses them into one paragraph.
 *
 * It is careful to leave code fences, headings, lists, blockquotes, tables,
 * horizontal rules, and HTML comments untouched.
 */
function mergeOrphanedFragments(text: string): string {
  // Pass 1: merge runs of short fragment lines (with or without blank lines between them).
  let lines = text.split('\n');
  let result: string[] = [];
  let i = 0;

  while (i < lines.length) {
    // Skip code fences verbatim.
    const fenceMatch = lines[i].match(/^\s{0,3}(`{3,}|~{3,})/);
    if (fenceMatch) {
      const closer = fenceMatch[1];
      result.push(lines[i++]);
      while (i < lines.length) {
        result.push(lines[i]);
        const closeMatch = lines[i].match(/^\s{0,3}(`{3,}|~{3,})\s*$/);
        i++;
        if (closeMatch && closeMatch[1][0] === closer[0] && closeMatch[1].length >= closer.length) break;
      }
      continue;
    }

    if (isFragmentLine(lines[i]) && i + 1 < lines.length) {
      const fragments: string[] = [lines[i].trim()];
      let j = i + 1;

      while (j < lines.length) {
        if (lines[j].trim() === '' && j + 1 < lines.length && isFragmentLine(lines[j + 1])) {
          fragments.push(lines[j + 1].trim());
          j += 2;
          continue;
        }
        if (isFragmentLine(lines[j])) {
          fragments.push(lines[j].trim());
          j += 1;
          continue;
        }
        break;
      }

      if (fragments.length >= 2 && fragments.some((f) => f.length <= 30)) {
        const merged = fragments.join(' ').replace(/\s+/g, ' ');
        result.push(merged);
        i = j;
        continue;
      }
    }

    result.push(lines[i]);
    i++;
  }

  // Pass 2: stitch isolated very-short lines into adjacent paragraph lines.
  // Catches patterns like:
  //   "...gives you all A values such that for **every** B value in"
  //   " S"
  //   ", the pair (A,B) exists in"
  //   " R"
  //   "."
  // where each fragment is only 1-2 lines and surrounded by long paragraph lines.
  lines = result;
  result = [];
  i = 0;

  while (i < lines.length) {
    // Skip code fences.
    const fenceMatch = lines[i].match(/^\s{0,3}(`{3,}|~{3,})/);
    if (fenceMatch) {
      const closer = fenceMatch[1];
      result.push(lines[i++]);
      while (i < lines.length) {
        result.push(lines[i]);
        const closeMatch = lines[i].match(/^\s{0,3}(`{3,}|~{3,})\s*$/);
        i++;
        if (closeMatch && closeMatch[1][0] === closer[0] && closeMatch[1].length >= closer.length) break;
      }
      continue;
    }

    // If this is a very short non-block line (≤ 30 chars) and the previous
    // result line is a non-empty paragraph line, append this to it.
    const trimmed = lines[i].trim();
    if (
      trimmed.length > 0 &&
      trimmed.length <= 30 &&
      !isBlockSyntax(trimmed) &&
      result.length > 0
    ) {
      const prev = result[result.length - 1];
      // Only stitch if previous line is a non-empty, non-block, non-blank line
      if (prev.trim().length > 0 && !isBlockSyntax(prev.trim())) {
        // Append the short line to the previous line
        result[result.length - 1] = prev.trimEnd() + ' ' + trimmed;
        i++;
        continue;
      }
    }

    result.push(lines[i]);
    i++;
  }

  // Clean up any double spaces created by stitching.
  return result.map((l) => l.replace(/  +/g, ' ')).join('\n');
}

/** True if a line looks like a short orphaned inline fragment (for pass 1). */
function isFragmentLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;
  if (trimmed.length > 80) return false;
  return !isBlockSyntax(trimmed);
}

/** True if a line starts with markdown block-level syntax. */
function isBlockSyntax(trimmed: string): boolean {
  if (/^#{1,6}\s/.test(trimmed)) return true;              // heading
  if (/^\s{0,3}[-*+]\s/.test(trimmed)) return true;        // unordered list
  if (/^\s{0,3}\d+[.)]\s/.test(trimmed)) return true;      // ordered list
  if (/^\s{0,3}>/.test(trimmed)) return true;               // blockquote
  if (/^\s{0,3}(-{3,}|\*{3,}|_{3,})\s*$/.test(trimmed)) return true; // hr
  if (/^\|/.test(trimmed)) return true;                     // table row
  if (/^<!--/.test(trimmed)) return true;                   // html comment
  if (/^\s{0,3}(`{3,}|~{3,})/.test(trimmed)) return true;  // code fence
  return false;
}

/** True when `lineIndex` sits inside a fenced code block. */
function isInsideCodeFence(lines: string[], lineIndex: number): boolean {
  let fence: string | null = null;
  for (let i = 0; i < lineIndex; i++) {
    const m = lines[i].match(/^\s{0,3}(`{3,}|~{3,})/);
    if (!m) continue;
    if (fence === null) fence = m[1][0].repeat(m[1].length);
    else if (m[1][0] === fence[0] && m[1].length >= fence.length) fence = null;
  }
  return fence !== null;
}

/** Split markdown into turns, ignoring headings inside fenced code blocks. */
function splitTurnsByHeading(content: string): ChatMessage[] {
  const lines = content.replace(/\r\n?/g, '\n').split('\n');
  const messages: ChatMessage[] = [];

  let currentRole: 'user' | 'assistant' | null = null;
  let buffer: string[] = [];
  let fence: string | null = null;

  const flush = () => {
    if (currentRole === null) return;
    const body = cleanTurnBody(buffer.join('\n'));
    if (body) messages.push({ role: currentRole, content: body });
    buffer = [];
  };

  for (const line of lines) {
    // Track fenced code blocks so `###` inside code is never treated as a turn.
    const fenceMatch = line.match(/^\s{0,3}(`{3,}|~{3,})/);
    if (fenceMatch) {
      const marker = fenceMatch[1];
      if (fence === null) fence = marker;
      else if (marker[0] === fence[0] && marker.length >= fence.length) fence = null;
      if (currentRole !== null) buffer.push(line);
      continue;
    }

    if (fence === null) {
      const headingMatch = line.trim().match(ROLE_HEADING_RE);
      if (headingMatch) {
        flush();
        const label = headingMatch[1].toLowerCase();
        currentRole = USER_LABELS.has(label) ? 'user' : 'assistant';
        continue;
      }
    }

    if (currentRole !== null) buffer.push(line);
  }

  flush();
  return messages;
}

/** Parse Markdown chat exported by the extension. */
function parseMarkdownChat(filename: string, content: string): ChatData {
  const normalized = content.replace(/\r\n?/g, '\n');

  let title = filename.replace(/\.md$/i, '');
  let site = 'unknown';
  let url = '';
  let timestamp = '';

  const h1Match = normalized.match(/^#\s+(.+)$/m);
  if (h1Match) title = h1Match[1].trim();

  const sourceMatch = normalized.match(/^>\s*\*\*Source:\*\*\s*(.+)$/im);
  if (sourceMatch) {
    const rawSite = sourceMatch[1].trim().toLowerCase();
    if (rawSite.includes('claude')) site = 'claude';
    else if (rawSite.includes('chatgpt') || rawSite.includes('openai')) site = 'chatgpt';
    else if (rawSite.includes('gemini')) site = 'gemini';
    else site = rawSite;
  }

  const urlMatch = normalized.match(/^>\s*\*\*URL:\*\*\s*(.+)$/im);
  if (urlMatch) url = urlMatch[1].trim();

  // Prefer the machine-readable ISO timestamp when the exporter wrote one,
  // because the human-readable "Exported:" line is locale-dependent.
  const isoMatch = normalized.match(/^>\s*\*\*Timestamp:\*\*\s*(.+)$/im);
  if (isoMatch && !isNaN(new Date(isoMatch[1].trim()).getTime())) {
    timestamp = new Date(isoMatch[1].trim()).toISOString();
  } else {
    const exportedMatch = normalized.match(/^>\s*\*\*Exported:\*\*\s*(.+)$/im);
    if (exportedMatch) {
      const parsed = new Date(exportedMatch[1].trim().replace(' at ', ' '));
      if (!isNaN(parsed.getTime())) timestamp = parsed.toISOString();
    }
  }

  // Fall back to the ISO stamp embedded in the filename, then to file mtime.
  if (!timestamp) {
    const fromName = filename.match(/(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})/);
    if (fromName) {
      const guess = new Date(`${fromName[1]}T${fromName[2]}:${fromName[3]}:${fromName[4]}`);
      if (!isNaN(guess.getTime())) timestamp = guess.toISOString();
    }
  }
  if (!timestamp) {
    try {
      timestamp = fs.statSync(path.join(CHATS_DIR, filename)).mtime.toISOString();
    } catch {
      timestamp = new Date().toISOString();
    }
  }

  /* --- Turn extraction ---------------------------------------------------
     1. Delimiter comments (current exporter) – unambiguous.
     2. Role headings, fence-aware (legacy exports).
     Splitting naively on every `###` shredded assistant replies that used
     their own headings, which is what made roles look interleaved.        */
  let messages: ChatMessage[] = [];

  MSG_BLOCK_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = MSG_BLOCK_RE.exec(normalized)) !== null) {
    const role = match[1].toLowerCase() === 'user' ? 'user' : 'assistant';
    const body = cleanTurnBody(match[2]);
    if (body) messages.push({ role, content: body });
  }

  if (messages.length === 0) {
    messages = splitTurnsByHeading(normalized);
  }

  // Last resort: treat everything after the metadata block as one message.
  if (messages.length === 0) {
    const afterMeta = normalized.split(/^---\s*$/m).slice(1).join('\n---\n').trim();
    const body = afterMeta || normalized.replace(/^#\s+.+$/m, '').trim();
    if (body) messages.push({ role: 'assistant', content: body });
  }

  return {
    id: filename,
    filename,
    site,
    title,
    url,
    timestamp,
    // Always derive from the real array so the UI header can never disagree
    // with the number of bubbles actually rendered.
    messageCount: messages.length,
    messages,
  };
}

/* ============================================================
   JSON PARSING
   ============================================================ */

function normalizeRole(role: unknown): 'user' | 'assistant' {
  const r = String(role ?? '').toLowerCase();
  if (r === 'user' || r === 'human' || r === 'you' || r === 'prompt') return 'user';
  return 'assistant';
}

function normalizeSite(value: unknown, fallback: string): string {
  const s = String(value ?? '').toLowerCase();
  if (s.includes('claude')) return 'claude';
  if (s.includes('chatgpt') || s.includes('openai') || s.includes('gpt')) return 'chatgpt';
  if (s.includes('gemini') || s.includes('bard')) return 'gemini';
  return s || fallback;
}

/** Pull message content out of the various shapes exporters produce. */
function extractContent(raw: any): string {
  if (raw == null) return '';
  if (typeof raw === 'string') return raw;
  if (Array.isArray(raw)) return raw.map(extractContent).filter(Boolean).join('\n\n');
  if (typeof raw === 'object') {
    // OpenAI-style content parts: { type: 'text', text: '...' }
    if (typeof raw.text === 'string') return raw.text;
    if (typeof raw.content === 'string') return raw.content;
    if (Array.isArray(raw.parts)) return raw.parts.map(extractContent).filter(Boolean).join('\n\n');
    if (Array.isArray(raw.content)) return extractContent(raw.content);
  }
  return '';
}

function parseJsonChat(filename: string, content: string): ChatData {
  const fallback: ChatData = {
    id: filename,
    filename,
    site: 'unknown',
    title: filename.replace(/\.json$/i, ''),
    url: '',
    timestamp: new Date().toISOString(),
    messageCount: 0,
    messages: [],
  };

  let data: any;
  try {
    data = JSON.parse(content);
  } catch (err) {
    console.warn(`[chats] Invalid JSON in ${filename}: ${(err as Error).message}`);
    return fallback;
  }

  // Accept either { messages: [...] } or a bare array of messages.
  const rawMessages: any[] = Array.isArray(data)
    ? data
    : Array.isArray(data?.messages)
    ? data.messages
    : Array.isArray(data?.conversation)
    ? data.conversation
    : [];

  const messages: ChatMessage[] = rawMessages
    .map((m) => ({
      role: normalizeRole(m?.role ?? m?.author?.role ?? m?.sender),
      content: extractContent(m?.content ?? m?.text ?? m?.message ?? m?.parts).trim(),
    }))
    .filter((m) => m.content.length > 0);

  const meta = Array.isArray(data) ? {} : data ?? {};

  let timestamp = new Date().toISOString();
  if (meta.timestamp && !isNaN(new Date(meta.timestamp).getTime())) {
    timestamp = new Date(meta.timestamp).toISOString();
  } else {
    const fromName = filename.match(/(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})/);
    if (fromName) {
      const guess = new Date(`${fromName[1]}T${fromName[2]}:${fromName[3]}:${fromName[4]}`);
      if (!isNaN(guess.getTime())) timestamp = guess.toISOString();
    } else {
      try {
        timestamp = fs.statSync(path.join(CHATS_DIR, filename)).mtime.toISOString();
      } catch {
        /* keep default */
      }
    }
  }

  return {
    id: filename,
    filename,
    site: normalizeSite(meta.site ?? meta.platform, 'unknown'),
    title: String(meta.title || filename.replace(/\.json$/i, '')),
    url: String(meta.url || ''),
    timestamp,
    messageCount: messages.length,
    messages,
  };
}

/* ============================================================
   ROUTES
   ============================================================ */

/** Reject anything that could escape CHATS_DIR. */
function resolveChatFile(id: string): string | null {
  const name = path.basename(id);
  if (name !== id || name.startsWith('.')) return null;
  if (!/\.(md|json)$/i.test(name)) return null;
  const full = path.join(CHATS_DIR, name);
  if (path.dirname(path.resolve(full)) !== path.resolve(CHATS_DIR)) return null;
  return full;
}

/** Mirror the extension's safe-filename scheme so renames keep the naming. */
function slugifyTitle(title: string): string {
  const base = title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^[_-]+|[_-]+$/g, '')
    .substring(0, 60)
    .replace(/[_-]+$/, '');
  return base || 'chat';
}

function parseFile(filename: string, content: string): ChatData {
  return filename.toLowerCase().endsWith('.json')
    ? parseJsonChat(filename, content)
    : parseMarkdownChat(filename, content);
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, chatsDir: CHATS_DIR });
});

/** List all chats */
app.get('/api/chats', (_req, res) => {
  try {
    if (!fs.existsSync(CHATS_DIR)) fs.mkdirSync(CHATS_DIR, { recursive: true });

    const chats: ChatData[] = [];
    for (const file of fs.readdirSync(CHATS_DIR)) {
      if (!/\.(md|json)$/i.test(file) || file.startsWith('.')) continue;
      const filePath = path.join(CHATS_DIR, file);
      try {
        if (!fs.statSync(filePath).isFile()) continue;
        chats.push(parseFile(file, fs.readFileSync(filePath, 'utf-8')));
      } catch (err) {
        // One bad file must not blank out the whole sidebar.
        console.warn(`[chats] Skipping ${file}: ${(err as Error).message}`);
      }
    }

    chats.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    res.json(chats);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

/** Single chat detail */
app.get('/api/chats/:id', (req, res) => {
  try {
    const filePath = resolveChatFile(req.params.id);
    if (!filePath) return res.status(400).json({ error: 'Invalid chat id' });
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Chat file not found' });

    const filename = path.basename(filePath);
    res.json(parseFile(filename, fs.readFileSync(filePath, 'utf-8')));
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

/** Delete a chat (removes the source file). */
app.delete('/api/chats/:id', (req, res) => {
  try {
    const filePath = resolveChatFile(req.params.id);
    if (!filePath) return res.status(400).json({ error: 'Invalid chat id' });
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Chat file not found' });

    fs.unlinkSync(filePath);
    console.log(`[chats] Deleted ${path.basename(filePath)}`);
    res.json({ success: true, deleted: req.params.id });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

/** Rename a chat: updates the in-file H1 title and the physical filename. */
app.patch('/api/chats/:id', (req, res) => {
  try {
    const filePath = resolveChatFile(req.params.id);
    if (!filePath) return res.status(400).json({ error: 'Invalid chat id' });
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Chat file not found' });

    const title = typeof req.body?.title === 'string' ? req.body.title.trim() : '';
    if (!title) return res.status(400).json({ error: 'A non-empty title is required' });
    if (title.length > 300) return res.status(400).json({ error: 'Title too long' });

    const filename = path.basename(filePath);
    const chat = parseFile(filename, fs.readFileSync(filePath, 'utf-8'));
    const site = slugifyTitle(chat.site || 'unknown');
    const ext = filename.toLowerCase().endsWith('.json') ? '.json' : '.md';
    // Preserve the original timestamp slug so the file keeps its sort position.
    const stamp =
      filename.match(/\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}/)?.[0] ??
      new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);

    const newFilename = `${site}_${slugifyTitle(title)}_${stamp}${ext}`;
    const newPath = path.join(CHATS_DIR, newFilename);

    if (newPath !== filePath && fs.existsSync(newPath)) {
      return res.status(409).json({ error: `A chat with that name already exists (${newFilename})` });
    }

    // Rewrite the H1 so the title change survives a re-read.
    let content = fs.readFileSync(filePath, 'utf-8');
    content = /^#\s+\S/m.test(content)
      ? content.replace(/^#\s+.+$/m, `# ${title}`)
      : `# ${title}\n\n${content}`;

    if (newPath === filePath) {
      fs.writeFileSync(filePath, content);
    } else {
      fs.writeFileSync(newPath, content);
      fs.unlinkSync(filePath);
    }

    console.log(`[chats] Renamed ${filename} -> ${newFilename}`);
    res.json({ success: true, id: newFilename, filename: newFilename, title });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

/* ============================================================
   STARTUP
   ============================================================ */

const server = http.createServer(app);
let shuttingDown = false;

server.listen(DEFAULT_PORT, '127.0.0.1', () => {
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : DEFAULT_PORT;
  console.log(`Chat Viewer API listening on http://localhost:${port}`);
  console.log(`Serving chats from ${CHATS_DIR}`);
});

server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    console.error(
      `\nPort ${DEFAULT_PORT} is already in use — most likely an old server ` +
        `from a previous run.\n` +
        `  Find it:  lsof -ti tcp:${DEFAULT_PORT}\n` +
        `  Kill it:  npm run kill-port   (or: kill $(lsof -ti tcp:${DEFAULT_PORT}))\n` +
        `  Or run on another port:  PORT=3002 npm run dev\n`
    );
  } else {
    console.error('Server error:', err);
  }
  process.exit(1);
});

/* Shut down cleanly so the port is released. `concurrently -k` sends SIGTERM,
   and Ctrl-C sends SIGINT; without handling both the socket could linger and
   cause EADDRINUSE on the next start. */
function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\nReceived ${signal}, shutting down...`);
  server.close(() => process.exit(0));
  // Don't hang forever on keep-alive connections.
  setTimeout(() => process.exit(0), 3000).unref();
}

for (const sig of ['SIGTERM', 'SIGINT', 'SIGHUP'] as const) {
  process.on(sig, () => shutdown(sig));
}
