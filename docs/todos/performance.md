# Performance TODOs

## Cache markdown render output
**Priority:** High
**Effort:** Moderate

`renderMarkdown()` runs on every message every re-render (conversation open, scroll-back, etc). For long conversations this is the biggest perf bottleneck.

**Approach:**
- Hash message content and cache the rendered HTML
- Invalidate only when message content changes (edits)
- Store cache in a `Map` keyed by content hash or message index + content
- Could also cache at the DOM level by not re-rendering unchanged messages

**Files:** `public/app.js` (renderMessages, appendDelta, finalizeMessage), `public/markdown.js`

---

## Paginate conversation list API
**Priority:** Medium
**Effort:** Moderate

`GET /api/conversations` returns all conversations at once. Fine for hundreds, degrades with thousands.

**Approach:**
- Add `?offset=N&limit=N` params to the API
- Implement infinite scroll or "load more" on the frontend list view
- Keep search as a separate endpoint (already is)
- Consider cursor-based pagination for better perf with concurrent writes

**Files:** `server.js` (GET /api/conversations), `public/app.js` (loadConversations, renderConversationList)

---

## Optimize stats calculation
**Priority:** Low
**Effort:** Low-Medium

Stats endpoint loops through all conversations and all messages. Currently cached for 30 seconds, but first hit can be slow with many conversations.

**Approach:**
- Maintain running aggregates (total cost, message counts) in `index.json` metadata
- Update incrementally when conversations change
- Only do full recalc on explicit refresh or when aggregates are missing

**Files:** `server.js` (GET /api/stats)

---

## Optimize search for large datasets
**Priority:** Low
**Effort:** Medium

Search loads all messages into memory and does string matching. Could be slow with 1000+ conversations.

**Approach:**
- Build a lightweight inverted index on server startup
- Update index incrementally as messages are added
- Or use SQLite FTS if dependencies are acceptable
- Short-term: add early termination (stop after N matches)

**Files:** `server.js` (GET /api/conversations/search)

---

## Reduce swipe animation repaints
**Priority:** Low
**Effort:** Low

Touch move events fire every few pixels during swipe gestures, triggering repaints. On slower devices this can feel sluggish.

**Approach:**
- Throttle touch move handler with RAF (already used elsewhere)
- Use `will-change: transform` on swipeable elements
- Consider using CSS `touch-action` to let the browser optimize

**Files:** `public/app.js` (swipe handlers), `public/style.css`
