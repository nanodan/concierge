# Architecture TODOs

## Break up app.js into modules
**Priority:** High
**Effort:** High

`app.js` is 2039 lines with ~25 top-level state variables. Hard to reason about and maintain.

**Approach:**
- Split into ES modules (native browser support, no bundler needed):
  - `state.js` — central state store, getters/setters
  - `ws.js` — WebSocket connection, reconnect, message handling
  - `render.js` — DOM rendering (conversation list, messages, modals)
  - `gestures.js` — swipe, long-press, pull-to-refresh
  - `voice.js` — speech recognition and synthesis
  - `search.js` — search UI and filtering logic
  - `stats.js` — stats view rendering
- Use a simple pub/sub or event emitter for cross-module communication
- Update `index.html` to use `<script type="module">`
- Update service worker cache list

**Files:** `public/app.js` (split), `public/index.html` (script tags), `public/sw.js` (cache list)

**Risk:** Large refactor, easy to introduce regressions without tests. Consider doing incrementally — extract one module at a time.

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

## WebSocket reconnect jitter
**Priority:** Medium
**Effort:** Low

Exponential backoff has no jitter. If server restarts, all clients reconnect at the same intervals (thundering herd problem).

**Approach:**
- Add random jitter to reconnect delay: `delay * (0.5 + Math.random())`
- Keep the existing max of 30 seconds
- Consider adding a reconnect attempt limit with a "reconnect now" button after max attempts

**Files:** `public/app.js` (WebSocket reconnect logic)

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
