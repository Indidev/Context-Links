// Service worker: handles actions content scripts can't do directly (opening tabs).
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message !== "object") return;

  if (message.type === "openTab") {
    chrome.tabs.create({ url: message.url, active: message.active !== false });
    sendResponse({ ok: true });
    return true;
  }

  if (message.type === "navigateTab" && sender.tab) {
    chrome.tabs.update(sender.tab.id, { url: message.url });
    sendResponse({ ok: true });
    return true;
  }

  if (message.type === "runCode" && sender.tab) {
    // Run in the page's MAIN world (not the content script's isolated world) so
    // bookmarklet-style code can see the page's own globals (jQuery, app state, etc.).
    chrome.scripting.executeScript({
      target: { tabId: sender.tab.id },
      world: "MAIN",
      func: (code) => {
        try {
          (0, eval)(code);
        } catch (err) {
          console.error("URL Shortcuts: error running shortcut script", err);
        }
      },
      args: [message.code]
    });
    sendResponse({ ok: true });
    return true;
  }
});
