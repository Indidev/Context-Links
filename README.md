# Context Links

A small Manifest V3 Chrome/Chromium extension that shows a floating panel of
custom shortcuts on websites whose URL matches a regex you configure.

## Install (unpacked)

1. Open `chrome://extensions`.
2. Enable **Developer mode** (top right).
3. Click **Load unpacked** and select this folder.
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

## Using it

- The floating panel appears on any page matching an enabled rule, in the
  corner (or bar) you pick on the options page's **Shortcut panel position**
  picker — click a corner of the little page mockup for a floating widget
  (top-left, top-right, bottom-left, bottom-right), or a side of the bar
  above it for a full-width bar docked to the top of the page
  (shortcutbar-left / shortcutbar-right, left/right-aligning the shortcuts
  within that bar). This applies to all rules at once. Click the ![⚡](icons/icon16.png) toggle to
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
  would fire for a given URL without leaving the settings page, plus
  Export/Import buttons for backing up your configuration as JSON.
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
  - `none` — instant, no animation (the original behavior).
  - `balloon` — every icon flies from/to the ![⚡](icons/icon16.png) toggle's position while
    growing/shrinking; all icons start together but each drifts at a
    slightly different speed.
  - `pop` — icons scale in/out in place (no movement), one after another —
    nearest to the toggle first when appearing, farthest first when
    disappearing (so it visually "collects" into the toggle last).
  - `fade` — a plain, synchronized opacity fade.
  - Duration (50–2000ms, default 500ms) is shared across all types and
    disabled when `none` is selected. Click the ![⚡](icons/icon16.png) in the live preview to try
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

## Notes

- Configuration is stored in `chrome.storage.local` (not synced), since icons
  can be large `data:` URIs that would exceed `storage.sync` quotas. The
  extension requests the `unlimitedStorage` permission so a large
  configuration (many rules/shortcuts, or several image icons) doesn't hit
  `chrome.storage.local`'s own default quota either.
- The content script runs on all pages but only renders anything when a rule
  matches, so the footprint on non-matching sites is a single cheap regex
  test.
- Chrome extension icons must be PNG (it doesn't support SVG for
  `manifest.json`'s `icons`/`action.default_icon` fields). `icons/icon.svg`
  is the source of truth for the extension's own toolbar/store icon — edit it
  and regenerate `icons/icon{16,32,48,128}.png` from it (e.g. via `cairosvg`,
  rendering at high resolution and downsampling with a quality filter for
  crisper small sizes) rather than editing the PNGs directly.
- The floating panel's own ![⚡](icons/icon16.png) toggle button uses a separate asset,
  `icons/icon-overlay.svg` — same artwork as `icon.svg` but with the
  background dropped (transparent) and a thin outline added to the chain
  links instead, since it sits on top of the toggle button's own
  (user-configurable) accent color rather than a fixed dark square. Unlike
  the manifest icons, this one *is* used directly as an SVG (loaded via
  `chrome.runtime.getURL()` into an `<img>`), since the "PNG only" rule only
  applies to the manifest's own icon fields, not to images used within pages
  the extension injects/renders. It's declared in `web_accessible_resources`
  so content scripts can load it into the pages they run on.
- Tabler icon support bundles the official
  [`@tabler/icons-sprite`](https://tabler.io/icons) outline set (MIT
  licensed — see `icons/TABLER-ICONS-LICENSE.txt`) as a single ~2.2MB sprite
  file, `icons/tabler-sprite.svg` (all ~5,130 icons as `<symbol>` elements,
  rendered via `<use href="tabler-sprite.svg#tabler-NAME">`), plus
  `icons/tabler-icons-data.js` (a generated `window.TABLER_ICON_NAMES` array
  used only by the options page's `:`-search-in-the-icon-field feature).
  Bundled rather than loaded from a CDN at runtime, so icon search/rendering
  works fully offline and doesn't depend on a third party staying up. To
  update to a newer Tabler release, re-download `tabler-sprite.svg` from the
  `@tabler/icons-sprite` npm package and regenerate `tabler-icons-data.js`
  by extracting `<symbol id="tabler-NAME">` ids from it. A shortcut's icon
  value is stored as `:name` (e.g. `:star`); the old `tabler:name` form
  from before this prefix changed is still recognized when reading existing
  configurations, but is no longer written.
- On regular web pages, Tabler icons are rendered via `<svg><use
  href="#tabler-NAME">`, referencing a *same-tree* copy of the sprite
  rather than the extension's `chrome-extension://.../tabler-sprite.svg`
  URL directly. `<use>` references across origins (an extension URL from a
  page on a different origin) are blocked by the browser ("Unsafe attempt
  to load URL... Domains, protocols and ports must match"), so
  `buildIconElement()` in `common.js` fetches the sprite once and inlines
  it into a hidden container, then points every icon's `<use>` at the
  local fragment. `<use>` fragment lookups are also scoped to the shadow
  tree they're rendered in, so `buildIconElement()` takes the actual
  render root (the floating panel's shadow root for content.js, the
  document itself for the options page/popup) and inlines a copy there
  specifically — a copy sitting in the page's light DOM wouldn't be
  visible to `<use>` elements inside the panel's shadow root.
