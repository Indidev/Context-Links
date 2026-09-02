(function () {
  "use strict";

  const C = window.URLShortcutsCommon;

  const listEl = document.getElementById("list");
  const emptyEl = document.getElementById("empty");
  const overlayEnabled = document.getElementById("overlay-enabled");
  const optionsBtn = document.getElementById("options-btn");

  let activeTab = null;
  // Fixed, independent of the on-page panel's (user-configurable) Appearance settings - the
  // popup always has its own light background regardless of what the panel's colors are set
  // to, so tinting icons with e.g. the panel's white text color would make them invisible here.
  const ICON_RENDER_SETTINGS = { size: 20, strokeWidth: C.TABLER_ICON_STROKE_WIDTH, color: "#1f2937" };

  function runJavascriptInTab(tabId, code) {
    chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: (src) => {
        try {
          (0, eval)(src);
        } catch (err) {
          console.error("URL Shortcuts: error running shortcut script", err);
        }
      },
      args: [code]
    });
  }

  function handleClick(evt, shortcut, match) {
    if (!activeTab) return;
    const action = C.resolveAction(shortcut.targetUrl, activeTab.url, match);
    if (action.type === "javascript") {
      runJavascriptInTab(activeTab.id, action.code);
      window.close();
      return;
    }
    if (evt.ctrlKey || evt.metaKey || shortcut.openInNewTab) {
      chrome.tabs.create({ url: action.url, active: true });
    } else {
      chrome.tabs.update(activeTab.id, { url: action.url });
    }
    window.close();
  }

  function renderMatches(matches) {
    listEl.innerHTML = "";
    emptyEl.hidden = matches.length !== 0;
    for (const { shortcut, match } of matches) {
      const btn = document.createElement("button");
      btn.className = "shortcut-item";
      btn.type = "button";
      btn.title = C.tooltipFor(shortcut);

      if (shortcut.icon) {
        btn.appendChild(C.buildIconElement(shortcut.icon, ICON_RENDER_SETTINGS));
      }

      const text = document.createElement("div");
      text.className = "text";
      const name = document.createElement("div");
      name.className = "name";
      name.textContent = shortcut.name || shortcut.targetUrl;
      text.appendChild(name);
      if (shortcut.description) {
        const desc = document.createElement("div");
        desc.className = "desc";
        desc.textContent = shortcut.description;
        text.appendChild(desc);
      }
      btn.appendChild(text);

      btn.addEventListener("click", (evt) => handleClick(evt, shortcut, match));
      listEl.appendChild(btn);
    }
  }

  optionsBtn.addEventListener("click", () => {
    chrome.runtime.openOptionsPage();
  });

  overlayEnabled.addEventListener("change", async () => {
    await C.setSettings({ enabled: overlayEnabled.checked });
    refresh();
  });

  async function refresh() {
    const [settings, rules] = await Promise.all([C.getSettings(), C.getRules()]);
    overlayEnabled.checked = settings.enabled !== false;
    // The popup always lists matches for the active tab, regardless of the overlay
    // toggle - that toggle only controls whether the floating panel shows on the page.
    if (!activeTab || !activeTab.url) {
      renderMatches([]);
      return;
    }
    renderMatches(C.matchShortcuts(activeTab.url, rules));
  }

  async function init() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    activeTab = tab || null;
    await refresh();
  }

  init();
})();
