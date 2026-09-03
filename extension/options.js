(function () {
  "use strict";

  const C = window.URLShortcutsCommon;

  const rulesContainer = document.getElementById("rules-container");
  const ruleTemplate = document.getElementById("rule-template");
  const shortcutTemplate = document.getElementById("shortcut-template");
  const extraPatternTemplate = document.getElementById("extra-pattern-template");
  const addRuleBtn = document.getElementById("add-rule-btn");
  const overlayEnabled = document.getElementById("overlay-enabled");
  const exportBtn = document.getElementById("export-btn");
  const importBtn = document.getElementById("import-btn");
  const importFile = document.getElementById("import-file");
  const saveStatus = document.getElementById("save-status");
  const testUrlInput = document.getElementById("test-url");
  const testResults = document.getElementById("test-results");
  const positionPicker = document.getElementById("position-picker");
  const positionZones = Array.from(positionPicker.querySelectorAll(".picker-zone"));
  const previewPanel = document.getElementById("preview-panel");
  const previewList = document.getElementById("preview-list");
  const previewPageContent = document.getElementById("preview-page-content");
  const previewHint = document.getElementById("preview-hint");
  const colorBackgroundInput = document.getElementById("color-background");
  const colorTextInput = document.getElementById("color-text");
  const colorOpacityInput = document.getElementById("color-opacity");
  const opacityLabel = document.getElementById("opacity-label");
  const appearanceSizeInput = document.getElementById("appearance-size");
  const appearanceSizeLabel = document.getElementById("appearance-size-label");
  const showTextWithIconsInput = document.getElementById("show-text-with-icons");
  const resetColorsBtn = document.getElementById("reset-colors-btn");
  const animationTypeSelect = document.getElementById("animation-type");
  const animationDurationInput = document.getElementById("animation-duration");
  const animationDurationLabel = document.getElementById("animation-duration-label");
  const previewToggleBtn = previewPanel.querySelector(".toggle-btn");
  const themeToggle = document.getElementById("theme-toggle");
  const themeOptionButtons = Array.from(themeToggle.querySelectorAll(".theme-option"));

  // A hand-drawn flame, not a Tabler icon - demonstrates the "custom image icon" path
  // (a plain <img>) in the live preview alongside the plain-text and Tabler-icon examples.
  const FLAME_SVG =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">' +
    '<path fill="#f97316" d="M12 2c1.2 2.7-1.6 4.1-1.9 6.7-.2 1.7 1 3.1 2.6 3.1 1.8 0 2.8-1.6 2.5-3-.1-.6-.4-1.1-.7-1.6 2.4 1.8 4 4.9 4 7.6a6.5 6.5 0 0 1-13 0C5.5 10.9 9.2 7 12 2z"/>' +
    "</svg>";
  const FLAME_ICON = "data:image/svg+xml," + encodeURIComponent(FLAME_SVG);

  const EXAMPLE_SHORTCUTS = [
    { name: "Maps", description: "Jump to Maps" },
    { name: "Flame", description: "Custom image icon example", icon: FLAME_ICON },
    { name: "Star", description: "Tabler icon example", icon: C.tablerIconValue("star") }
  ];

  let rules = [];
  let saveTimer = null;
  let colorSaveTimer = null;
  let currentAppearance = C.DEFAULT_APPEARANCE;
  let currentTheme = C.DEFAULT_THEME;
  // In-memory only (not persisted): which rules are expanded. Rules render collapsed by
  // default each time the options page loads; newly-added rules are auto-expanded.
  const expandedRuleIds = new Set();

  // Fixed stroke width (not user-configurable) - only size (derived from the Appearance "Size"
  // slider) and color (the Appearance "Text & icons" color) vary.
  function tablerRenderSettings() {
    return {
      size: C.iconSizeForFontSize(currentAppearance.size),
      strokeWidth: C.TABLER_ICON_STROKE_WIDTH,
      color: currentAppearance.text
    };
  }

  // Closes any open Tabler-icon suggestion dropdown when clicking outside its icon field.
  // Registered once (not per-row) so re-rendering rows/shortcuts never accumulates listeners.
  document.addEventListener("click", (evt) => {
    document.querySelectorAll(".icon-search-wrap").forEach((wrap) => {
      if (wrap.contains(evt.target)) return;
      const suggestions = wrap.querySelector(".tabler-suggestions");
      if (suggestions && !suggestions.hidden) {
        suggestions.hidden = true;
        suggestions.innerHTML = "";
      }
    });
  });

  // Finds which child of `container` (matching `selector`, i.e. excluding the one currently
  // being dragged) a dragged element should be inserted before, based on vertical mouse
  // position - the element whose vertical midpoint the cursor is above, or null (append to
  // the end) if the cursor is below every element's midpoint. Shared by rule-card and
  // shortcut-row drag-and-drop reordering below.
  function dragAfterElement(container, selector, y) {
    const els = Array.from(container.querySelectorAll(selector));
    return els.reduce(
      (closest, el) => {
        const box = el.getBoundingClientRect();
        const offset = y - box.top - box.height / 2;
        return offset < 0 && offset > closest.offset ? { offset, element: el } : closest;
      },
      { offset: Number.NEGATIVE_INFINITY, element: null }
    ).element;
  }

  // Drag-and-drop rule reordering: live-previews the new order by physically moving DOM nodes
  // as the dragged card passes over others (dragHandle's dragend in renderRuleCard then reads
  // that final DOM order back into `rules`). Delegated on the container (registered once) since
  // renderAll() replaces every rule card's DOM on most edits.
  rulesContainer.addEventListener("dragover", (evt) => {
    const dragging = rulesContainer.querySelector(".rule-card.dragging");
    if (!dragging) return;
    evt.preventDefault();
    evt.dataTransfer.dropEffect = "move";
    const afterElement = dragAfterElement(rulesContainer, ".rule-card:not(.dragging)", evt.clientY);
    if (afterElement == null) {
      rulesContainer.appendChild(dragging);
    } else if (afterElement !== dragging) {
      rulesContainer.insertBefore(dragging, afterElement);
    }
  });
  rulesContainer.addEventListener("drop", (evt) => evt.preventDefault());

  // Drag-and-drop shortcut reordering, including across rules: delegated on the container
  // (rather than per rule's shortcuts-list) so a shortcut can be dropped into any *expanded*
  // rule's list, not just the one it started in. `evt.target.closest` finds whichever
  // shortcuts-list the cursor is currently over; a collapsed rule's list is hidden and so isn't
  // a valid drop target, same as it isn't a visible/interactable target for anything else.
  rulesContainer.addEventListener("dragover", (evt) => {
    const dragging = rulesContainer.querySelector(".shortcut-row.dragging");
    if (!dragging) return;
    const targetList = evt.target.closest(".shortcuts-list");
    if (!targetList) return;
    evt.preventDefault();
    evt.dataTransfer.dropEffect = "move";
    const afterElement = dragAfterElement(targetList, ".shortcut-row:not(.dragging)", evt.clientY);
    if (afterElement == null) {
      targetList.appendChild(dragging);
    } else if (afterElement !== dragging) {
      targetList.insertBefore(dragging, afterElement);
    }
  });

  function scheduleSave() {
    saveStatus.textContent = "Saving…";
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      try {
        await C.setRules(rules);
        saveStatus.textContent = "Saved";
        setTimeout(() => {
          if (saveStatus.textContent === "Saved") saveStatus.textContent = "";
        }, 1500);
      } catch (err) {
        saveStatus.textContent = "Save failed: " + (err && err.message ? err.message : err);
      } finally {
        renderTestResults();
      }
    }, 350);
  }

  // Uploaded icon images are downscaled before being stored as a data: URI - a raw multi-MB
  // photo would blow past chrome.storage.local's quota (kQuotaBytes), and icons only ever
  // render at ~20-32px anyway. SVGs are skipped (already tiny, vector, and rasterizing them
  // would only lose quality) and stored as-is.
  const ICON_UPLOAD_MAX_DIMENSION = 128;

  function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error || new Error("Could not read file"));
      reader.readAsDataURL(file);
    });
  }

  function downscaleImageFile(file, maxDimension) {
    return new Promise((resolve, reject) => {
      const objectUrl = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(objectUrl);
        const scale = Math.min(1, maxDimension / Math.max(img.naturalWidth, img.naturalHeight));
        const width = Math.max(1, Math.round(img.naturalWidth * scale));
        const height = Math.max(1, Math.round(img.naturalHeight * scale));
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        canvas.getContext("2d").drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/png"));
      };
      img.onerror = () => {
        URL.revokeObjectURL(objectUrl);
        reject(new Error("Could not load image"));
      };
      img.src = objectUrl;
    });
  }

  function updateIconPreview(preview, iconValue) {
    preview.innerHTML = "";
    if (iconValue) {
      preview.appendChild(C.buildIconElement(iconValue, tablerRenderSettings()));
    }
  }

  const TABLER_SUGGESTIONS_LIMIT = 500;

  function renderShortcutRow(rule, shortcut) {
    const node = shortcutTemplate.content.firstElementChild.cloneNode(true);
    node.dataset.shortcutId = shortcut.id;
    const dragHandle = node.querySelector(".shortcut-drag-handle");
    const preview = node.querySelector(".shortcut-preview");
    const nameInput = node.querySelector(".sc-name");
    const descInput = node.querySelector(".sc-description");
    const targetInput = node.querySelector(".sc-target");
    const newTabInput = node.querySelector(".sc-new-tab");
    const iconInput = node.querySelector(".sc-icon");
    const iconUploadBtn = node.querySelector(".sc-icon-upload-btn");
    const iconFile = node.querySelector(".sc-icon-file");
    const deleteBtn = node.querySelector(".delete-shortcut-btn");
    const iconSuggestions = node.querySelector(".tabler-suggestions");
    const blacklistPatternInput = node.querySelector(".sc-blacklist-pattern");
    const blacklistFlagsInput = node.querySelector(".sc-blacklist-flags");

    nameInput.value = shortcut.name || "";
    descInput.value = shortcut.description || "";
    targetInput.value = shortcut.targetUrl || "";
    newTabInput.checked = !!shortcut.openInNewTab;
    iconInput.value = shortcut.icon || "";
    blacklistPatternInput.value = shortcut.blacklistPattern || "";
    blacklistFlagsInput.value = shortcut.blacklistFlags || "";
    updateIconPreview(preview, shortcut.icon);

    nameInput.addEventListener("input", () => {
      shortcut.name = nameInput.value;
      scheduleSave();
    });
    descInput.addEventListener("input", () => {
      shortcut.description = descInput.value;
      scheduleSave();
    });
    targetInput.addEventListener("input", () => {
      shortcut.targetUrl = targetInput.value;
      scheduleSave();
    });
    newTabInput.addEventListener("change", () => {
      shortcut.openInNewTab = newTabInput.checked;
      scheduleSave();
    });
    blacklistPatternInput.addEventListener("input", () => {
      shortcut.blacklistPattern = blacklistPatternInput.value;
      blacklistPatternInput.classList.toggle("invalid", !isValidRegex(shortcut.blacklistPattern, shortcut.blacklistFlags));
      scheduleSave();
    });
    blacklistFlagsInput.addEventListener("input", () => {
      shortcut.blacklistFlags = blacklistFlagsInput.value;
      blacklistPatternInput.classList.toggle("invalid", !isValidRegex(shortcut.blacklistPattern, shortcut.blacklistFlags));
      scheduleSave();
    });
    iconInput.addEventListener("input", () => {
      shortcut.icon = iconInput.value;
      updateIconPreview(preview, shortcut.icon);
      scheduleSave();
      showIconSuggestionsFor(iconInput.value);
    });
    iconInput.addEventListener("focus", () => showIconSuggestionsFor(iconInput.value));
    iconInput.addEventListener("keydown", (evt) => {
      if (evt.key === "Escape") hideIconSuggestions();
    });
    iconUploadBtn.addEventListener("click", () => iconFile.click());
    iconFile.addEventListener("change", () => {
      const file = iconFile.files[0];
      if (!file) return;
      const toDataUrl = file.type === "image/svg+xml" ? readFileAsDataUrl(file) : downscaleImageFile(file, ICON_UPLOAD_MAX_DIMENSION);
      toDataUrl
        .then((dataUrl) => {
          shortcut.icon = dataUrl;
          iconInput.value = shortcut.icon;
          updateIconPreview(preview, shortcut.icon);
          scheduleSave();
        })
        .catch((err) => {
          alert("Couldn't use that image: " + (err && err.message ? err.message : err));
        })
        .finally(() => {
          iconFile.value = "";
        });
    });
    deleteBtn.addEventListener("click", () => {
      rule.shortcuts = rule.shortcuts.filter((s) => s.id !== shortcut.id);
      renderAll();
      scheduleSave();
    });
    dragHandle.addEventListener("dragstart", (evt) => {
      evt.dataTransfer.effectAllowed = "move";
      evt.dataTransfer.setData("text/plain", shortcut.id);
      node.classList.add("dragging");
    });
    dragHandle.addEventListener("dragend", () => {
      node.classList.remove("dragging");
      // The dragover handler already moved the DOM node live as a preview - possibly into a
      // different rule's shortcuts-list - so read the final owning list back to find which
      // rule it landed in, and that list's final order (matched by id, not index).
      const destList = node.parentElement;
      const destRule = rules.find((r) => r.id === destList.dataset.ruleId) || rule;
      const movedAcrossRules = destRule !== rule;
      if (movedAcrossRules) {
        rule.shortcuts = rule.shortcuts.filter((s) => s.id !== shortcut.id);
        destRule.shortcuts.push(shortcut);
      }
      const newOrder = Array.from(destList.querySelectorAll(".shortcut-row")).map((el) => el.dataset.shortcutId);
      destRule.shortcuts.sort((a, b) => newOrder.indexOf(a.id) - newOrder.indexOf(b.id));
      scheduleSave();
      // Re-render so both rules' summaries update and every row's closures pick up the
      // shortcut's new owning rule (this row's own closures still reference the old `rule`).
      if (movedAcrossRules) renderAll();
    });

    function hideIconSuggestions() {
      iconSuggestions.hidden = true;
      iconSuggestions.innerHTML = "";
    }

    function selectTablerIcon(name) {
      shortcut.icon = C.tablerIconValue(name);
      iconInput.value = shortcut.icon;
      updateIconPreview(preview, shortcut.icon);
      scheduleSave();
      hideIconSuggestions();
      iconInput.focus();
    }

    // Typing a ":"-prefixed value into the icon field itself doubles as a Tabler icon search
    // (e.g. ":star" -> matches "star", "tag-starred", ...) - no separate search input needed.
    function showIconSuggestionsFor(value) {
      if (!value.startsWith(":")) {
        hideIconSuggestions();
        return;
      }
      const q = value.slice(1).trim().toLowerCase();
      if (!q) {
        hideIconSuggestions();
        return;
      }
      const allNames = window.TABLER_ICON_NAMES || [];
      const matches = allNames.filter((name) => name.includes(q));
      iconSuggestions.innerHTML = "";
      if (!matches.length) {
        const empty = document.createElement("div");
        empty.className = "no-matches";
        empty.textContent = "No matching icons";
        iconSuggestions.appendChild(empty);
        iconSuggestions.hidden = false;
        return;
      }
      for (const name of matches.slice(0, TABLER_SUGGESTIONS_LIMIT)) {
        const item = document.createElement("button");
        item.type = "button";
        item.className = "tabler-suggestion";
        item.appendChild(C.buildIconElement(C.tablerIconValue(name), tablerRenderSettings()));
        const label = document.createElement("span");
        label.className = "tabler-suggestion-name";
        label.textContent = name;
        item.appendChild(label);
        item.addEventListener("click", () => selectTablerIcon(name));
        iconSuggestions.appendChild(item);
      }
      if (matches.length > TABLER_SUGGESTIONS_LIMIT) {
        const more = document.createElement("div");
        more.className = "tabler-suggestions-more";
        more.textContent = `Showing first ${TABLER_SUGGESTIONS_LIMIT} of ${matches.length} matches - refine your search`;
        iconSuggestions.appendChild(more);
      }
      iconSuggestions.hidden = false;
    }

    return node;
  }

  function ruleSummary(rule) {
    const shortcutCount = (rule.shortcuts || []).length;
    const countLabel = `${shortcutCount} shortcut${shortcutCount === 1 ? "" : "s"}`;
    const patternLabel = rule.pattern ? `/${rule.pattern}/${rule.flags || ""}` : "(no pattern set)";
    return `${patternLabel} · ${countLabel}`;
  }

  function renderExtraPatternRow(rule, extra) {
    const node = extraPatternTemplate.content.firstElementChild.cloneNode(true);
    const modeSelect = node.querySelector(".ep-mode");
    const patternInput = node.querySelector(".ep-pattern");
    const flagsInput = node.querySelector(".ep-flags");
    const deleteBtn = node.querySelector(".delete-extra-pattern-btn");

    // Anything other than "or" (e.g. a rule saved with the old "include"/"Must also match"
    // mode) displays and behaves as "exclude" - see resolveRuleMatch in common.js.
    modeSelect.value = extra.mode === "or" ? "or" : "exclude";
    patternInput.value = extra.pattern || "";
    flagsInput.value = extra.flags || "";

    modeSelect.addEventListener("change", () => {
      extra.mode = modeSelect.value;
      scheduleSave();
    });
    patternInput.addEventListener("input", () => {
      extra.pattern = patternInput.value;
      patternInput.classList.toggle("invalid", !isValidRegex(extra.pattern, extra.flags));
      scheduleSave();
    });
    flagsInput.addEventListener("input", () => {
      extra.flags = flagsInput.value;
      scheduleSave();
    });
    deleteBtn.addEventListener("click", () => {
      rule.extraPatterns = rule.extraPatterns.filter((e) => e.id !== extra.id);
      renderAll();
      scheduleSave();
    });

    return node;
  }

  function renderRuleCard(rule) {
    const node = ruleTemplate.content.firstElementChild.cloneNode(true);
    const card = node; // the template's root element is the card itself
    const dragHandle = node.querySelector(".rule-drag-handle");
    const toggleBtn = node.querySelector(".rule-toggle");
    const enabledInput = node.querySelector(".rule-enabled");
    const nameInput = node.querySelector(".rule-name");
    const summaryEl = node.querySelector(".rule-summary");
    const patternInput = node.querySelector(".rule-pattern");
    const flagsInput = node.querySelector(".rule-flags");
    const deleteBtn = node.querySelector(".delete-rule-btn");
    const extraPatternsList = node.querySelector(".extra-patterns-list");
    const addExtraPatternBtn = node.querySelector(".add-extra-pattern-btn");
    const shortcutsList = node.querySelector(".shortcuts-list");
    const addShortcutBtn = node.querySelector(".add-shortcut-btn");

    card.dataset.ruleId = rule.id;
    shortcutsList.dataset.ruleId = rule.id;
    card.classList.toggle("expanded", expandedRuleIds.has(rule.id));
    enabledInput.checked = rule.enabled !== false;
    nameInput.value = rule.name || "";
    summaryEl.textContent = ruleSummary(rule);
    patternInput.value = rule.pattern || "";
    flagsInput.value = rule.flags || "";

    toggleBtn.addEventListener("click", () => {
      if (expandedRuleIds.has(rule.id)) {
        expandedRuleIds.delete(rule.id);
      } else {
        expandedRuleIds.add(rule.id);
      }
      card.classList.toggle("expanded", expandedRuleIds.has(rule.id));
    });
    enabledInput.addEventListener("change", () => {
      rule.enabled = enabledInput.checked;
      scheduleSave();
    });
    nameInput.addEventListener("input", () => {
      rule.name = nameInput.value;
      scheduleSave();
    });
    patternInput.addEventListener("input", () => {
      rule.pattern = patternInput.value;
      patternInput.classList.toggle("invalid", !isValidRegex(rule.pattern, rule.flags));
      summaryEl.textContent = ruleSummary(rule);
      scheduleSave();
    });
    flagsInput.addEventListener("input", () => {
      rule.flags = flagsInput.value;
      scheduleSave();
    });
    deleteBtn.addEventListener("click", () => {
      if (!confirm("Delete this rule and all its shortcuts?")) return;
      rules = rules.filter((r) => r.id !== rule.id);
      expandedRuleIds.delete(rule.id);
      renderAll();
      scheduleSave();
    });
    dragHandle.addEventListener("dragstart", (evt) => {
      evt.dataTransfer.effectAllowed = "move";
      evt.dataTransfer.setData("text/plain", rule.id);
      card.classList.add("dragging");
    });
    dragHandle.addEventListener("dragend", () => {
      card.classList.remove("dragging");
      // The dragover handler already reordered the DOM live as a preview - read that final
      // order back into `rules` (matched by id, not index) so it's what actually gets saved.
      const newOrder = Array.from(rulesContainer.querySelectorAll(".rule-card")).map((el) => el.dataset.ruleId);
      rules.sort((a, b) => newOrder.indexOf(a.id) - newOrder.indexOf(b.id));
      scheduleSave();
    });
    addExtraPatternBtn.addEventListener("click", () => {
      rule.extraPatterns = rule.extraPatterns || [];
      rule.extraPatterns.push(C.emptyPatternCondition());
      renderAll();
      scheduleSave();
    });
    addShortcutBtn.addEventListener("click", () => {
      rule.shortcuts.push(C.emptyShortcut());
      summaryEl.textContent = ruleSummary(rule);
      renderAll();
      scheduleSave();
    });

    for (const extra of rule.extraPatterns || []) {
      extraPatternsList.appendChild(renderExtraPatternRow(rule, extra));
    }
    for (const shortcut of rule.shortcuts) {
      shortcutsList.appendChild(renderShortcutRow(rule, shortcut));
    }

    return node;
  }

  function isValidRegex(pattern, flags) {
    if (!pattern) return true;
    try {
      new RegExp(pattern, flags || "");
      return true;
    } catch (err) {
      return false;
    }
  }

  function renderAll() {
    rulesContainer.innerHTML = "";
    for (const rule of rules) {
      rulesContainer.appendChild(renderRuleCard(rule));
    }
    renderTestResults();
    renderPreviewShortcuts();
  }

  function renderTestResults() {
    const url = testUrlInput.value.trim();
    testResults.innerHTML = "";
    if (!url) return;
    const matches = C.matchShortcuts(url, rules);
    if (!matches.length) {
      const div = document.createElement("div");
      div.className = "none";
      div.textContent = "No shortcuts would be shown for this URL.";
      testResults.appendChild(div);
      return;
    }
    for (const { rule, shortcut, match } of matches) {
      const action = C.resolveAction(shortcut.targetUrl, url, match);
      const resolved = action.type === "javascript" ? `javascript:${action.code}` : action.url;
      const ruleLabel = rule.name ? `${rule.name} (/${rule.pattern}/${rule.flags || ""})` : `/${rule.pattern}/${rule.flags || ""}`;
      const div = document.createElement("div");
      div.className = "match";
      div.textContent = `✓ ${ruleLabel} → ${shortcut.name || shortcut.targetUrl} (${resolved})`;
      testResults.appendChild(div);
    }
  }

  addRuleBtn.addEventListener("click", () => {
    const rule = C.emptyRule();
    rules.push(rule);
    expandedRuleIds.add(rule.id);
    renderAll();
    scheduleSave();
  });

  overlayEnabled.addEventListener("change", async () => {
    await C.setSettings({ enabled: overlayEnabled.checked });
  });

  // Sets the CSS custom properties the live preview's panel/shortcut CSS reads from - background
  // color/opacity, text color, and the derived font-size/icon-size pair (kept in a fixed ratio,
  // see iconSizeForFontSize) so icons and text always scale together. Set on the root element
  // (not previewPanel) so they also reach the standalone toggle-btn icon rendered inline in the
  // Animation section's hint text, which isn't a descendant of #preview-panel and wouldn't
  // otherwise inherit these custom properties (CSS variables only cascade down the DOM tree).
  function applyPreviewAppearance(appearance) {
    const root = document.documentElement.style;
    root.setProperty("--sc-bg", appearance.background);
    root.setProperty("--sc-text", appearance.text);
    root.setProperty("--sc-opacity", `${appearance.opacity}%`);
    root.setProperty("--sc-font-size", `${appearance.size}px`);
    root.setProperty("--sc-icon-size", `${C.iconSizeForFontSize(appearance.size)}px`);
  }

  function scheduleAppearanceSave() {
    opacityLabel.textContent = `${colorOpacityInput.value}%`;
    appearanceSizeLabel.textContent = `${appearanceSizeInput.value}px`;
    const appearance = {
      background: colorBackgroundInput.value,
      text: colorTextInput.value,
      opacity: Number(colorOpacityInput.value),
      size: Number(appearanceSizeInput.value),
      showTextWithIcons: showTextWithIconsInput.checked
    };
    currentAppearance = appearance;
    applyPreviewAppearance(appearance);
    // Refresh anything already showing a Tabler icon (live preview + every shortcut row's
    // preview/suggestions) so the new color/size is visible immediately.
    renderPreviewShortcuts();
    renderAll();
    saveStatus.textContent = "Saving…";
    clearTimeout(colorSaveTimer);
    colorSaveTimer = setTimeout(async () => {
      await C.setSettings({ appearance });
      saveStatus.textContent = "Saved";
      setTimeout(() => {
        if (saveStatus.textContent === "Saved") saveStatus.textContent = "";
      }, 1500);
    }, 200);
  }

  colorBackgroundInput.addEventListener("input", scheduleAppearanceSave);
  colorTextInput.addEventListener("input", scheduleAppearanceSave);
  colorOpacityInput.addEventListener("input", scheduleAppearanceSave);
  appearanceSizeInput.addEventListener("input", scheduleAppearanceSave);
  showTextWithIconsInput.addEventListener("change", scheduleAppearanceSave);
  resetColorsBtn.addEventListener("click", () => {
    colorBackgroundInput.value = C.DEFAULT_APPEARANCE.background;
    colorTextInput.value = C.DEFAULT_APPEARANCE.text;
    colorOpacityInput.value = C.DEFAULT_APPEARANCE.opacity;
    appearanceSizeInput.value = C.DEFAULT_APPEARANCE.size;
    showTextWithIconsInput.checked = C.DEFAULT_APPEARANCE.showTextWithIcons;
    scheduleAppearanceSave();
  });

  // Theme: "system" tracks the OS/browser color scheme via prefers-color-scheme (there's no
  // direct API to read Chrome's own UI theme choice from an extension page), "light"/"dark"
  // are pinned regardless of it.

  // Fixed icon appearance regardless of the (user-configurable) Appearance settings - this is
  // chrome UI, not a shortcut icon. color: "currentColor" makes CSS (via .selected) the source
  // of truth for the active/inactive look instead of baking a color in here.
  for (const btn of themeOptionButtons) {
    btn.appendChild(C.buildIconElement(btn.dataset.icon, { size: 16, strokeWidth: C.TABLER_ICON_STROKE_WIDTH, color: "currentColor" }));
  }

  const themeMediaQuery = window.matchMedia("(prefers-color-scheme: dark)");

  function effectiveTheme(theme) {
    return theme === "system" ? (themeMediaQuery.matches ? "dark" : "light") : theme;
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", effectiveTheme(theme));
    for (const btn of themeOptionButtons) {
      btn.classList.toggle("selected", btn.dataset.theme === theme);
    }
  }

  themeMediaQuery.addEventListener("change", () => {
    if (currentTheme === "system") applyTheme("system");
  });

  for (const btn of themeOptionButtons) {
    btn.addEventListener("click", async () => {
      currentTheme = btn.dataset.theme;
      applyTheme(currentTheme);
      await C.setSettings({ theme: currentTheme });
    });
  }

  let animationSaveTimer = null;

  function updateAnimationControl() {
    const isNone = animationTypeSelect.value === "none";
    animationDurationInput.disabled = isNone;
    animationDurationLabel.textContent = `${animationDurationInput.value}ms`;
  }

  function scheduleAnimationSave() {
    updateAnimationControl();
    const animation = { type: animationTypeSelect.value, duration: Number(animationDurationInput.value) };
    saveStatus.textContent = "Saving…";
    clearTimeout(animationSaveTimer);
    animationSaveTimer = setTimeout(async () => {
      await C.setSettings({ animation });
      saveStatus.textContent = "Saved";
      setTimeout(() => {
        if (saveStatus.textContent === "Saved") saveStatus.textContent = "";
      }, 1500);
    }, 200);
  }

  animationTypeSelect.addEventListener("change", scheduleAnimationSave);
  animationDurationInput.addEventListener("input", scheduleAnimationSave);

  // --- Live preview demo: clicking the ⚡ in the position/color preview replays the
  // currently-selected (not-yet-saved-or-not) animation on the example shortcuts, so users
  // can try it out without needing to open a real page. Mirrors content.js's animation engine
  // at a small scale - kept separate since it only needs to animate the preview's own pills.
  let previewExpanded = true;

  function previewVectorToToggle(el) {
    const t = previewToggleBtn.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    const dx = t.left + t.width / 2 - (r.left + r.width / 2);
    const dy = t.top + t.height / 2 - (r.top + r.height / 2);
    return { dx, dy, dist: Math.hypot(dx, dy) };
  }

  function previewAnimateBatch(elements, direction, onAllDone) {
    const type = animationTypeSelect.value;
    const duration = Number(animationDurationInput.value);
    if (!elements.length) {
      if (onAllDone) onAllDone();
      return;
    }
    // Cancel any in-flight (or finished-but-still-attached) animation BEFORE measuring - a
    // fill:forwards effect keeps offsetting the element via transform even after it "finishes"
    // (finishing alone doesn't detach it), which would otherwise throw off
    // getBoundingClientRect() and produce a near-zero vector on the next run. Also needed for
    // "none" itself: switching to "none" after hiding with e.g. "balloon" must still clear that
    // exit animation's fill:both end frame, or the elements stay stuck invisible.
    for (const el of elements) {
      for (const anim of el.getAnimations()) anim.cancel();
    }
    if (type === "none") {
      if (onAllDone) onAllDone();
      return;
    }
    const items = elements.map((el) => ({ el, vector: previewVectorToToggle(el) }));
    if (type === "pop") {
      items.sort((a, b) => (direction === "enter" ? a.vector.dist - b.vector.dist : b.vector.dist - a.vector.dist));
    }
    const step = Math.min(120, duration / items.length);
    let remaining = items.length;
    items.forEach((item, rank) => {
      const delay = type === "pop" ? rank * step : 0;
      let keyframes;
      const enter = direction === "enter";
      if (type === "balloon") {
        const from = { transform: `translate(${item.vector.dx}px, ${item.vector.dy}px) scale(0.2)`, opacity: 0 };
        const to = { transform: "translate(0px, 0px) scale(1)", opacity: 1 };
        keyframes = enter ? [from, to] : [to, from];
      } else if (type === "pop") {
        const from = { transform: "scale(0)", opacity: 0 };
        const to = { transform: "scale(1)", opacity: 1 };
        keyframes = enter ? [from, to] : [to, from];
      } else {
        keyframes = enter ? [{ opacity: 0 }, { opacity: 1 }] : [{ opacity: 1 }, { opacity: 0 }];
      }
      const itemDuration = type === "balloon" ? duration * (0.85 + Math.random() * 0.3) : duration;
      const anim = item.el.animate(keyframes, {
        duration: itemDuration,
        delay,
        easing: enter ? "cubic-bezier(0.22, 1, 0.36, 1)" : "cubic-bezier(0.55, 0, 1, 0.45)",
        fill: "both"
      });
      anim.onfinish = () => {
        remaining -= 1;
        if (remaining <= 0 && onAllDone) onAllDone();
      };
    });
  }

  previewToggleBtn.addEventListener("click", () => {
    const elements = Array.from(previewList.children);
    if (previewExpanded) {
      previewExpanded = false;
      previewAnimateBatch(elements, "exit", () => {
        previewList.style.visibility = "hidden";
      });
    } else {
      previewExpanded = true;
      previewList.style.visibility = "visible";
      previewAnimateBatch(elements, "enter");
    }
  });

  function isBarPosition(position) {
    return position === "shortcutbar-left" || position === "shortcutbar-right";
  }

  // With a Test URL entered, the live preview shows the actual shortcuts that would appear
  // for that URL (possibly none) instead of the fixed icon-type examples - so it doubles as a
  // WYSIWYG check of Appearance/Animation settings against a real rule match.
  function previewShortcuts() {
    const url = testUrlInput.value.trim();
    if (!url) {
      previewHint.textContent = "Live preview with example shortcuts";
      return EXAMPLE_SHORTCUTS;
    }
    const matches = C.matchShortcuts(url, rules).map((m) => m.shortcut);
    previewHint.textContent = matches.length
      ? "Live preview of shortcuts matching this Test URL"
      : "No shortcuts would be shown for this URL";
    return matches;
  }

  function renderPreviewShortcuts() {
    previewList.innerHTML = "";
    for (const example of previewShortcuts()) {
      const btn = document.createElement("button");
      btn.className = "shortcut-btn";
      btn.type = "button";
      btn.tabIndex = -1;
      btn.title = C.tooltipFor(example);
      const label = example.name || example.targetUrl || "";
      if (example.icon) {
        btn.appendChild(C.buildIconElement(example.icon, tablerRenderSettings()));
        if (currentAppearance.showTextWithIcons) {
          const labelEl = document.createElement("span");
          labelEl.className = "label";
          labelEl.textContent = label;
          btn.appendChild(labelEl);
        }
      } else {
        btn.textContent = label;
      }
      previewList.appendChild(btn);
    }
  }

  function updatePreview(position) {
    previewPanel.dataset.position = position;
    if (isBarPosition(position)) {
      // Mirrors content.js's body-spacing behavior: reserve space for the bar instead of overlaying.
      previewPageContent.style.paddingTop = `${previewPanel.getBoundingClientRect().height}px`;
    } else {
      previewPageContent.style.paddingTop = "";
    }
  }

  function selectPosition(position) {
    for (const zone of positionZones) {
      const isSelected = zone.dataset.position === position;
      zone.classList.toggle("selected", isSelected);
      zone.setAttribute("aria-checked", String(isSelected));
    }
    updatePreview(position);
  }

  for (const zone of positionZones) {
    zone.addEventListener("click", async () => {
      selectPosition(zone.dataset.position);
      await C.setSettings({ position: zone.dataset.position });
    });
  }

  testUrlInput.addEventListener("input", () => {
    renderTestResults();
    renderPreviewShortcuts();
  });

  exportBtn.addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(rules, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "url-shortcuts-export.json";
    a.click();
    URL.revokeObjectURL(url);
  });

  importBtn.addEventListener("click", () => importFile.click());
  importFile.addEventListener("change", () => {
    const file = importFile.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result);
        if (!Array.isArray(parsed)) throw new Error("Expected a JSON array of rules");
        if (!confirm(`Import ${parsed.length} rule(s)? This replaces your current configuration.`)) return;
        rules = parsed;
        renderAll();
        scheduleSave();
      } catch (err) {
        alert("Import failed: " + err.message);
      } finally {
        importFile.value = "";
      }
    };
    reader.readAsText(file);
  });

  async function init() {
    // Never persisted (not part of settings/rules storage) - explicitly cleared here too in
    // case the browser's own form-restore (bfcache, reload) refilled it from a previous visit.
    testUrlInput.value = "";
    const [settings, storedRules] = await Promise.all([C.getSettings(), C.getRules()]);
    currentTheme = settings.theme;
    applyTheme(currentTheme);
    overlayEnabled.checked = settings.enabled !== false;
    colorBackgroundInput.value = settings.appearance.background;
    colorTextInput.value = settings.appearance.text;
    colorOpacityInput.value = settings.appearance.opacity;
    opacityLabel.textContent = `${settings.appearance.opacity}%`;
    appearanceSizeInput.value = settings.appearance.size;
    appearanceSizeLabel.textContent = `${settings.appearance.size}px`;
    showTextWithIconsInput.checked = settings.appearance.showTextWithIcons;
    currentAppearance = settings.appearance;
    applyPreviewAppearance(settings.appearance);
    animationTypeSelect.value = settings.animation.type;
    animationDurationInput.value = settings.animation.duration;
    updateAnimationControl();
    renderPreviewShortcuts();
    selectPosition(settings.position);
    rules = storedRules.length ? storedRules : [];
    renderAll();
  }

  init();
})();
