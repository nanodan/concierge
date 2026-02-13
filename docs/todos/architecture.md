# Architecture TODOs

## ~~Break up app.js into modules~~ ✅ DONE
**Priority:** High
**Effort:** High

~~`app.js` is 2039 lines with ~25 top-level state variables.~~ **IMPLEMENTED**

Code has been split into ES modules:
- `state.js` — central state store, getters/setters
- `websocket.js` — WebSocket connection, reconnect, message handling
- `render.js` — DOM rendering, message display
- `conversations.js` — conversation list, CRUD, swipe gestures
- `ui.js` — UI interactions, settings, theme handling
- `utils.js` — utilities, toast, dialog
- `markdown.js` — markdown parsing
- `app.js` — main entry point, initialization

---

## Add consistent error handling
**Priority:** High
**Effort:** Medium

Many fetch calls silently fail. No consistent pattern for showing errors to the user.

**Approach:**
- Create a central `handleError(error, context)` function
- Display user-visible toast/banner for all failed operations
- Log errors to console with context for debugging
- Categorize errors: network, server, client, timeout
- Add retry logic for transient failures (network blips)

**Files:** `public/app.js` (all fetch calls, WebSocket error handler)

---

## ~~WebSocket reconnect jitter~~ ✅ DONE
**Priority:** Medium
**Effort:** Low

~~Exponential backoff has no jitter.~~ **IMPLEMENTED**

- Added random jitter: `baseDelay * (0.5 + Math.random())` gives 50-150% of base delay
- Prevents thundering herd on server restart

---

## Add basic test coverage
**Priority:** Medium
**Effort:** High

Zero tests currently. Critical paths (streaming, session management, search, markdown parsing) are untested.

**Approach:**
- Start with unit tests for pure functions:
  - `markdown.js` — rendering edge cases
  - `escapeHtml` — XSS prevention
  - Server-side search logic
  - Conversation CRUD operations
- Use a lightweight test runner (e.g., `node --test` built-in, or `vitest`)
- Integration tests for WebSocket message flow (mock Claude CLI)
- No need to test DOM — focus on logic

**Files:** New `tests/` directory, `package.json` (test script)

---

## localStorage versioning
**Priority:** Low
**Effort:** Low

Offline messages, unread convs, theme, collapsed scopes all stored in localStorage with no schema versioning. If the schema changes, old data silently becomes garbage.

**Approach:**
- Add a `schemaVersion` key to localStorage
- On app load, check version and migrate if needed
- Write migration functions for each version bump
- Clear stale keys that are no longer used

**Files:** `public/app.js` (initialization)
