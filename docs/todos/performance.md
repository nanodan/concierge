# Performance TODOs

## ~~Cache markdown render output~~ ✅ DONE
**Priority:** High
**Effort:** Moderate

~~`renderMarkdown()` runs on every message every re-render.~~ **IMPLEMENTED**

- FNV-1a hash of content used as cache key
- LRU cache with 500-message capacity
- `skipCache` option for streaming (partial content changes rapidly)
- Cache cleared via `clearMarkdownCache()`
- ~2-5x faster re-renders on large conversations

**Files:** `public/js/markdown.js`

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

**Files:** `lib/routes.js` (GET /api/conversations), `public/js/conversations.js` (loadConversations, renderConversationList)

---

## Optimize stats calculation
**Priority:** Low
**Effort:** Low-Medium

Stats endpoint loops through all conversations and all messages. Currently cached for 30 seconds, but first hit can be slow with many conversations.

**Approach:**
- Maintain running aggregates (total cost, message counts) in `index.json` metadata
- Update incrementally when conversations change
- Only do full recalc on explicit refresh or when aggregates are missing

**Files:** `lib/routes.js` (GET /api/stats), `lib/data.js` (stats cache)

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

**Files:** `lib/routes.js` (GET /api/conversations/search)

---

## ~~Reduce swipe animation repaints~~ ✅ DONE
**Priority:** Low
**Effort:** Low

~~Touch move events fire every few pixels during swipe gestures.~~ **IMPLEMENTED**

- `will-change: transform` added to swipeable elements
- `touch-action: pan-y` added to conversation cards
- CSS transitions optimized
