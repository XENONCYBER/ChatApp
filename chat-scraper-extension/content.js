/* ============================================================
   Chattie – Content Script
   Runs on Claude.ai, ChatGPT.com, and Gemini.google.com
   Walks the live DOM and serializes it to Markdown, preserving
   tables, nested lists, code fences, blockquotes and links.
   ============================================================ */

(() => {
  "use strict";

  /* ============================================================
     DOM -> MARKDOWN SERIALIZER
     ============================================================ */

  /** Tags whose subtree is never content. */
  const SKIP_TAGS = new Set([
    "SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "SVG", "MATH", "CANVAS",
    "BUTTON", "INPUT", "SELECT", "OPTION", "TEXTAREA", "FORM", "LABEL",
    "IFRAME", "OBJECT", "EMBED", "AUDIO", "VIDEO", "TRACK", "SOURCE",
    "DIALOG", "MENU",
  ]);

  /** Attribute / class signatures of UI chrome we never want. */
  const NOISE_SELECTOR = [
    '[aria-hidden="true"]',
    '[role="button"]',
    '[role="toolbar"]',
    '[role="tablist"]',
    '[role="menu"]',
    '[role="menubar"]',
    '[role="presentation"][class*="tooltip"]',
    ".sr-only",
    ".visually-hidden",
    ".screen-reader-only",
    '[data-testid="copy-turn-action-button"]',
    '[data-testid$="-action-button"]',
    '[data-testid="voice-play-turn-action-button"]',
  ].join(",");

  /** Block-level tags we explicitly know about. */
  const BLOCK_TAGS = new Set([
    "ADDRESS", "ARTICLE", "ASIDE", "BLOCKQUOTE", "DETAILS", "DIALOG", "DD",
    "DIV", "DL", "DT", "FIELDSET", "FIGCAPTION", "FIGURE", "FOOTER", "FORM",
    "H1", "H2", "H3", "H4", "H5", "H6", "HEADER", "HGROUP", "HR", "LI",
    "MAIN", "NAV", "OL", "P", "PRE", "SECTION", "TABLE", "UL",
  ]);

  /** Placeholder sentinel used to shield code fences from whitespace cleanup. */
  const CODE_TOKEN = "\u0000CODE";

  function isNoise(el) {
    if (el.getAttribute("aria-hidden") === "true") return true;
    if (el.hasAttribute("hidden")) return true;
    try {
      if (el.matches(NOISE_SELECTOR)) return true;
    } catch {
      /* selector unsupported in this engine – ignore */
    }
    // Genuinely invisible nodes carry no content.
    try {
      const cs = window.getComputedStyle(el);
      if (cs && (cs.display === "none" || cs.visibility === "hidden")) return true;
    } catch {
      /* detached node – ignore */
    }
    return false;
  }

  function isBlockElement(el) {
    // Computed display is authoritative over the tag name. Claude.ai renders
    // inline math variables (e.g. "block of R, scan S") in containers whose
    // tag is a block tag but whose display is inline-flex/inline-grid. Treating
    // those as blocks shredded a sentence into one paragraph per variable.
    try {
      const d = window.getComputedStyle(el).display;
      if (
        d === "inline" || d === "inline-block" || d === "inline-flex" ||
        d === "inline-grid" || d === "inline-table" || d === "contents"
      ) {
        return false;
      }
      if (
        d === "block" || d === "flex" || d === "grid" ||
        d === "list-item" || d === "table" || d === "flow-root"
      ) {
        return true;
      }
    } catch {
      /* detached node – ignore */
    }
    return BLOCK_TAGS.has(el.tagName);
  }

  /** Longest run of backticks in a string – used to size code fences. */
  function longestBacktickRun(str) {
    let max = 0;
    const re = /`+/g;
    let m;
    while ((m = re.exec(str))) max = Math.max(max, m[0].length);
    return max;
  }

  /** Best-effort language detection for a <pre> block. */
  function detectLanguage(pre, codeEl) {
    const fromClass = (node) => {
      const cls = node && node.getAttribute ? node.getAttribute("class") || "" : "";
      const m = cls.match(/(?:language|lang|highlight)[-_](\w[\w+#-]*)/i);
      return m ? m[1].toLowerCase() : "";
    };

    let lang = fromClass(codeEl) || fromClass(pre);
    if (lang) return lang;

    for (const attr of ["data-language", "data-lang", "data-code-language"]) {
      const v = pre.getAttribute(attr) || (codeEl && codeEl.getAttribute(attr));
      if (v) return v.trim().toLowerCase();
    }

    // ChatGPT / Gemini render the language name in a small header above <code>.
    const header = pre.querySelector("[class*='language-'], [class*='code-block-header']");
    if (header) {
      const t = (header.textContent || "").trim().split(/\s+/)[0];
      if (t && t.length < 20 && /^[a-z0-9+#._-]+$/i.test(t)) return t.toLowerCase();
    }
    return "";
  }

  /** Serialize a <pre> into a fenced code block. */
  function serializePre(pre) {
    const codeEl = pre.querySelector("code");
    const lang = detectLanguage(pre, codeEl);

    // Prefer <code> so surrounding chrome ("Copy", language pills) is excluded.
    let raw = (codeEl || pre).textContent || "";
    raw = raw.replace(/\r\n?/g, "\n").replace(/^\n+/, "").replace(/\s+$/, "");
    if (!raw) return "";

    const fence = "`".repeat(Math.max(3, longestBacktickRun(raw) + 1));
    return `\n\n${fence}${lang}\n${raw}\n${fence}\n\n`;
  }

  /** Collapse a table cell's markdown into a single safe line. */
  function normalizeCell(text) {
    return text
      .replace(/\r?\n+/g, " ")
      .replace(/\|/g, "\\|")
      .replace(/\s+/g, " ")
      .trim();
  }

  /** Serialize a <table> into a GFM pipe table. */
  function serializeTable(table, ctx) {
    // Only rows belonging to *this* table (ignore nested tables).
    const rows = Array.from(table.querySelectorAll("tr")).filter(
      (tr) => tr.closest("table") === table
    );
    if (!rows.length) return "";

    const cellCtx = { ...ctx, inTable: true };
    const grid = [];
    const alignments = [];

    for (const tr of rows) {
      if (isNoise(tr)) continue;
      const cells = Array.from(tr.children).filter(
        (c) => c.tagName === "TD" || c.tagName === "TH"
      );
      if (!cells.length) continue;

      const row = [];
      for (const cell of cells) {
        const span = Math.max(1, parseInt(cell.getAttribute("colspan") || "1", 10) || 1);
        row.push(normalizeCell(serializeChildren(cell, cellCtx)));
        // A colspan occupies extra columns – pad so alignment stays correct.
        for (let i = 1; i < span; i++) row.push("");
      }
      grid.push(row);

      if (grid.length === 1) {
        cells.forEach((cell) => {
          const a =
            (cell.getAttribute("align") || "").toLowerCase() ||
            (cell.style && cell.style.textAlign) ||
            "";
          alignments.push(a === "center" ? "center" : a === "right" ? "right" : "left");
        });
      }
    }

    if (!grid.length) return "";

    const width = grid.reduce((max, r) => Math.max(max, r.length), 0);
    if (width === 0) return "";
    grid.forEach((r) => {
      while (r.length < width) r.push("");
    });
    while (alignments.length < width) alignments.push("left");

    // GFM requires a header row. Use the real header when present, otherwise
    // promote the first row (which is what a header-less table implies visually).
    const firstRowIsHeader =
      !!table.querySelector("thead") ||
      Array.from(rows[0].children).some((c) => c.tagName === "TH");

    let header;
    let body;
    if (firstRowIsHeader || grid.length === 1) {
      header = grid[0];
      body = grid.slice(1);
    } else {
      header = grid[0];
      body = grid.slice(1);
    }

    const divider = alignments
      .slice(0, width)
      .map((a) => (a === "center" ? ":---:" : a === "right" ? "---:" : ":---"));

    const lines = [
      `| ${header.join(" | ")} |`,
      `| ${divider.join(" | ")} |`,
      ...body.map((r) => `| ${r.join(" | ")} |`),
    ];

    return `\n\n${lines.join("\n")}\n\n`;
  }

  /** Serialize a <ul>/<ol> into markdown, preserving nesting. */
  function serializeList(list, ctx) {
    const ordered = list.tagName === "OL";
    const items = Array.from(list.children).filter((c) => c.tagName === "LI");
    if (!items.length) return "";

    const start = ordered ? parseInt(list.getAttribute("start") || "1", 10) || 1 : 1;
    const depth = ctx.listDepth || 0;
    const indent = "  ".repeat(depth);
    const childCtx = { ...ctx, listDepth: depth + 1 };

    const lines = [];
    items.forEach((li, i) => {
      if (isNoise(li)) return;

      let marker = ordered ? `${start + i}. ` : "- ";

      // GFM task list support.
      const checkbox = li.querySelector(':scope > input[type="checkbox"]');
      if (checkbox) marker += checkbox.checked ? "[x] " : "[ ] ";

      let inner = tidy(serializeChildren(li, childCtx)).trim();
      if (!inner) return;

      /* A nested list serializes with surrounding blank lines; inside a list
         item that would turn the list "loose" and add stray gaps, so collapse
         blank lines that sit directly before an indented sub-item. */
      inner = inner.replace(/\n{2,}(?=[ \t]*(?:[-*+]|\d+\.)\s)/g, "\n");

      // Nested blocks inside an item must be indented to stay part of the item.
      const cont = indent + " ".repeat(marker.length);
      inner = inner
        .split("\n")
        .map((line, idx) => {
          if (idx === 0) return line;
          return line.trim() ? cont + line : "";
        })
        .join("\n");

      lines.push(indent + marker + inner);
    });

    if (!lines.length) return "";
    return `\n\n${lines.join("\n")}\n\n`;
  }

  function serializeChildren(node, ctx) {
    let out = "";
    for (const child of node.childNodes) out += serializeNode(child, ctx);
    return out;
  }

  function serializeNode(node, ctx) {
    // --- text ---
    if (node.nodeType === Node.TEXT_NODE) {
      // HTML collapses whitespace; mirror that so paragraphs stay on one line.
      return (node.nodeValue || "").replace(/\s+/g, " ");
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return "";

    const el = node;
    const tag = el.tagName;

    if (SKIP_TAGS.has(tag)) return "";
    if (isNoise(el)) return "";

    switch (tag) {
      case "BR":
        // Hard break; inside a table cell newlines are illegal.
        return ctx.inTable ? " " : "  \n";

      case "HR":
        return ctx.inTable ? " " : "\n\n---\n\n";

      case "H1":
      case "H2":
      case "H3":
      case "H4":
      case "H5":
      case "H6": {
        const text = serializeChildren(el, ctx).replace(/\s+/g, " ").trim();
        if (!text) return "";
        if (ctx.inTable) return `**${text}** `;
        return `\n\n${"#".repeat(Number(tag[1]))} ${text}\n\n`;
      }

      case "STRONG":
      case "B": {
        const text = serializeChildren(el, ctx);
        const trimmed = text.trim();
        if (!trimmed) return text;
        // Keep surrounding spaces outside the emphasis markers.
        const lead = text.match(/^\s*/)[0];
        const tail = text.match(/\s*$/)[0];
        return `${lead}**${trimmed}**${tail}`;
      }

      case "EM":
      case "I": {
        const text = serializeChildren(el, ctx);
        const trimmed = text.trim();
        if (!trimmed) return text;
        const lead = text.match(/^\s*/)[0];
        const tail = text.match(/\s*$/)[0];
        return `${lead}*${trimmed}*${tail}`;
      }

      case "DEL":
      case "S":
      case "STRIKE": {
        const text = serializeChildren(el, ctx).trim();
        return text ? `~~${text}~~` : "";
      }

      case "CODE":
      case "KBD":
      case "SAMP": {
        // <code> inside <pre> is consumed by serializePre, so this is inline.
        const text = (el.textContent || "").replace(/\s+/g, " ").trim();
        if (!text) return "";
        const ticks = "`".repeat(longestBacktickRun(text) + 1);
        const pad = text.startsWith("`") || text.endsWith("`") ? " " : "";
        return `${ticks}${pad}${text}${pad}${ticks}`;
      }

      case "PRE": {
        if (ctx.inTable) {
          const text = (el.textContent || "").replace(/\s+/g, " ").trim();
          return text ? `\`${text.replace(/`/g, "")}\` ` : "";
        }
        return serializePre(el);
      }

      case "A": {
        const text = serializeChildren(el, ctx).trim();
        const href = el.getAttribute("href") || "";
        if (!text) return "";
        if (!href || href.startsWith("#") || href.startsWith("javascript:")) return text;
        const safeHref = /[()\s]/.test(href) ? `<${href}>` : href;
        return `[${text}](${safeHref})`;
      }

      case "IMG": {
        const alt = (el.getAttribute("alt") || "image").trim();
        const src = el.getAttribute("src") || "";
        if (!src || src.startsWith("data:")) return alt ? `[${alt}]` : "";
        return `![${alt}](${src})`;
      }

      case "UL":
      case "OL":
        return ctx.inTable
          ? serializeChildren(el, ctx)
          : serializeList(el, ctx);

      case "LI":
        // Reached only for malformed markup (li without ul/ol parent).
        return `\n- ${tidy(serializeChildren(el, ctx)).trim()}\n`;

      case "TABLE":
        return ctx.inTable
          ? serializeChildren(el, ctx)
          : serializeTable(el, ctx);

      case "THEAD":
      case "TBODY":
      case "TFOOT":
      case "TR":
      case "TD":
      case "TH":
        // Only hit when a table fragment appears without a <table> ancestor.
        return serializeChildren(el, ctx) + " ";

      case "BLOCKQUOTE": {
        if (ctx.inTable) return serializeChildren(el, ctx);
        const inner = tidy(serializeChildren(el, ctx)).trim();
        if (!inner) return "";
        const quoted = inner
          .split("\n")
          .map((l) => (l.trim() ? `> ${l}` : ">"))
          .join("\n");
        return `\n\n${quoted}\n\n`;
      }

      case "DT": {
        const text = serializeChildren(el, ctx).trim();
        return text ? `\n\n**${text}**\n` : "";
      }

      case "DD": {
        const text = tidy(serializeChildren(el, ctx)).trim();
        return text ? `\n: ${text}\n` : "";
      }

      case "P": {
        const inner = serializeChildren(el, ctx);
        if (!inner.trim()) return "";
        return ctx.inTable ? `${inner} ` : `\n\n${inner}\n\n`;
      }

      default: {
        const inner = serializeChildren(el, ctx);
        if (!inner.trim()) return "";
        if (ctx.inTable) return inner;
        return isBlockElement(el) ? `\n\n${inner}\n\n` : inner;
      }
    }
  }

  /** Normalize whitespace/blank lines without touching fenced code. */
  function tidy(markdown) {
    const fences = [];
    // Stash fenced code so the cleanup below cannot corrupt indentation.
    let text = markdown.replace(/(^|\n)(`{3,})[^\n]*\n[\s\S]*?\n\2(?=\n|$)/g, (m) => {
      fences.push(m);
      return `${CODE_TOKEN}${fences.length - 1}\u0000`;
    });

    text = text
      .replace(/\r\n?/g, "\n")
      .replace(/\u00a0/g, " ");

    /* Collapse whitespace *within* each line while preserving the line's
       leading indentation, which is structural in Markdown (nested lists and
       indented continuations). A blanket `[ \t]{3,}` -> " " replacement would
       flatten a nested list back to a single level. */
    text = text
      .split("\n")
      .map((line) => {
        const indentMatch = line.match(/^[ \t]*/)[0];
        let rest = line.slice(indentMatch.length);
        const hardBreak = /[ \t]{2,}$/.test(rest);
        rest = rest.replace(/[ \t]{2,}/g, " ").replace(/[ \t]+$/, "");
        if (!rest) return "";
        return indentMatch + rest + (hardBreak ? "  " : "");
      })
      .join("\n")
      .replace(/\n{3,}/g, "\n\n");

    text = text.replace(new RegExp(`${CODE_TOKEN}(\\d+)\\u0000`, "g"), (_, i) => fences[Number(i)]);
    return text;
  }

  /** Public entry point: element -> markdown string. */
  function elementToMarkdown(el) {
    if (!el) return "";
    const md = serializeNode(el, { listDepth: 0, inTable: false });
    return tidy(md).trim();
  }

  /* ============================================================
     TURN COLLECTION HELPERS
     ============================================================ */

  /** Sort by true document order (viewport coords lie when virtualized). */
  function sortByDocumentOrder(entries) {
    return entries.sort((a, b) => {
      if (a.el === b.el) return 0;
      const rel = a.el.compareDocumentPosition(b.el);
      if (rel & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
      if (rel & Node.DOCUMENT_POSITION_PRECEDING) return 1;
      return 0;
    });
  }

  /** Drop entries whose element is nested inside another entry's element. */
  function dropNested(entries) {
    return entries.filter(
      (e) => !entries.some((o) => o.el !== e.el && o.el.contains(e.el))
    );
  }

  /** entries -> messages, de-duplicated and in document order. */
  function buildMessages(entries) {
    const messages = [];
    let previous = null;

    for (const { el, role } of sortByDocumentOrder(dropNested(entries))) {
      const content = elementToMarkdown(el);
      if (!content) continue;
      // Guard against the same turn being picked up twice by overlapping selectors.
      if (previous && previous.role === role && previous.content === content) continue;
      previous = { role, content };
      messages.push(previous);
    }
    return messages;
  }

  /**
   * A conversation must contain both sides. If a strategy returns only user
   * turns (or only assistant turns) it means its selectors matched one family
   * and missed the other — usually because the site renamed a class or
   * test id. Accepting that result silently is what caused exports containing
   * nothing but "👤 You" messages, so treat it as a failed strategy and let
   * the next fallback run instead.
   *
   * A genuine single-message conversation is still allowed through.
   */
  function isUsable(messages) {
    if (!messages || messages.length === 0) return false;
    if (messages.length === 1) return true;
    const roles = new Set(messages.map((m) => m.role));
    return roles.size > 1;
  }

  function collect(selector, role) {
    const out = [];
    document.querySelectorAll(selector).forEach((el) => out.push({ el, role }));
    return out;
  }

  /* ============================================================
     SITE-SPECIFIC SCRAPERS
     ============================================================ */

  /* ---------- Claude.ai ---------- */

  /* Claude marks user turns with a test id but styles assistant turns with a
     font class, and the /share/ pages differ again. Each tier below must find
     BOTH sides (see isUsable) or it is discarded.

     Selectors reflect Claude's confirmed markup as of early 2026:
       - user:      [data-testid="user-message"]  (also .font-user-message,
                    which was briefly renamed to \!font-user-message)
       - assistant: .font-claude-response  (+ .font-claude-response-body),
                    response rows .row-start-2 (Tailwind grid class, one per
                    assistant turn, never inside a user-message subtree)
       - markdown:  .standard-markdown / .progressive-markdown containers */
  const CLAUDE_USER_SELECTORS = [
    '[data-testid="user-message"]',
    '[data-testid="human-message"]',
    '[data-testid^="user-human-turn"]',
    '[data-testid^="user-turn"]',
    ".font-user-message",
    "\\!font-user-message",
    ".human-turn",
    "[data-is-user-message]",
    '[data-message-author-role="user"]',
  ].join(",");

  const CLAUDE_ASSISTANT_SELECTORS = [
    ".font-claude-response",
    ".font-claude-response-body",
    // One .row-start-2 per assistant turn (the response-content row).
    ".row-start-2",
    ".standard-markdown",
    ".progressive-markdown",
    '[data-testid="assistant-message"]',
    '[data-testid^="assistant-turn"]',
    ".font-claude-message",
    ".assistant-turn",
    "[data-is-assistant-message]",
    '[data-message-author-role="assistant"]',
    // Renamed/obscured containers.
    '[class*="model-reply"]',
    '[class*="claude-response"]',
  ].join(",");

  function scrapeClaude() {
    // Tier 1: known role selectors, queried together in a single pass.
    let messages = buildMessages([
      ...collect(CLAUDE_USER_SELECTORS, "user"),
      ...collect(CLAUDE_ASSISTANT_SELECTORS, "assistant"),
    ]);
    if (isUsable(messages)) return messages;

    /* Tier 2: anchor on whichever side we CAN identify reliably (the user
       test id is the most stable selector Claude ships) and treat each
       sibling block between two user turns as the assistant reply. This
       survives assistant-side class renames entirely. */
    messages = scrapeByUserAnchors(CLAUDE_USER_SELECTORS);
    if (isUsable(messages)) return messages;

    // Tier 3: generic structural traversal.
    messages = scrapeGenericConversation([
      '[class*="conversation"]',
      "main",
      '[role="main"]',
    ]);
    if (isUsable(messages)) return messages;

    // Nothing better available – return the best effort so far.
    return messages;
  }

  /**
   * Role-agnostic pairing: find the user turns, walk up to the block that sits
   * directly inside the conversation container, then treat the blocks between
   * consecutive user turns as assistant replies. Used when only one role can
   * be selected reliably.
   */
  function scrapeByUserAnchors(userSelectors) {
    const userNodes = Array.from(document.querySelectorAll(userSelectors));
    if (userNodes.length === 0) return [];

    // Find the nearest common ancestor that holds every user turn.
    let container = userNodes[0].parentElement;
    while (container && !userNodes.every((n) => container.contains(n))) {
      container = container.parentElement;
    }
    if (!container) return [];

    /** Lift `node` to the direct child of `container` that contains it. */
    const topLevelBlock = (node) => {
      let cur = node;
      while (cur.parentElement && cur.parentElement !== container) cur = cur.parentElement;
      return cur.parentElement === container ? cur : null;
    };

    const userBlocks = new Set();
    for (const n of userNodes) {
      const block = topLevelBlock(n);
      if (block) userBlocks.add(block);
    }
    if (userBlocks.size === 0) return [];

    const entries = [];
    for (const block of Array.from(container.children)) {
      const isUser = userBlocks.has(block);
      // Skip empty spacers and any block that is purely UI chrome.
      if (!(block.textContent || "").trim()) continue;
      entries.push({ el: block, role: isUser ? "user" : "assistant" });
    }

    return buildMessages(entries);
  }

  /* ---------- ChatGPT ---------- */
  function scrapeChatGPT() {
    // Tier 1: data-message-author-role is authoritative.
    const entries = [];
    document.querySelectorAll("[data-message-author-role]").forEach((el) => {
      const role = el.getAttribute("data-message-author-role");
      if (role === "user" || role === "assistant") entries.push({ el, role });
    });
    let messages = buildMessages(entries);
    if (isUsable(messages)) return messages;

    // Tier 2: conversation-turn articles, role inferred from the heading.
    const turns = Array.from(
      document.querySelectorAll('article[data-testid^="conversation-turn"]')
    );
    if (turns.length) {
      const turnEntries = turns.map((turn, i) => {
        const heading = (turn.querySelector("h5, h6")?.textContent || "").toLowerCase();
        let role;
        if (heading.includes("you said")) role = "user";
        else if (heading.includes("said")) role = "assistant";
        else role = i % 2 === 0 ? "user" : "assistant";
        return { el: turn, role };
      });
      messages = buildMessages(turnEntries);
      if (isUsable(messages)) return messages;
    }

    // Tier 3: anchor on the user turns and pair structurally.
    messages = scrapeByUserAnchors('[data-message-author-role="user"], [data-testid="user-message"]');
    if (isUsable(messages)) return messages;

    // Tier 4: generic structural traversal.
    return scrapeGenericConversation(["main", '[role="main"]']);
  }

  /* ---------- Gemini ---------- */
  function scrapeGemini() {
    /* Query user and model turns together: Gemini's user queries and model
       responses use unrelated selectors, so splitting them across sequential
       strategies risks returning only one side of the conversation. */
    const USER_SELECTORS = [
      "user-query",
      ".query-content",
      "[data-query-text]",
      ".user-query",
      ".query-text",
    ].join(",");

    const ASSISTANT_SELECTORS = [
      "model-response",
      ".response-container-content",
      "message-content.model-response-text",
      ".model-response",
      ".response-text",
      ".markdown-main-panel",
    ].join(",");

    let messages = buildMessages([
      ...collect(USER_SELECTORS, "user"),
      ...collect(ASSISTANT_SELECTORS, "assistant"),
    ]);
    if (isUsable(messages)) return messages;

    // Fallback: per-turn containers with explicit role attributes.
    const entries = [];
    document.querySelectorAll("[data-turn-role], .conversation-turn").forEach((el) => {
      const attr = (el.getAttribute("data-turn-role") || "").toLowerCase();
      const isUser = attr === "user" || el.classList.contains("user");
      entries.push({ el, role: isUser ? "user" : "assistant" });
    });
    messages = buildMessages(entries);
    if (isUsable(messages)) return messages;

    // Anchor on user queries and pair the blocks in between.
    messages = scrapeByUserAnchors(USER_SELECTORS);
    if (isUsable(messages)) return messages;

    return scrapeGenericConversation([
      ".conversation-container",
      "main",
      '[role="main"]',
    ]);
  }

  /* ---------- Generic structural fallback ---------- */
  function scrapeGenericConversation(containerSelectors) {
    let container = null;
    for (const sel of containerSelectors) {
      container = document.querySelector(sel);
      if (container) break;
    }
    if (!container) return [];

    const USER_HINT = /\b(human|user|you|query|prompt|request)\b/i;
    const ASSISTANT_HINT = /\b(assistant|claude|chatgpt|gpt|gemini|model|response|answer|bot|ai)\b/i;

    const candidates = Array.from(
      container.querySelectorAll(":scope > div, :scope > div > div, :scope > div > div > div")
    );

    const entries = [];
    for (const el of candidates) {
      // Ignore wrappers that merely contain other candidates.
      if (candidates.some((o) => o !== el && el.contains(o))) continue;
      const text = (el.textContent || "").trim();
      if (text.length < 2) continue;

      const signature = `${el.className || ""} ${el.getAttribute("data-testid") || ""}`;
      let role;
      if (USER_HINT.test(signature)) role = "user";
      else if (ASSISTANT_HINT.test(signature)) role = "assistant";
      else role = entries.length % 2 === 0 ? "user" : "assistant";

      entries.push({ el, role });
    }

    return buildMessages(entries);
  }

  /* ============================================================
     MAIN SCRAPER DISPATCHER
     ============================================================ */

  function detectSite() {
    const host = window.location.hostname;
    if (host.includes("claude.ai")) return "claude";
    if (host.includes("chatgpt.com") || host.includes("chat.openai.com")) return "chatgpt";
    if (host.includes("gemini.google.com")) return "gemini";
    return null;
  }

  function getChatTitle() {
    const raw = (document.title || "").trim();
    const cleaned = raw
      .replace(/^\(\d+\)\s*/, "")
      .replace(/\s*[-–|]\s*(Claude|ChatGPT|Gemini)\s*$/i, "")
      .trim();

    if (!cleaned || /^(claude|chatgpt|gemini)$/i.test(cleaned)) {
      // Fall back to the sidebar's active conversation label.
      const active = document.querySelector(
        '[aria-current="page"], .conversation.selected .conversation-title, li[data-active="true"]'
      );
      const label = (active?.textContent || "").trim();
      if (label) return label.slice(0, 120);
      const site = detectSite();
      return site ? `${site.charAt(0).toUpperCase() + site.slice(1)} Chat` : "Chat";
    }
    return cleaned.slice(0, 120);
  }

  function scrapeChat() {
    const site = detectSite();
    if (!site) {
      return {
        error: true,
        message: "This site is not supported. Open Claude.ai, ChatGPT, or Gemini.",
      };
    }

    let messages = [];
    if (site === "claude") messages = scrapeClaude();
    else if (site === "chatgpt") messages = scrapeChatGPT();
    else if (site === "gemini") messages = scrapeGemini();

    if (!messages || messages.length === 0) {
      return {
        error: true,
        message:
          "No messages found. Make sure the chat is fully loaded and visible on screen.",
      };
    }

    /* Surface a one-sided scrape instead of silently writing a file that
       contains only "👤 You" turns. */
    const roles = new Set(messages.map((m) => m.role));
    const warning =
      messages.length > 1 && roles.size === 1
        ? `Only ${[...roles][0]} messages were detected — the other side of the ` +
          `conversation could not be found. Scroll through the whole chat to load ` +
          `every turn, then try again.`
        : null;

    return {
      error: false,
      warning,
      data: {
        schemaVersion: 1,
        site,
        title: getChatTitle(),
        url: window.location.href,
        timestamp: new Date().toISOString(),
        messageCount: messages.length,
        messages,
      },
    };
  }

  /* ---------- Listen for messages from popup / background ---------- */
  chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
    if (request && request.action === "scrapeChat") {
      try {
        sendResponse(scrapeChat());
      } catch (err) {
        sendResponse({ error: true, message: `Scraping failed: ${err.message}` });
      }
      return true;
    }
    if (request && request.action === "debugDOM") {
      try {
        sendResponse({ error: false, data: debugDOM() });
      } catch (err) {
        sendResponse({ error: true, message: `Inspection failed: ${err.message}` });
      }
      return true;
    }
    return false;
  });

  /* ============================================================
     DOM INSPECTION (diagnostics)
     Dumps the real page structure so selectors can be fixed against
     actual markup instead of guesses. Triggered by the popup's
     "Inspect page" button; paste the output back to the developer.
     ============================================================ */

  /** Compact single-line description of an element's tag + class + testid. */
  function describeElement(node) {
    if (!node || node.nodeType !== Node.ELEMENT_NODE) return "";
    const tag = node.tagName.toLowerCase();
    const cls =
      typeof node.className === "string" && node.className.trim()
        ? "." + node.className.trim().split(/\s+/).slice(0, 6).join(".")
        : "";
    const testid = node.getAttribute("data-testid")
      ? `[data-testid="${node.getAttribute("data-testid")}"]`
      : "";
    return `<${tag}${cls}${testid}>`;
  }

  /** Tree outline of an element, a few levels deep. */
  function outline(node, depth = 0, maxChildren = 10, maxDepth = 4) {
    if (!node || node.nodeType !== Node.ELEMENT_NODE || depth > maxDepth) return "";
    const pad = "  ".repeat(depth);
    const text = (node.textContent || "").trim().replace(/\s+/g, " ");
    const kids = Array.from(node.children);
    let s = pad + describeElement(node);
    if (kids.length > 0) {
      s += ` (${kids.length} children)`;
      const shown = kids.slice(0, maxChildren);
      s += shown.map((k) => "\n" + outline(k, depth + 1)).join("");
      if (kids.length > maxChildren) {
        s += `\n${pad}  … ${kids.length - maxChildren} more`;
      }
    } else if (text) {
      s += ` "${text.slice(0, 70)}"`;
    }
    return s;
  }

  /** Find the smallest ancestor that contains every given element. */
  function commonAncestor(elements) {
    if (elements.length === 0) return null;
    let container = elements[0].parentElement;
    while (container && !elements.every((n) => container.contains(n))) {
      container = container.parentElement;
    }
    return container;
  }

  function debugDOM() {
    const userMatches = Array.from(document.querySelectorAll(CLAUDE_USER_SELECTORS));
    const assistantMatches = Array.from(document.querySelectorAll(CLAUDE_ASSISTANT_SELECTORS));

    const testids = Array.from(document.querySelectorAll("[data-testid]"))
      .map((el) => el.getAttribute("data-testid"))
      .filter((v, i, a) => v && a.indexOf(v) === i)
      .sort();

    const container = commonAncestor(userMatches);

    return {
      site: detectSite(),
      title: getChatTitle(),
      testids,
      userSelectorsMatched: userMatches.length,
      assistantSelectorsMatched: assistantMatches.length,
      container: container ? describeElement(container) : null,
      containerOutline: container ? outline(container) : "",
      sampleUser: userMatches[0] ? outline(userMatches[0]) : null,
      sampleAssistant: assistantMatches[0] ? outline(assistantMatches[0]) : null,
    };
  }
})();
