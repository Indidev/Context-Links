# Context Links

A small Manifest V3 Chrome/Chromium extension that shows a floating panel of
custom shortcuts on websites whose URL matches a regex you configure.

![](media/example.gif)

## Table of Contents

- [Install (unpacked)](#install-unpacked)
- [Concepts](#concepts)
- [Using it](#using-it)
- [License](#license)

## Install (unpacked)

1. Open `chrome://extensions`.
2. Enable **Developer mode** (top right).
3. Click **Load unpacked** and select the extension folder.
4. Click the extension icon and choose **Manage shortcuts** to open the
   options page and add rules.


## Concepts

- **Rule**: a regex (`pattern` + optional `flags`, matched against the full
  page URL via `RegExp.exec`) plus a list of shortcuts. All shortcuts of every
  matching, enabled rule are shown together in the floating panel. Capture
  groups in `pattern` — numbered `(...)` or named `(?<name>...)` — are
  available for substitution in that rule's shortcuts.
  - `Name` is optional and just for your own organization — shown in the
    rule's collapsed summary and in the "Test a URL" results.
  - Rules are **collapsed by default** on the options page (each one shows a
    one-line summary — pattern + shortcut count); click the ▸ to expand.
    Newly-added rules auto-expand so you can fill them in right away.
  - **Additional conditions**: click "+ Add condition" on a rule to add more
    regexes, each either "Must NOT match" or "OR match". A hit on any "Must
    NOT match" condition takes priority over everything else and discards
    the whole rule for that URL outright, even if the primary pattern or an
    "OR match" condition would otherwise have matched. Short of that veto,
    the rule matches if the primary pattern matches *or* any "OR match"
    condition does on its own (it doesn't need the primary pattern to also
    hold). E.g. to match `google.com/*` except `google.com/maps`, set the
    primary pattern to `google\.com/.*` and add a condition
    `google\.com/maps` set to "Must NOT match"; to instead show the same
    shortcuts on either of two sites, set the primary pattern to
    `google\.com/search` and add a condition `bing\.com/search` set to
    "OR match". `$1`-style substitution uses whichever pattern actually
    matched: the primary pattern's capture groups if it matched, otherwise
    the first "OR match" condition (in the order they're listed) that did.
    E.g. with primary pattern `google\.com/maps/search/(.*)` and an "OR
    match" condition `google\.com/(.*)`, a target of `myUrl.com/$1` resolves
    `google.com/maps/search/PizzaPlace` to `myUrl.com/PizzaPlace` (via the
    primary pattern) and `google.com/somethingelse` to
    `myUrl.com/somethingelse` (via the OR condition, since the primary
    pattern didn't match that URL). If nothing matched, `$1` etc. resolve to
    nothing.
  - Drag a rule by its ⠿ handle to reorder it in the list. Order matters:
    matching rules' shortcuts are shown in rule order (then shortcut order
    within each rule), so drag a rule up to move its shortcuts earlier in
    the panel.
- **Shortcut**:
  - `Target URL` — where the shortcut goes. Can be:
    - relative, e.g. `/maps` or `api/v1/test` (resolved against the current
      page's URL)
    - absolute, e.g. `https://switch.to/api/v1/test`, or a bare domain like
      `google.com/maps` (no scheme needed — treated as `https://` the same
      way a browser address bar would)
    - a `javascript:` URI, e.g.
      `javascript:window.location = 'https://myService.de/?dl=1&url=' + window.location.href`
      (runs in the page's own context, so it can see page globals like
      jQuery or app state)
    - any of the above with `$1`, `$2`, ... or `$<name>` placeholders, filled
      in from the rule's regex capture groups (`$&` = whole match, `$$` =
      literal `$`). Example:
      - Pattern: `.*\.google\.com/?(?:search)?(?:\?q=([^&]+))?.*`
      - Target URL: `google.com/maps?q=$1`
      - On `https://www.google.com/search?q=pizza+place` this resolves to
        `https://google.com/maps?q=pizza+place`.
  - `Name` — shown as the button label when no icon is set.
  - `Icon` — optional. Either:
    - an image URL or `data:` URI (upload a file in the options page and
      it's converted to a `data:` URI automatically — non-SVG images are
      first downscaled to at most 128px on the longer side, since icons
      only ever render at ~20-32px and a raw multi-MB photo would blow
      past `chrome.storage.local`'s quota), or
    - a [Tabler icon](https://tabler.io/icons) — type `:` followed by a
      search term directly into the icon field itself (e.g. `:star`) to get
      a scrollable, live-previewed list of matches right there (substring
      match against all ~5,130 icon names — `:sta` matches both `star` and
      `tag-starred`); clicking one fills in the icon field as `:name`. All
      Tabler icons share the **Appearance** section's text color and a size
      derived from its Size slider (see below), since they're stroke-based
      (`stroke="currentColor"`) rather than fixed raster images - there's no
      separate per-icon color/size setting.
  - `Description` — shown together with the name in the hover tooltip:
    `Name - Description`.
  - `New tab` — checkbox, off by default. When on, clicking the shortcut
    always opens its target in a new tab, same as Ctrl/Cmd-clicking it.
  - `Hide on` — optional regex + flags. When set and it matches the page
    URL, this one shortcut is hidden even though its rule still matches -
    the rest of the rule's shortcuts are unaffected. E.g. a rule matching
    `google\.com/.*` with a shortcut whose `Hide on` is `google\.com/maps`
    hides just that shortcut on Google Maps while the rest of the rule's
    shortcuts keep showing there.
  - Drag a shortcut by its ⠿ handle to reorder it within its rule, or drop
    it into a different (expanded) rule's shortcut list to move it there -
    shortcut order determines display order in the panel (see above).

## Using it

<img src="media/options_light.png" alt="Options page, light theme" height="300"/><img src="media/options_dark.png" alt="Options page, dark theme" height="300"/>

- The floating panel appears on any page matching an enabled rule, in the
  corner (or bar) you pick on the options page's **Shortcut panel position**
  picker — click a corner of the little page mockup for a floating widget
  (top-left, top-right, bottom-left, bottom-right), or a side of the bar
  above it for a full-width bar docked to the top of the page
  (shortcutbar-left / shortcutbar-right, left/right-aligning the shortcuts
  within that bar). This applies to all rules at once. Click the ![⚡](extension/icons/icon16.png) toggle to
  collapse/expand the panel (remembered per site).
- Click a shortcut to navigate the current tab, or Ctrl/Cmd-click (or
  middle-click) to open it in a new tab. `javascript:` shortcuts always run
  in the current tab.
- The popup (toolbar icon) always lists the shortcuts matching the active
  tab, regardless of the **Overlay** switch in it — that switch (also present
  at the top of the options page) only shows or hides the floating panel/bar
  on the page itself, so you can still reach your shortcuts from the popup
  even with the on-page overlay off. To disable the extension entirely,
  use Chrome's own extensions menu instead.
- The options page has a "Test a URL" box to check which rules/shortcuts
  would fire for a given URL without leaving the settings page - typing one
  in also swaps the live preview above the position picker from generic
  icon-type examples to the actual matching shortcuts (or none, if the URL
  doesn't match any rule), so you can see exactly what that page would show.
  The Test URL itself is never saved - it's cleared again on every reload.
  Plus Export/Import buttons for backing up your configuration as JSON.
- The **Appearance** section on the options page lets you customize the
  panel's background color, background opacity (10–100%), text color, and an
  overall size; the live preview above the position picker updates
  immediately, and the same settings apply to the real panel on every page.
  The text color also colors any Tabler icons (there's no separate icon
  color). The Size slider (10–28, default 14) sets the shortcut text's
  font-size; icon size is derived from it in a fixed ratio (20px icons pair
  with 14px text) so icons and text always scale together rather than
  needing to be tuned separately. There's no browser-native color picker
  with an alpha channel to reach for, which is why background opacity stays
  a separate slider next to the background color swatch instead of one
  combined RGBA control. **Display Text with Icons** (off by default, matching
  the original icon-only look) additionally shows a shortcut's name next to
  its icon rather than hiding it; a shortcut with no icon always shows its
  name regardless of this setting.
- In "shortcut bar" mode, the page is pushed down by the bar's height rather
  than having the bar overlay it. As a best-effort fix for sites with their
  own sticky/fixed header near the top (which would otherwise still end up
  hidden under the bar, since padding only affects normal document flow), the
  extension also nudges nearby `position: fixed`/`sticky` elements down by
  the bar's height. This is a heuristic (bounded DOM scan near the top of the
  page) and may not catch every possible page layout — e.g. deeply nested
  sticky elements past the scan depth, or app shells built as a fixed-height
  `100vh` container with an inner scroll region.
- The **Animation** section on the options page controls how shortcuts
  appear/disappear — when the panel is toggled, when a rule starts/stops
  matching (e.g. during single-page-app navigation), or when the whole panel
  mounts/unmounts. Options:
  - Animations:

| `none` | `balloon` | `pop` | `fade` |
| ------ | --------- | ----- | ------ |
| ![](media/animation_none.gif) | ![](media/animation_balloon.gif) | ![](media/animation_pop.gif) | ![](media/animation_fade.gif) |
  - Duration (50–2000ms, default 500ms) is shared across all types and
    disabled when `none` is selected. Click the ![⚡](extension/icons/icon16.png) in the live preview to try
    the current selection before saving.
  - Only shortcuts that are actually appearing or disappearing animate — an
    unchanged shortcut across a re-render (e.g. the same rule still matching
    after an SPA navigation) is left alone, not re-animated.
  - Respects the OS-level "reduce motion" accessibility setting by skipping
    the animation (falling back to instant show/hide) when enabled.
- The options page (not the popup or the on-page overlay) has a **dark
  theme**, toggled via the pill-shaped Light/Auto/Dark icon control in its
  header (`:sun` / `:brightness-auto` / `:moon` — the active one is yellow
  with a small gray badge behind it, the other two are gray at 50% opacity
  so they read fine in either theme). "Auto" follows the OS/browser color
  scheme (`prefers-color-scheme`) live — there's no API for an extension
  page to read Chrome's own UI theme setting directly, so this is the
  closest equivalent and is what Chrome itself uses for its "Automatic"
  appearance setting. "Light"/"Dark" pin it regardless of that.  
- The popup's shortcut list always renders icons at a fixed size/color
  (dark gray, matching its own fixed light background), independent of the
  **Appearance** section - that section's colors are for the on-page panel,
  which has its own (user-chosen) background, so reusing them verbatim in
  the popup could make an icon invisible (e.g. white icons on the popup's
  light list background).

## Bucketlist

* Matching dark theme for short menu
* Regex Builder (must have, optional, capture group,...)
* Create Rule from current website
* Import of rules/links: extend instead of replace
* Export/Import of all Settings (with menu to select)
  * Selective Rule/setting export
  * Selective Rule/setting import

## License

Copyright (c) 2026 Dominik Breitling. Licensed under
[CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/) (Attribution-
NonCommercial) — see [`extension/LICENSE.txt`](extension/LICENSE.txt) for the full text.

The bundled Tabler Icons sprite (`extension/icons/tabler-sprite.svg`,
`extension/icons/tabler-icons-data.js`) is a separate third-party asset under the MIT
License — see [`extension/icons/TABLER-ICONS-LICENSE.txt`](extension/icons/TABLER-ICONS-LICENSE.txt).
