// Shared logic used by content script, popup and options page.
// Loaded as a plain (non-module) script so it attaches to the global scope.
(function (global) {
  "use strict";

  const STORAGE_KEY_RULES = "rules";
  const STORAGE_KEY_SETTINGS = "settings";
  const POSITIONS = ["top-left", "top-right", "bottom-left", "bottom-right", "shortcutbar-left", "shortcutbar-right"];
  // "Appearance": background/opacity color the panel itself; text color also colors Tabler
  // icons (they're stroke-based, not fixed raster images); size is a single base font-size
  // that icon size is derived from (see ICON_TO_FONT_SIZE_RATIO) so both scale together.
  // showTextWithIcons: off by default (icon-only, matching the original look) - when on, a
  // shortcut with an icon also shows its name next to it instead of hiding it.
  const DEFAULT_APPEARANCE = { background: "#1f2937", text: "#ffffff", opacity: 75, size: 14, showTextWithIcons: false };
  const APPEARANCE_SIZE_MIN = 10;
  const APPEARANCE_SIZE_MAX = 28;
  const APPEARANCE_OPACITY_MIN = 10;
  const APPEARANCE_OPACITY_MAX = 100;
  const ANIMATION_TYPES = ["none", "balloon", "pop", "fade"];
  const DEFAULT_ANIMATION = { type: "pop", duration: 500 };
  const ANIMATION_DURATION_MIN = 50;
  const ANIMATION_DURATION_MAX = 2000;
  // 20px icons paired well with 14px text, so that's the ratio every other size derives from.
  const ICON_TO_FONT_SIZE_RATIO = 20 / 14;
  const TABLER_ICON_STROKE_WIDTH = 2;
  const TABLER_ICON_PREFIX = ":";
  const LEGACY_TABLER_ICON_PREFIX = "tabler:";
  const THEME_OPTIONS = ["system", "light", "dark"];
  const DEFAULT_THEME = "system";
  const DEFAULT_SETTINGS = {
    enabled: true,
    position: "bottom-left",
    appearance: DEFAULT_APPEARANCE,
    animation: DEFAULT_ANIMATION,
    theme: DEFAULT_THEME
  };

  function iconSizeForFontSize(fontSize) {
    return Math.max(1, Math.round(fontSize * ICON_TO_FONT_SIZE_RATIO));
  }

  function isTablerIcon(iconValue) {
    return (
      typeof iconValue === "string" &&
      (iconValue.startsWith(TABLER_ICON_PREFIX) || iconValue.startsWith(LEGACY_TABLER_ICON_PREFIX))
    );
  }

  function tablerIconName(iconValue) {
    if (typeof iconValue !== "string") return "";
    if (iconValue.startsWith(TABLER_ICON_PREFIX)) return iconValue.slice(TABLER_ICON_PREFIX.length);
    if (iconValue.startsWith(LEGACY_TABLER_ICON_PREFIX)) return iconValue.slice(LEGACY_TABLER_ICON_PREFIX.length);
    return "";
  }

  function tablerIconValue(name) {
    return TABLER_ICON_PREFIX + name;
  }

  function uid() {
    if (global.crypto && global.crypto.randomUUID) {
      return global.crypto.randomUUID();
    }
    return "id-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2);
  }

  function emptyShortcut() {
    return {
      id: uid(),
      name: "",
      description: "",
      icon: "",
      targetUrl: "",
      openInNewTab: false
    };
  }

  function emptyPatternCondition() {
    return { id: uid(), pattern: "", flags: "i", mode: "exclude" };
  }

  function emptyRule() {
    return {
      id: uid(),
      name: "",
      pattern: "",
      flags: "i",
      enabled: true,
      extraPatterns: [],
      shortcuts: [emptyShortcut()]
    };
  }

  function normalizeAppearance(rawAppearance) {
    const appearance = Object.assign({}, DEFAULT_APPEARANCE, rawAppearance || {});
    const opacity = Number(appearance.opacity);
    appearance.opacity = Number.isFinite(opacity)
      ? Math.min(APPEARANCE_OPACITY_MAX, Math.max(APPEARANCE_OPACITY_MIN, opacity))
      : DEFAULT_APPEARANCE.opacity;
    const size = Number(appearance.size);
    appearance.size = Number.isFinite(size)
      ? Math.min(APPEARANCE_SIZE_MAX, Math.max(APPEARANCE_SIZE_MIN, size))
      : DEFAULT_APPEARANCE.size;
    appearance.showTextWithIcons = appearance.showTextWithIcons === true;
    return appearance;
  }

  function normalizeAnimation(rawAnimation) {
    const animation = Object.assign({}, DEFAULT_ANIMATION, rawAnimation || {});
    if (!ANIMATION_TYPES.includes(animation.type)) animation.type = DEFAULT_ANIMATION.type;
    const duration = Number(animation.duration);
    animation.duration = Number.isFinite(duration)
      ? Math.min(ANIMATION_DURATION_MAX, Math.max(ANIMATION_DURATION_MIN, duration))
      : DEFAULT_ANIMATION.duration;
    return animation;
  }

  // Fills in defaults and fixes up shape (invalid position, missing/partial fields). Safe to
  // call on raw storage data, a live settings object, or undefined. Rebuilds a clean whitelisted
  // object rather than spreading `raw` wholesale, so retired fields (the old per-field `colors`
  // key, predating "appearance"; the old dedicated `tablerIcon` settings) don't linger in
  // storage - `raw.colors` is still read as a fallback so upgrading users keep their chosen
  // background/text/opacity.
  function normalizeSettings(raw) {
    raw = raw || {};
    return {
      enabled: raw.enabled !== false,
      position: POSITIONS.includes(raw.position) ? raw.position : DEFAULT_SETTINGS.position,
      appearance: normalizeAppearance(raw.appearance || raw.colors),
      animation: normalizeAnimation(raw.animation),
      theme: THEME_OPTIONS.includes(raw.theme) ? raw.theme : DEFAULT_THEME
    };
  }

  async function getSettings() {
    const data = await chrome.storage.local.get(STORAGE_KEY_SETTINGS);
    return normalizeSettings(data[STORAGE_KEY_SETTINGS]);
  }

  // Patches (not replaces) the stored settings, so callers can pass just the field(s) they
  // change; `appearance`/`animation` are merged one level deep so a partial update doesn't drop
  // the rest of that group.
  async function setSettings(partial) {
    const current = await getSettings();
    const merged = normalizeSettings(
      Object.assign({}, current, partial, {
        appearance: Object.assign({}, current.appearance, partial.appearance || {}),
        animation: Object.assign({}, current.animation, partial.animation || {})
      })
    );
    await chrome.storage.local.set({ [STORAGE_KEY_SETTINGS]: merged });
    return merged;
  }

  async function getRules() {
    const data = await chrome.storage.local.get(STORAGE_KEY_RULES);
    return Array.isArray(data[STORAGE_KEY_RULES]) ? data[STORAGE_KEY_RULES] : [];
  }

  async function setRules(rules) {
    await chrome.storage.local.set({ [STORAGE_KEY_RULES]: rules });
  }

  // Returns true/false for a valid, non-empty pattern, or null for an empty/invalid one (so
  // callers can treat it as inert rather than as a hard pass/fail).
  function extraPatternMatches(url, extra) {
    if (!extra || !extra.pattern) return null;
    try {
      return new RegExp(extra.pattern, extra.flags || "").test(url);
    } catch (err) {
      return null;
    }
  }

  // Returns the RegExp.exec() result whose capture groups should be used for this rule's
  // shortcuts' $1-style substitution, or null if the rule doesn't match `url` at all.
  //
  // A hit on any "exclude" ("Must NOT match") condition unconditionally vetoes the whole rule -
  // it takes priority over everything else, including an "or" condition that would have
  // otherwise let the rule through. Short of that veto: the primary pattern's own match is used
  // if it matches; otherwise each "or" ("OR match") condition is tried in the order it was
  // added, and the first one that matches provides its own capture groups instead - it's an
  // alternate way into the rule that doesn't need the primary pattern to also hold (e.g. primary
  // `google\.com/maps/search/(.*)` + an "or" condition `google\.com/(.*)` still resolves `$1`
  // from whichever of the two actually matched). Anything other than "or" counts as "exclude"
  // here, so rules saved with the old "include"/"Must also match" mode now behave as "exclude"
  // conditions instead. Invalid/empty extra patterns are inert: they never trigger an "exclude"
  // veto and never count as an "or" match.
  function resolveRuleMatch(url, primaryRegex, extraPatterns) {
    const excludeConditions = [];
    const orConditions = [];
    for (const extra of extraPatterns || []) {
      (extra.mode === "or" ? orConditions : excludeConditions).push(extra);
    }
    const excluded = excludeConditions.some((extra) => extraPatternMatches(url, extra) === true);
    if (excluded) return null;
    const primaryMatch = primaryRegex.exec(url);
    if (primaryMatch) return primaryMatch;
    for (const extra of orConditions) {
      if (!extra.pattern) continue;
      let regex;
      try {
        regex = new RegExp(extra.pattern, extra.flags || "");
      } catch (err) {
        continue;
      }
      const match = regex.exec(url);
      if (match) return match;
    }
    return null;
  }

  // Returns a flat list of { rule, shortcut } for shortcuts whose rule matches the URL.
  function matchShortcuts(url, rules) {
    const matches = [];
    for (const rule of rules || []) {
      if (rule.enabled === false) continue;
      if (!rule.pattern) continue;
      let regex;
      try {
        regex = new RegExp(rule.pattern, rule.flags || "");
      } catch (err) {
        continue; // invalid regex, skip silently
      }
      const match = resolveRuleMatch(url, regex, rule.extraPatterns);
      if (!match) continue;
      for (const shortcut of rule.shortcuts || []) {
        if (!shortcut.targetUrl) continue;
        matches.push({ rule, shortcut, match });
      }
    }
    return matches;
  }

  // Substitutes $1, $2, ... $<name>, $&, $$ in `template` with values captured by `match`
  // (the array returned by RegExp.exec), the same way String.prototype.replace does.
  function substituteGroups(template, match) {
    if (!template || !match) return template || "";
    return template.replace(/\$(\$|&|<([^>]+)>|\d{1,2})/g, (full, token, name) => {
      if (token === "$") return "$";
      if (token === "&") return match[0] || "";
      if (name !== undefined) {
        const value = match.groups && match.groups[name];
        return value !== undefined ? value : "";
      }
      const idx = parseInt(token, 10);
      const value = match[idx];
      return value !== undefined ? value : "";
    });
  }

  // True for strings whose first path segment looks like a bare hostname, e.g.
  // "google.com/maps" or "switch.to:8080/api" - the same heuristic browser address
  // bars use to tell a domain apart from a relative path or a search query.
  function looksLikeBareHost(str) {
    const firstSegment = str.split(/[/?#]/)[0];
    return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+(:\d+)?$/i.test(firstSegment);
  }

  // Decide what a shortcut click should do relative to the current page URL.
  // `match` is the rule's regex exec() result, used to substitute $1/$2/$<name> capture
  // groups into the target URL (e.g. "google.com/maps?q=$1").
  // Returns one of:
  //   { type: "javascript", code }
  //   { type: "navigate", url }
  function resolveAction(targetUrl, currentUrl, match) {
    const trimmed = substituteGroups((targetUrl || "").trim(), match).trim();
    if (/^javascript:/i.test(trimmed)) {
      return { type: "javascript", code: trimmed.replace(/^javascript:/i, "") };
    }
    // Absolute URL (has a scheme like http:, https:, mailto:, etc.)
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) || /^\/\//.test(trimmed)) {
      return { type: "navigate", url: trimmed };
    }
    // Bare domain with no scheme, e.g. "google.com/maps?q=1" - treat as absolute (https).
    if (looksLikeBareHost(trimmed)) {
      return { type: "navigate", url: "https://" + trimmed };
    }
    // Relative path/query/hash - resolve against current location.
    try {
      return { type: "navigate", url: new URL(trimmed, currentUrl).toString() };
    } catch (err) {
      return { type: "navigate", url: trimmed };
    }
  }

  function tooltipFor(shortcut) {
    if (shortcut.description) {
      return `${shortcut.name} - ${shortcut.description}`;
    }
    return shortcut.name || "";
  }

  const SVG_NS = "http://www.w3.org/2000/svg";
  const XLINK_NS = "http://www.w3.org/1999/xlink";
  const TABLER_SPRITE_HOST_ID = "url-shortcuts-tabler-sprite-host";
  const tablerSpriteInjectionPromises = new WeakMap();

  function ownerDocumentOf(root) {
    return root.nodeType === 9 /* Document */ ? root : root.ownerDocument;
  }

  // <use href="chrome-extension://<id>/tabler-sprite.svg#tabler-name"> is a cross-origin
  // reference once rendered into an ordinary web page (the page is https://..., the sprite is
  // chrome-extension://...), which Chrome blocks ("Unsafe attempt to load URL ... Domains,
  // protocols and ports must match") - it only works on the extension's own pages (options/popup)
  // where that URL happens to be same-origin. Fetching the sprite once and inlining its markup
  // turns later <use href="#tabler-name"> references into same-document (always-allowed)
  // references instead. `root` is a Document or ShadowRoot - <use> fragment lookups are scoped
  // to the tree they're rendered in, so content.js's panel (rendered inside a shadow root) needs
  // its own inlined copy; a plain document reference wouldn't be visible to it.
  function ensureTablerSpriteInjected(root) {
    if (root.getElementById(TABLER_SPRITE_HOST_ID)) return;
    if (tablerSpriteInjectionPromises.has(root)) return;
    const promise = global
      .fetch(global.chrome.runtime.getURL("icons/tabler-sprite.svg"))
      .then((res) => res.text())
      .then((svgText) => {
        if (root.getElementById(TABLER_SPRITE_HOST_ID)) return;
        const host = ownerDocumentOf(root).createElement("div");
        host.id = TABLER_SPRITE_HOST_ID;
        host.style.position = "absolute";
        host.style.width = "0";
        host.style.height = "0";
        host.style.overflow = "hidden";
        host.setAttribute("aria-hidden", "true");
        host.innerHTML = svgText;
        // A ShadowRoot has no .body - append directly to it; a Document does, so prefer that.
        (root.body || root).appendChild(host);
      })
      .catch(() => {
        tablerSpriteInjectionPromises.delete(root);
      });
    tablerSpriteInjectionPromises.set(root, promise);
  }

  // Fallback used only when a caller omits `tablerSettings` entirely - every real call site
  // derives size/color from the current appearance settings (see iconSizeForFontSize).
  const FALLBACK_TABLER_RENDER = { size: 20, strokeWidth: TABLER_ICON_STROKE_WIDTH, color: "currentColor" };

  // Builds the DOM element for a shortcut's icon: a stroke-styled <svg><use> referencing the
  // bundled Tabler sprite for ":name" values (styled per `tablerSettings`), or a plain <img>
  // for anything else (a URL or data: URI). Shared by content.js, popup.js and options.js so
  // all three render icons identically. `iconRoot` (a Document or ShadowRoot) is where the
  // sprite gets inlined for this icon's <use> to resolve against - pass the actual shadow root
  // when rendering inside one; defaults to the global document otherwise.
  function buildIconElement(iconValue, tablerSettings, iconRoot) {
    if (isTablerIcon(iconValue)) {
      const root = iconRoot || global.document;
      const doc = ownerDocumentOf(root);
      const settings = Object.assign({}, FALLBACK_TABLER_RENDER, tablerSettings || {});
      const name = tablerIconName(iconValue);
      const svg = doc.createElementNS(SVG_NS, "svg");
      svg.setAttribute("viewBox", "0 0 24 24");
      svg.setAttribute("aria-hidden", "true");
      svg.classList.add("tabler-icon-svg");
      svg.style.width = `${settings.size}px`;
      svg.style.height = `${settings.size}px`;
      // "currentColor" is a sentinel meaning "let CSS decide" (e.g. an active/inactive class) -
      // setting it as an inline style would otherwise always beat any later CSS class rule,
      // inline styles being highest-specificity regardless of the class selector's specificity.
      if (settings.color && settings.color !== "currentColor") {
        svg.style.color = settings.color;
      }
      svg.style.setProperty("stroke-width", String(settings.strokeWidth));
      const use = doc.createElementNS(SVG_NS, "use");
      // Local fragment reference, not the extension's absolute URL - see
      // ensureTablerSpriteInjected for why. The <use> resolves as soon as the sprite lands.
      const href = `#tabler-${name}`;
      use.setAttributeNS(XLINK_NS, "href", href);
      use.setAttribute("href", href);
      svg.appendChild(use);
      ensureTablerSpriteInjected(root);
      return svg;
    }
    const img = global.document.createElement("img");
    img.src = iconValue;
    img.alt = "";
    return img;
  }

  global.URLShortcutsCommon = {
    STORAGE_KEY_RULES,
    STORAGE_KEY_SETTINGS,
    DEFAULT_SETTINGS,
    DEFAULT_APPEARANCE,
    APPEARANCE_SIZE_MIN,
    APPEARANCE_SIZE_MAX,
    APPEARANCE_OPACITY_MIN,
    APPEARANCE_OPACITY_MAX,
    DEFAULT_ANIMATION,
    ANIMATION_TYPES,
    ANIMATION_DURATION_MIN,
    ANIMATION_DURATION_MAX,
    TABLER_ICON_PREFIX,
    TABLER_ICON_STROKE_WIDTH,
    THEME_OPTIONS,
    DEFAULT_THEME,
    POSITIONS,
    iconSizeForFontSize,
    uid,
    emptyShortcut,
    emptyRule,
    emptyPatternCondition,
    isTablerIcon,
    tablerIconName,
    tablerIconValue,
    normalizeSettings,
    getSettings,
    setSettings,
    getRules,
    setRules,
    matchShortcuts,
    resolveRuleMatch,
    substituteGroups,
    looksLikeBareHost,
    resolveAction,
    tooltipFor,
    buildIconElement
  };
})(typeof window !== "undefined" ? window : globalThis);
