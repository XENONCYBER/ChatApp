/* ============================================================
   Chattie – Background Service Worker
   Handles file downloads and coordinates between popup + content
   ============================================================ */

const SITE_NAMES = {
  claude: "Claude",
  chatgpt: "ChatGPT",
  gemini: "Gemini",
};

/* Machine-readable turn delimiters.

   These are HTML comments, so they are invisible when the Markdown is
   rendered, but they let the viewer split turns with zero ambiguity.
   The previous format relied on splitting at every `###` heading, which
   silently shredded any assistant reply that contained its own headings. */
const MSG_OPEN = (role, index) => `<!--MSG role="${role}" index="${index}"-->`;
const MSG_CLOSE = "<!--/MSG-->";

/** Neutralize delimiters that appear inside message text. */
function escapeDelimiters(text) {
  return String(text == null ? "" : text)
    .replace(/<!--\s*MSG\b/gi, "<!-‌-MSG")
    .replace(/<!--\s*\/MSG\s*-->/gi, "<!-‌-/MSG-->");
}

function formatExportDate(timestamp) {
  const date = new Date(timestamp);
  if (isNaN(date.getTime())) return new Date().toISOString();
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Convert scraped data to Markdown */
function toMarkdown(data) {
  const siteName = SITE_NAMES[data.site] || data.site;
  const messages = Array.isArray(data.messages) ? data.messages : [];

  let md = "";
  md += `# ${data.title || siteName + " Chat"}\n\n`;
  md += `> **Source:** ${siteName}  \n`;
  md += `> **URL:** ${data.url}  \n`;
  md += `> **Exported:** ${formatExportDate(data.timestamp)}  \n`;
  md += `> **Timestamp:** ${data.timestamp}  \n`;
  md += `> **Messages:** ${messages.length}  \n\n`;
  md += `---\n\n`;

  messages.forEach((msg, i) => {
    const role = msg.role === "user" ? "user" : "assistant";
    const label = role === "user" ? "👤 You" : `🤖 ${siteName}`;
    const body = escapeDelimiters(msg.content).replace(/\s+$/, "");

    md += `${MSG_OPEN(role, i)}\n\n`;
    md += `### ${label}\n\n`;
    md += `${body}\n\n`;
    md += `${MSG_CLOSE}\n\n`;
    if (i < messages.length - 1) md += `---\n\n`;
  });

  return md;
}

/** Convert scraped data to JSON */
function toJSON(data) {
  const messages = Array.isArray(data.messages) ? data.messages : [];
  return JSON.stringify(
    {
      schemaVersion: data.schemaVersion || 1,
      site: data.site,
      title: data.title,
      url: data.url,
      timestamp: data.timestamp,
      messageCount: messages.length,
      messages: messages.map((m) => ({
        role: m.role === "user" ? "user" : "assistant",
        content: String(m.content == null ? "" : m.content),
      })),
    },
    null,
    2
  );
}

/** Generate a safe filename from the title */
function safeFilename(title) {
  const base = String(title || "")
    .toLowerCase()
    // Keep unicode letters/digits, drop everything the filesystem dislikes.
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^[_-]+|[_-]+$/g, "")
    .substring(0, 60)
    .replace(/[_-]+$/, "");
  return base || "chat";
}

/** Encode a UTF-8 string to base64 without relying on deprecated escape(). */
function utf8ToBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/** Trigger download via chrome.downloads API using a data URL */
function downloadFile(content, filename, mimeType) {
  return new Promise((resolve, reject) => {
    const dataUrl = `data:${mimeType};charset=utf-8;base64,${utf8ToBase64(content)}`;
    chrome.downloads.download(
      { url: dataUrl, filename, saveAs: false },
      (downloadId) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(downloadId);
        }
      }
    );
  });
}

/* ---------- Message handler ---------- */
chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  if (!request || request.action !== "downloadChat") return false;

  (async () => {
    try {
      const { data, format } = request;
      if (!data || !Array.isArray(data.messages) || data.messages.length === 0) {
        throw new Error("Nothing to export: no messages were scraped.");
      }

      const stamp = new Date().toISOString().replace(/[:.]/g, "-").substring(0, 19);
      const baseName = safeFilename(data.title || `${data.site}_chat`);
      const files = [];

      if (format === "markdown" || format === "both") {
        files.push([toMarkdown(data), `chats/${data.site}_${baseName}_${stamp}.md`, "text/markdown"]);
      }
      if (format === "json" || format === "both") {
        files.push([toJSON(data), `chats/${data.site}_${baseName}_${stamp}.json`, "application/json"]);
      }
      if (!files.length) throw new Error(`Unknown export format: ${format}`);

      for (const [content, filename, mime] of files) {
        await downloadFile(content, filename, mime);
      }

      sendResponse({ success: true, files: files.map((f) => f[1]) });
    } catch (err) {
      console.error("Export failed:", err);
      sendResponse({ success: false, error: err.message });
    }
  })();

  return true; // keep the channel open for the async response
});
