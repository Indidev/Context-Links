// Renders a floating shortcuts panel on pages matching configured rules.
(function () {
  "use strict";

  const C = window.URLShortcutsCommon;
  const HOST_ID = "url-shortcuts-host";
  const COLLAPSE_KEY = "url-shortcuts-collapsed";

  let shadowRoot = null;
  let panelEl = null;
  let listEl = null;
  let toggleEl = null;
  let lastUrl = "";
  let rulesCache = [];
  let settingsCache = C.DEFAULT_SETTINGS;

  let spacerResizeObserver = null;
  let spacerApplied = false;
  let originalHtmlPaddingTop = "";
  const nudgedElements = new Map(); // element -> its original inline `top` value

  const renderedShortcuts = new Map(); // shortcut.id -> { el, shortcut, match }

  function prefersReducedMotion() {
    try {
      return window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    } catch (err) {
      return false;
    }
  }

  function currentAnimationConfig() {
    return settingsCache.animation || C.DEFAULT_ANIMATION;
  }

  // Cancels ALL animations currently on `el`. A naturally-finished animation stays attached
  // to the element with its fill:forwards effect still visually applied (finishing alone
  // doesn't detach it), which would otherwise throw off the next getBoundingClientRect()
  // measurement - it'd reflect the old transform, not the element's true resting position.
  function cancelExistingAnimation(el) {
    for (const anim of el.getAnimations()) {
      anim.cancel();
    }
  }

  // Vector from `el`'s own (resting) center to the toggle button's center - the "origin" a
  // balloon flies from/to, and the distance used to order a staggered "pop".
  function vectorToToggle(el) {
    if (!toggleEl) return { dx: 0, dy: 0, dist: 0 };
    const t = toggleEl.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    const dx = t.left + t.width / 2 - (r.left + r.width / 2);
    const dy = t.top + t.height / 2 - (r.top + r.height / 2);
    return { dx, dy, dist: Math.hypot(dx, dy) };
  }

  function playEnter(el, cfg, vector, delay) {
    cancelExistingAnimation(el);
    let keyframes;
    let options;
    if (cfg.type === "balloon") {
      const duration = cfg.duration * (0.85 + Math.random() * 0.3);
      keyframes = [
        { transform: `translate(${vector.dx}px, ${vector.dy}px) scale(0.2)`, opacity: 0 },
        { transform: "translate(0px, 0px) scale(1)", opacity: 1 }
      ];
      options = { duration, easing: "cubic-bezier(0.22, 1, 0.36, 1)", fill: "both" };
    } else if (cfg.type === "pop") {
      keyframes = [
        { transform: "scale(0)", opacity: 0 },
        { transform: "scale(1)", opacity: 1 }
      ];
      options = { duration: cfg.duration, delay, easing: "cubic-bezier(0.34, 1.56, 0.64, 1)", fill: "both" };
    } else {
      keyframes = [{ opacity: 0 }, { opacity: 1 }];
      options = { duration: cfg.duration, easing: "ease-out", fill: "both" };
    }
    el.animate(keyframes, options);
  }

  function playExit(el, cfg, vector, delay, onDone) {
    cancelExistingAnimation(el);
    let keyframes;
    let options;
    if (cfg.type === "balloon") {
      const duration = cfg.duration * (0.85 + Math.random() * 0.3);
      keyframes = [
        { transform: "translate(0px, 0px) scale(1)", opacity: 1 },
        { transform: `translate(${vector.dx}px, ${vector.dy}px) scale(0.2)`, opacity: 0 }
      ];
      options = { duration, easing: "cubic-bezier(0.55, 0, 1, 0.45)", fill: "both" };
    } else if (cfg.type === "pop") {
      keyframes = [
        { transform: "scale(1)", opacity: 1 },
        { transform: "scale(0)", opacity: 0 }
      ];
      options = { duration: cfg.duration, delay, easing: "cubic-bezier(0.55, 0, 1, 0.45)", fill: "both" };
    } else {
      keyframes = [{ opacity: 1 }, { opacity: 0 }];
      options = { duration: cfg.duration, easing: "ease-in", fill: "both" };
    }
    const anim = el.animate(keyframes, options);
    anim.onfinish = onDone;
    anim.oncancel = onDone;
  }

  // Runs the configured enter/exit animation for a batch of elements that are all
  // appearing/disappearing together (e.g. a toggle click, or a set of shortcuts added/removed
  // by a rule change). `pop` staggers nearest-to-toggle first on enter, farthest-first on exit;
  // `balloon` flies every element from/to the toggle's position with a touch of speed variance;
  // `fade` and `none` are simple/synchronized (uniform or instant, respectively).
  function animateBatch(elements, direction, onAllDone) {
    const cfg = currentAnimationConfig();
    if (!elements.length) {
      if (onAllDone) onAllDone();
      return;
    }
    if (cfg.type === "none" || prefersReducedMotion()) {
      if (onAllDone) onAllDone();
      return;
    }
    // Cancel any in-flight animation on these elements *before* measuring - a running or
    // fill:forwards-finished animation offsets the element via `transform`, and
    // getBoundingClientRect() reports that transformed (not resting) box. Measuring first
    // would compute the vector from wherever the old animation left it - e.g. right on top of
    // the toggle after a collapse - producing a near-zero, invisible translation on the next
    // enter.
    elements.forEach(cancelExistingAnimation);
    const items = elements.map((el) => ({ el, vector: vectorToToggle(el) }));
    if (cfg.type === "pop") {
      items.sort((a, b) => (direction === "enter" ? a.vector.dist - b.vector.dist : b.vector.dist - a.vector.dist));
    }
    const step = Math.min(120, cfg.duration / items.length);
    let remaining = items.length;
    items.forEach((item, rank) => {
      const delay = cfg.type === "pop" ? rank * step : 0;
      if (direction === "enter") {
        playEnter(item.el, cfg, item.vector, delay);
      } else {
        playExit(item.el, cfg, item.vector, delay, () => {
          remaining -= 1;
          if (remaining <= 0 && onAllDone) onAllDone();
        });
      }
    });
    // "enter" has no completion callback needed by callers today, but keep the signature
    // symmetric in case a future caller wants to know when entrances finish too.
    if (direction === "enter" && onAllDone) onAllDone();
  }

  function isBarPosition(position) {
    return position === "shortcutbar-left" || position === "shortcutbar-right";
  }

  // Padding <html> only pushes normal document flow down - it does nothing for the page's
  // OWN position:fixed/sticky elements near the top (e.g. a site's sticky nav), which stay
  // anchored to the real viewport top and end up hidden under our bar. Best-effort fix: find
  // such elements (bounded depth/proximity scan to keep this cheap) and push their `top`
  // offset down by the bar's height too, so a fixed header is fully visible below the bar and
  // a sticky header re-sticks just beneath it instead of at the very top once scrolled.
  function collectTopAnchoredElements(root, depth, results) {
    if (depth <= 0 || !root.children) return;
    for (const el of root.children) {
      if (el.id === HOST_ID) continue;
      const rect = el.getBoundingClientRect();
      // Skip subtrees with no size or that are clearly not near the top of the page.
      if (rect.width === 0 && rect.height === 0) continue;
      if (rect.top > 200) continue;
      const style = getComputedStyle(el);
      if (style.position === "fixed" || style.position === "sticky") {
        const top = parseFloat(style.top);
        if (!Number.isNaN(top) && top <= 4) results.push(el);
      }
      collectTopAnchoredElements(el, depth - 1, results);
    }
  }

  function restoreNudgedElements() {
    for (const [el, originalTop] of nudgedElements) {
      if (originalTop === null) {
        el.style.removeProperty("top");
      } else {
        el.style.top = originalTop;
      }
    }
    nudgedElements.clear();
  }

  function nudgeTopAnchoredElements(barHeight) {
    restoreNudgedElements();
    if (!barHeight) return;
    const candidates = [];
    collectTopAnchoredElements(document.body, 6, candidates);
    for (const el of candidates) {
      const computedTop = getComputedStyle(el).top;
      nudgedElements.set(el, el.style.top || null);
      el.style.top = `calc(${computedTop} + ${barHeight}px)`;
    }
  }

  // Bar positions dock at the very top of the page and would otherwise overlay content,
  // so reserve space for them by padding <html> with the bar's live (resize-observed) height.
  function ensureBodySpacing(panel) {
    if (!spacerApplied) {
      originalHtmlPaddingTop = document.documentElement.style.paddingTop;
      spacerApplied = true;
    }
    const update = () => {
      const height = panel.getBoundingClientRect().height;
      document.documentElement.style.paddingTop = originalHtmlPaddingTop
        ? `calc(${originalHtmlPaddingTop} + ${height}px)`
        : `${height}px`;
      nudgeTopAnchoredElements(height);
    };
    update();
    if (spacerResizeObserver) spacerResizeObserver.disconnect();
    spacerResizeObserver = new ResizeObserver(update);
    spacerResizeObserver.observe(panel);
  }

  function removeBodySpacing() {
    if (spacerResizeObserver) {
      spacerResizeObserver.disconnect();
      spacerResizeObserver = null;
    }
    if (spacerApplied) {
      document.documentElement.style.paddingTop = originalHtmlPaddingTop;
      spacerApplied = false;
    }
    restoreNudgedElements();
  }

  function ensureHost() {
    if (shadowRoot) return shadowRoot;
    const host = document.createElement("div");
    host.id = HOST_ID;
    host.style.all = "initial";
    (document.body || document.documentElement).appendChild(host);
    shadowRoot = host.attachShadow({ mode: "open" });

    const style = document.createElement("style");
    style.textContent = `
      :host { all: initial; }
      .panel {
        position: fixed;
        z-index: 2147483647;
        display: flex;
        gap: 6px;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
      }
      .list {
        display: flex;
        gap: 6px;
      }

      /* Floating corner positions */
      .panel[data-position="top-left"],
      .panel[data-position="top-right"],
      .panel[data-position="bottom-left"],
      .panel[data-position="bottom-right"] {
        flex-direction: column;
      }
      .panel[data-position="top-left"] .list,
      .panel[data-position="top-right"] .list,
      .panel[data-position="bottom-left"] .list,
      .panel[data-position="bottom-right"] .list {
        flex-direction: column;
      }
      .panel[data-position="top-left"] { top: 12px; left: 12px; align-items: flex-start; }
      .panel[data-position="top-left"] .list { align-items: flex-start; }
      .panel[data-position="top-right"] { top: 12px; right: 12px; align-items: flex-end; }
      .panel[data-position="top-right"] .list { align-items: flex-end; }
      .panel[data-position="bottom-left"] { bottom: 12px; left: 12px; align-items: flex-start; }
      .panel[data-position="bottom-left"] .list { align-items: flex-start; }
      .panel[data-position="bottom-right"] { bottom: 12px; right: 12px; align-items: flex-end; }
      .panel[data-position="bottom-right"] .list { align-items: flex-end; }
      /* Toggle sits nearest the screen edge: above the list for top positions. */
      .panel[data-position="top-left"] .toggle-btn,
      .panel[data-position="top-right"] .toggle-btn {
        order: -1;
      }

      /* Full-width "shortcut bar" docked at the very top of the page */
      .panel[data-position="shortcutbar-left"],
      .panel[data-position="shortcutbar-right"] {
        top: 0;
        left: 0;
        right: 0;
        flex-direction: row;
        align-items: center;
        gap: 10px;
        padding: 6px 10px;
        background: color-mix(in srgb, var(--sc-bg, #1f2937) var(--sc-opacity, 100%), transparent);
        box-shadow: 0 2px 8px rgba(0,0,0,0.25);
      }
      .panel[data-position="shortcutbar-left"] .toggle-btn,
      .panel[data-position="shortcutbar-right"] .toggle-btn {
        order: -1;
        box-shadow: none;
        flex: none;
      }
      .panel[data-position="shortcutbar-left"] .list,
      .panel[data-position="shortcutbar-right"] .list {
        flex-direction: row;
        flex: 1;
        flex-wrap: wrap;
        align-items: center;
      }
      .panel[data-position="shortcutbar-left"] .list { justify-content: flex-start; }
      .panel[data-position="shortcutbar-right"] .list { justify-content: flex-end; }
      .shortcut-btn {
        display: flex;
        align-items: center;
        gap: 6px;
        background: color-mix(in srgb, var(--sc-bg, #1f2937) var(--sc-opacity, 100%), transparent);
        color: var(--sc-text, #ffffff);
        border: none;
        border-radius: 999px;
        padding: 6px 12px;
        font-size: var(--sc-font-size, 13px);
        line-height: 1.2;
        cursor: pointer;
        box-shadow: 0 2px 8px rgba(0,0,0,0.25);
        max-width: 260px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .shortcut-btn:hover {
        filter: brightness(1.2);
      }
      .shortcut-btn img {
        width: var(--sc-icon-size, 18px);
        height: var(--sc-icon-size, 18px);
        border-radius: 4px;
        flex: none;
        object-fit: contain;
      }
      .shortcut-btn .tabler-icon-svg {
        flex: none;
        display: block;
      }
      .shortcut-btn .label {
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .toggle-btn {
        width: 32px;
        height: 32px;
        border-radius: 999px;
        border: none;
        background: color-mix(in srgb, color-mix(in srgb, var(--sc-bg, #1f2937) 85%, black) var(--sc-opacity, 100%), transparent);
        color: var(--sc-text, #ffffff);
        cursor: pointer;
        box-shadow: 0 2px 8px rgba(0,0,0,0.25);
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .toggle-btn img {
        width: 20px;
        height: 20px;
        display: block;
      }
      .toggle-btn:hover {
        filter: brightness(1.2);
      }
    `;
    shadowRoot.appendChild(style);

    panelEl = document.createElement("div");
    panelEl.className = "panel";

    listEl = document.createElement("div");
    listEl.className = "list";

    toggleEl = document.createElement("button");
    toggleEl.className = "toggle-btn";
    toggleEl.type = "button";
    const toggleIcon = document.createElement("img");
    toggleIcon.src = chrome.runtime.getURL("icons/icon-overlay.svg");
    toggleIcon.alt = "";
    toggleEl.appendChild(toggleIcon);
    toggleEl.title = "Toggle URL shortcuts";
    toggleEl.addEventListener("click", () => {
      const collapsing = !panelEl.classList.contains("collapsed");
      panelEl.classList.toggle("collapsed", collapsing);
      try {
        window.localStorage.setItem(COLLAPSE_KEY, collapsing ? "1" : "0");
      } catch (err) {
        /* localStorage may be unavailable, ignore */
      }
      const currentEls = [...renderedShortcuts.values()].map((entry) => entry.el);
      if (collapsing) {
        animateBatch(currentEls, "exit", () => {
          // If the user re-expanded before this (now-canceled-or-finished) exit's callback
          // ran, the panel is no longer logically collapsed - don't re-hide it out from under
          // the enter animation that's already playing.
          if (panelEl.classList.contains("collapsed")) {
            listEl.style.display = "none";
          }
        });
      } else {
        listEl.style.removeProperty("display");
        animateBatch(currentEls, "enter");
      }
    });

    panelEl.appendChild(listEl);
    panelEl.appendChild(toggleEl);
    shadowRoot.appendChild(panelEl);

    let collapsed = false;
    try {
      collapsed = window.localStorage.getItem(COLLAPSE_KEY) === "1";
    } catch (err) {
      /* ignore */
    }
    if (collapsed) {
      panelEl.classList.add("collapsed");
      listEl.style.display = "none";
    }

    return shadowRoot;
  }

  function removeHost() {
    const host = document.getElementById(HOST_ID);
    if (host) host.remove();
    shadowRoot = null;
    panelEl = null;
    listEl = null;
    toggleEl = null;
    renderedShortcuts.clear();
    removeBodySpacing();
  }

  // Removes the whole panel, animating any currently-visible shortcuts out first.
  // Skips the animation if the panel is collapsed - nothing is visible to animate anyway.
  function removeHostAnimated() {
    const isCollapsed = listEl && listEl.style.display === "none";
    if (!panelEl || renderedShortcuts.size === 0 || isCollapsed) {
      removeHost();
      return;
    }
    const els = [...renderedShortcuts.values()].map((entry) => entry.el);
    animateBatch(els, "exit", () => removeHost());
  }

  function runJavascriptShortcut(code) {
    // Delegate to the background worker so the code runs in the page's MAIN world
    // (content scripts run in an isolated world and can't see page-defined globals).
    chrome.runtime.sendMessage({ type: "runCode", code });
  }

  function openUrl(url, openInNewTab) {
    if (openInNewTab) {
      chrome.runtime.sendMessage({ type: "openTab", url, active: true });
    } else {
      window.location.href = url;
    }
  }

  function handleShortcutClick(evt, shortcut, match) {
    evt.preventDefault();
    const action = C.resolveAction(shortcut.targetUrl, window.location.href, match);
    const newTab = evt.ctrlKey || evt.metaKey || evt.button === 1;
    if (action.type === "javascript") {
      // javascript: shortcuts always run against the current tab.
      runJavascriptShortcut(action.code);
    } else {
      openUrl(action.url, newTab);
    }
  }

  function updateShortcutButtonContent(el, shortcut) {
    el.title = C.tooltipFor(shortcut);
    el.innerHTML = "";
    const appearance = settingsCache.appearance || C.DEFAULT_APPEARANCE;
    if (shortcut.icon) {
      const tablerSettings = {
        size: C.iconSizeForFontSize(appearance.size),
        strokeWidth: C.TABLER_ICON_STROKE_WIDTH,
        color: appearance.text
      };
      el.appendChild(C.buildIconElement(shortcut.icon, tablerSettings, shadowRoot));
      if (!appearance.showTextWithIcons) return;
    }
    const label = document.createElement("span");
    label.className = "label";
    label.textContent = shortcut.name || shortcut.targetUrl;
    el.appendChild(label);
  }

  // `state` is a mutable {shortcut, match} box so click handlers always act on the latest
  // data even though the button element itself is reused across re-renders (no re-binding).
  function buildShortcutButton(state) {
    const btn = document.createElement("button");
    btn.className = "shortcut-btn";
    btn.type = "button";
    updateShortcutButtonContent(btn, state.shortcut);

    const onClick = (evt) => handleShortcutClick(evt, state.shortcut, state.match);
    btn.addEventListener("click", onClick);
    btn.addEventListener("auxclick", (evt) => {
      if (evt.button === 1) onClick(evt);
    });
    return btn;
  }

  // Diffs the new match set against what's currently rendered: shortcuts that are still
  // present are updated in place (no animation - nothing "appeared"), newly-matching
  // shortcuts animate in, and no-longer-matching ones animate out then get removed.
  function updateShortcutList(matches) {
    const newIds = new Set(matches.map(({ shortcut }) => shortcut.id));
    const toRemove = [];
    for (const [id, entry] of renderedShortcuts) {
      if (!newIds.has(id)) toRemove.push(entry);
    }

    const newlyAdded = [];
    for (const { shortcut, match } of matches) {
      let entry = renderedShortcuts.get(shortcut.id);
      if (!entry) {
        const state = { shortcut, match };
        entry = { el: buildShortcutButton(state), state };
        renderedShortcuts.set(shortcut.id, entry);
        newlyAdded.push(entry);
      } else {
        entry.state.shortcut = shortcut;
        entry.state.match = match;
        updateShortcutButtonContent(entry.el, shortcut);
      }
      listEl.appendChild(entry.el); // (re)places it at the end, in `matches` order
    }

    // While the list is collapsed (display:none), its children have no box at all - measuring
    // them for a balloon/pop vector would compute garbage (everything reads as 0,0). There's
    // nothing to visibly animate anyway, so just add/remove silently; the toggle's own
    // expand/collapse handling is what animates them once the list becomes visible again.
    const listVisible = listEl.style.display !== "none";

    if (newlyAdded.length) {
      animateBatch(listVisible ? newlyAdded.map((entry) => entry.el) : [], "enter");
    }
    if (toRemove.length) {
      for (const entry of toRemove) renderedShortcuts.delete(entry.state.shortcut.id);
      animateBatch(listVisible ? toRemove.map((entry) => entry.el) : [], "exit", () => {
        for (const entry of toRemove) entry.el.remove();
      });
    }
  }

  function render(matches) {
    if (!matches.length) {
      removeHostAnimated();
      return;
    }
    ensureHost();
    const position = settingsCache.position || C.DEFAULT_SETTINGS.position;
    panelEl.dataset.position = position;
    const appearance = settingsCache.appearance || C.DEFAULT_APPEARANCE;
    panelEl.style.setProperty("--sc-bg", appearance.background);
    panelEl.style.setProperty("--sc-text", appearance.text);
    panelEl.style.setProperty("--sc-opacity", `${appearance.opacity}%`);
    panelEl.style.setProperty("--sc-font-size", `${appearance.size}px`);
    panelEl.style.setProperty("--sc-icon-size", `${C.iconSizeForFontSize(appearance.size)}px`);
    if (isBarPosition(position)) {
      ensureBodySpacing(panelEl);
    } else {
      removeBodySpacing();
    }
    updateShortcutList(matches);
  }

  function refresh() {
    if (settingsCache.enabled === false) {
      removeHostAnimated();
      return;
    }
    const matches = C.matchShortcuts(window.location.href, rulesCache);
    render(matches);
  }

  function checkUrlChange() {
    if (window.location.href !== lastUrl) {
      lastUrl = window.location.href;
      refresh();
    }
  }

  function watchForSpaNavigation() {
    const wrap = (fnName) => {
      const original = history[fnName];
      history[fnName] = function (...args) {
        const result = original.apply(this, args);
        checkUrlChange();
        return result;
      };
    };
    wrap("pushState");
    wrap("replaceState");
    window.addEventListener("popstate", checkUrlChange);
    window.addEventListener("hashchange", checkUrlChange);
    // Fallback poll in case a framework navigates without touching history/hash.
    setInterval(checkUrlChange, 1000);
  }

  async function init() {
    [settingsCache, rulesCache] = await Promise.all([C.getSettings(), C.getRules()]);
    lastUrl = window.location.href;
    refresh();
    watchForSpaNavigation();

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local") return;
      if (changes[C.STORAGE_KEY_RULES]) {
        rulesCache = changes[C.STORAGE_KEY_RULES].newValue || [];
      }
      if (changes[C.STORAGE_KEY_SETTINGS]) {
        settingsCache = C.normalizeSettings(changes[C.STORAGE_KEY_SETTINGS].newValue);
      }
      refresh();
    });
  }

  init();
})();
