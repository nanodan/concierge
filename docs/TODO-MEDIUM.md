# Medium Priority Improvements

## 6. Light Mode / Respect `prefers-color-scheme`

**Problem:** Currently dark-only (style.css `:root` vars). Some users need or prefer light mode.

### Frontend (`public/style.css`)
- Keep current `:root` vars as the dark theme (they're the default)
- Add a `[data-theme="light"]` selector block with light-mode overrides:
  ```
  --bg: #f5f5f7;
  --bg-secondary: #e8e8ed;
  --bg-tertiary: #d1d1d6;
  --surface: #ffffff;
  --text: #1c1c1e;
  --text-secondary: #636366;
  --accent: #6a5ae0;
  --accent-light: #7c6cf0;
  --user-bubble: #6a5ae0;
  --assistant-bubble: #f0f0f2;
  --border: #d1d1d6;
  --input-bg: #ffffff;
  --glass-bg: rgba(255, 255, 255, 0.78);
  --glass-border: rgba(0, 0, 0, 0.08);
  ```
- Update syntax highlighting colors for light mode under `[data-theme="light"]`
- Add `@media (prefers-color-scheme: light)` that applies light vars by default when no explicit theme is set

### Frontend (`public/app.js`)
- Add theme state: `let currentTheme = localStorage.getItem('theme') || 'auto'`
- Add `applyTheme()` function that:
  - If 'auto': check `matchMedia('(prefers-color-scheme: light)')` and set `data-theme` accordingly
  - If 'light' or 'dark': set `data-theme` directly on `<html>`
  - Also update `<meta name="theme-color">` for the status bar
- Listen to `matchMedia` changes to update on OS theme change (when in auto mode)
- Add a theme toggle button to the list-view header (sun/moon icon)
- Cycle: auto -> light -> dark -> auto

### Frontend (`public/index.html`)
- Add theme toggle button in `.header-actions`

---

## 7. WebSocket Reconnect with Exponential Backoff

**Problem:** Reconnects after a flat 2s (app.js:128) with no backoff and no message queue. In-flight messages lost on disconnect.

### Frontend (`public/app.js`)
- Replace flat `setTimeout(connectWS, 2000)` with exponential backoff:
  ```
  let reconnectAttempt = 0;
  const MAX_RECONNECT_DELAY = 30000;

  ws.onclose = () => {
    const delay = Math.min(1000 * Math.pow(2, reconnectAttempt), MAX_RECONNECT_DELAY);
    reconnectAttempt++;
    reconnectTimer = setTimeout(connectWS, delay);
  };

  ws.onopen = () => {
    reconnectAttempt = 0;  // Reset on successful connection
    ...
  };
  ```
- Add a message queue for offline resilience:
  - `let pendingMessages = []`
  - In `sendMessage()`: if WS not open, push to `pendingMessages` and show "queued" indicator
  - In `ws.onopen`: flush `pendingMessages` by sending each one
- Show a persistent banner when disconnected (after first failed reconnect):
  - "Reconnecting..." with a subtle pulsing animation
  - Auto-dismiss on reconnect

### Frontend (`public/style.css`)
- Style the disconnected banner (top of chat view, below header, subtle warning color)

---

## 8. Keyboard Shortcuts

**Problem:** No keyboard shortcuts for common actions.

### Frontend (`public/app.js`)
- Add a global `keydown` listener on `document`:
  - `Cmd/Ctrl + K` -> focus search input (if on list view)
  - `Cmd/Ctrl + N` -> open new conversation modal
  - `Escape` -> go back (if in chat view, go to list; if modal open, close modal)
  - `Cmd/Ctrl + Shift + A` -> toggle archive view
  - `Cmd/Ctrl + E` -> export current conversation (if in chat view)
- Guard against firing when typing in an input/textarea (except Escape)
- Only bind shortcuts that make sense for the current view

---

## 9. Better Search with Filters

**Problem:** Current search is brute-force `.includes()` over all messages (server.js:248-275). No filtering by date, model, cost.

### Backend (`server.js`)
- Extend `/api/conversations/search` to accept optional query params:
  - `dateFrom`, `dateTo` (ISO timestamps) - filter conversations by `createdAt` range
  - `model` - filter by conversation model
  - `minCost`, `maxCost` - filter by conversation total cost
- Apply filters before loading messages (skip conversations that don't match metadata filters)
- This avoids loading messages for non-matching conversations, improving performance

### Frontend (`public/app.js`)
- Add a filter toggle button next to the search input
- On toggle: show/hide a filter row below the search bar with:
  - Date range picker (two date inputs or "Last 7 days" / "Last 30 days" / "All time" chips)
  - Model dropdown (populated from `models` array)
- Include filter params in the search API call
- Add in-conversation search: `Cmd/Ctrl + F` while in chat view opens a search bar that highlights matching messages and scrolls between them

### Frontend (`public/index.html`)
- Add filter row markup below `.search-bar`

### Frontend (`public/style.css`)
- Style the filter row (compact, chip-style buttons, collapsible)

---

## 10. Virtual Scrolling for Long Conversations

**Problem:** `renderMessages()` (app.js:616-633) rebuilds entire innerHTML. Conversations with hundreds of messages get sluggish.

### Frontend (`public/app.js`)
- Implement a simple windowed rendering approach:
  - Keep full `messages` array in memory (already the case)
  - Only render messages within the visible viewport + a buffer (e.g., 50 messages above and below)
  - On scroll: check if we need to render more messages above (if scrolling up) or below
  - Use a sentinel element at the top to detect when user scrolls near the beginning
- Preserve scroll position when prepending older messages
- Keep the current `appendDelta()` flow for streaming (always appends at bottom)
- For initial open: render last ~100 messages, lazy-load older ones on scroll-up
- This is a significant refactor; can be done incrementally:
  1. First: paginate the initial render (show last 100, "Load more" button at top)
  2. Later: automatic infinite scroll with intersection observer
