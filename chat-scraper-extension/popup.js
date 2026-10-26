/* ============================================================
   Chattie – Popup Logic
   Detects the current site, triggers scraping, handles download.
   ============================================================ */

document.addEventListener("DOMContentLoaded", async () => {
  /* ---------- DOM refs ---------- */
  const siteStatus = document.getElementById("siteStatus");
  const siteBadgeContainer = document.getElementById("siteBadgeContainer");
  const siteBadge = document.getElementById("siteBadge");
  const badgeText = document.getElementById("badgeText");
  const scrapeBtn = document.getElementById("scrapeBtn");
  const btnIcon = document.getElementById("btnIcon");
  const btnText = document.getElementById("btnText");
  const inspectBtn = document.getElementById("inspectBtn");
  const inspectText = document.getElementById("inspectText");
  const inspectOutput = document.getElementById("inspectOutput");
  const inspectHint = document.getElementById("inspectHint");
  const statusArea = document.getElementById("statusArea");
  const statusMessage = document.getElementById("statusMessage");
  const previewSection = document.getElementById("previewSection");
  const previewCount = document.getElementById("previewCount");
  const previewList = document.getElementById("previewList");

  /* ---------- State ---------- */
  let scrapedData = null;

  /* ---------- Site Config ---------- */
  const SITE_CONFIG = {
    claude: { name: "Claude.ai", class: "claude", pattern: /claude\.ai/ },
    chatgpt: {
      name: "ChatGPT",
      class: "chatgpt",
      pattern: /chatgpt\.com|chat\.openai\.com/,
    },
    gemini: {
      name: "Google Gemini",
      class: "gemini",
      pattern: /gemini\.google\.com/,
    },
  };

  /* ---------- Detect current tab ---------- */
  let activeTab = null;
  let detectedSite = null;

  try {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    activeTab = tab;

    if (tab && tab.url) {
      for (const [key, config] of Object.entries(SITE_CONFIG)) {
        if (config.pattern.test(tab.url)) {
          detectedSite = key;
          break;
        }
      }
    }
  } catch (err) {
    console.error("Tab detection failed:", err);
  }

  if (detectedSite) {
    const config = SITE_CONFIG[detectedSite];
    siteStatus.textContent = "Ready to export";
    siteBadgeContainer.style.display = "block";
    siteBadge.className = `site-badge ${config.class}`;
    badgeText.textContent = config.name + " detected";
    scrapeBtn.disabled = false;
    inspectBtn.disabled = false;
  } else {
    siteStatus.textContent = "Navigate to a supported AI chat site";
    showStatus(
      "info",
      "Open a chat on Claude.ai, ChatGPT, or Gemini to export it as Markdown."
    );
  }

  /* ---------- Scrape button ---------- */
  scrapeBtn.addEventListener("click", async () => {
    if (!activeTab || !detectedSite) return;

    // Set loading state
    scrapeBtn.classList.add("loading");
    scrapeBtn.disabled = true;
    btnText.textContent = "Exporting…";
    btnIcon.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <path d="M12 2v4m0 12v4m-7.07-3.93l2.83-2.83m8.48-8.48l2.83-2.83M2 12h4m12 0h4M4.93 4.93l2.83 2.83m8.48 8.48l2.83 2.83" 
            stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
    </svg>`;

    hideStatus();
    previewSection.style.display = "none";

    try {
      // Inject content script if not already there, then send message
      // First try sending message; if it fails, inject the script
      let response;
      try {
        response = await chrome.tabs.sendMessage(activeTab.id, {
          action: "scrapeChat",
        });
      } catch (e) {
        // Content script might not be injected; inject it now
        await chrome.scripting.executeScript({
          target: { tabId: activeTab.id },
          files: ["content.js"],
        });
        // Wait a moment then retry
        await new Promise((r) => setTimeout(r, 300));
        response = await chrome.tabs.sendMessage(activeTab.id, {
          action: "scrapeChat",
        });
      }

      if (!response) {
        showStatus(
          "error",
          "No response from the page. Reload the chat tab and try again."
        );
        resetButton();
        return;
      }

      if (response.error) {
        showStatus("error", `Export failed: ${response.message}`);
        resetButton();
        return;
      }

      scrapedData = response.data;

      // Show preview
      showPreview(scrapedData);

      // Trigger download (Markdown is the only export format)
      const saveResult = await chrome.runtime.sendMessage({
        action: "downloadChat",
        data: scrapedData,
        format: "markdown",
      });

      if (!saveResult || !saveResult.success) {
        showStatus(
          "error",
          `Save failed: ${(saveResult && saveResult.error) || "unknown error"}`
        );
        resetButton();
        return;
      }

      // Success state
      scrapeBtn.classList.remove("loading");
      scrapeBtn.classList.add("success");
      btnIcon.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none">
        <path d="M20 6L9 17l-5-5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>`;
      btnText.textContent = "Saved!";

      if (response.warning) {
        showStatus(
          "info",
          `Saved ${scrapedData.messages.length} messages as Markdown, but: ${response.warning}`
        );
      } else {
        showStatus(
          "success",
          `${scrapedData.messages.length} messages exported as Markdown`
        );
      }

      // Reset button after delay
      setTimeout(() => {
        resetButton();
      }, 3000);
    } catch (err) {
      console.error("Scraping error:", err);
      showStatus("error", `Failed: ${err.message}`);
      resetButton();
    }
  });

  /* ---------- Inspect button (diagnostics) ---------- */
  inspectBtn.addEventListener("click", async () => {
    if (!activeTab || !detectedSite) return;

    inspectText.textContent = "Inspecting…";
    inspectBtn.disabled = true;
    inspectOutput.style.display = "none";
    inspectHint.style.display = "none";
    hideStatus();

    try {
      let response;
      try {
        response = await chrome.tabs.sendMessage(activeTab.id, { action: "debugDOM" });
      } catch (e) {
        await chrome.scripting.executeScript({
          target: { tabId: activeTab.id },
          files: ["content.js"],
        });
        await new Promise((r) => setTimeout(r, 300));
        response = await chrome.tabs.sendMessage(activeTab.id, { action: "debugDOM" });
      }

      if (!response || response.error) {
        showStatus(
          "error",
          `${(response && response.message) || "No response from the page."}`
        );
        resetInspect();
        return;
      }

      const d = response.data;
      const summary = `Site: ${d.site} · Title: ${d.title}
Unique data-testid values (${d.testids.length}):
  ${d.testids.join("\n  ")}
User selectors matched: ${d.userSelectorsMatched}
Assistant selectors matched: ${d.assistantSelectorsMatched}
Conversation container: ${d.container}`;

      const output = `${summary}

${d.sampleUser ? "SAMPLE USER TURN\n" + d.sampleUser : "NO USER TURN MATCHED"}

${d.sampleAssistant ? "SAMPLE ASSISTANT TURN\n" + d.sampleAssistant : "NO ASSISTANT TURN MATCHED"}

CONVERSATION CONTAINER OUTLINE
${d.containerOutline || "no container found"}`;

      inspectOutput.textContent = output;
      inspectOutput.style.display = "block";

      try {
        await navigator.clipboard.writeText(output);
        inspectHint.textContent =
          "Copied to clipboard — paste it into the bug report / chat.";
      } catch {
        inspectHint.textContent =
          "Select the text below and copy it into the bug report / chat.";
      }
      inspectHint.style.display = "block";
    } catch (err) {
      console.error("Inspect error:", err);
      showStatus("error", `Failed: ${err.message}`);
    } finally {
      resetInspect();
    }
  });

  function resetInspect() {
    inspectText.textContent = "Inspect page";
    inspectBtn.disabled = !detectedSite;
  }

  /* ---------- Helpers ---------- */

  function showStatus(type, message) {
    statusArea.style.display = "block";
    statusMessage.className = `status-message ${type}`;
    statusMessage.textContent = message;
  }

  function hideStatus() {
    statusArea.style.display = "none";
  }

  function resetButton() {
    scrapeBtn.classList.remove("loading", "success");
    scrapeBtn.disabled = !detectedSite;
    btnText.textContent = "Export as Markdown";
    btnIcon.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" 
            stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`;
  }

  function showPreview(data) {
    previewSection.style.display = "block";
    previewCount.textContent = `${data.messageCount} messages`;
    previewList.innerHTML = "";

    // Show first ~6 messages as preview
    const previewMessages = data.messages.slice(0, 6);
    previewMessages.forEach((msg) => {
      const item = document.createElement("div");
      item.className = `preview-item ${msg.role}`;

      const role = document.createElement("span");
      role.className = "preview-role";
      role.textContent = msg.role === "user" ? "You" : "Assistant";

      const content = document.createElement("span");
      content.className = "preview-content";
      content.textContent =
        msg.content.substring(0, 80) + (msg.content.length > 80 ? "…" : "");

      item.appendChild(role);
      item.appendChild(content);
      previewList.appendChild(item);
    });

    if (data.messages.length > 6) {
      const more = document.createElement("div");
      more.className = "preview-item";
      more.style.textAlign = "center";
      more.style.color = "#6b6862";
      more.style.fontStyle = "italic";
      more.textContent = `+ ${data.messages.length - 6} more messages`;
      previewList.appendChild(more);
    }
  }
});
