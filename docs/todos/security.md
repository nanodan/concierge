# Security TODOs

## Add authentication layer
**Priority:** High (if used remotely)
**Effort:** Medium

No auth at all. Anyone with network access can read/write all conversations.

**Approach:**
- Simple token-based auth: generate a random token on first run, store in a config file
- Require `Authorization: Bearer <token>` on all API requests
- WebSocket auth: send token in first message or as query param on upgrade
- Display the token in server startup logs for the user to copy
- Optional: password-based login page that issues a session cookie

**Files:** `server.js` (middleware), `public/js/utils.js` (apiFetch wrapper)

**Note:** Only needed for remote/multi-user. Local-only usage behind a firewall is fine without.

---

## Add rate limiting
**Priority:** Medium
**Effort:** Low

No protection against a client spamming requests or spawning excessive Claude processes.

**Approach:**
- Limit concurrent Claude processes per client (e.g., 1 active at a time — already mostly true)
- Rate limit API endpoints (e.g., 60 requests/minute per IP)
- Rate limit WebSocket messages (e.g., 10/second)
- Use a simple in-memory counter, no need for Redis

**Files:** `server.js` (middleware or inline checks)

---

## Input validation hardening
**Priority:** Medium
**Effort:** Low

User message text is accepted as-is. Very long messages or malformed data could cause issues.

**Approach:**
- Max message length (e.g., 100KB)
- Max attachment count per message
- Max file size per upload (currently no limit enforced)
- Validate conversation IDs are valid UUIDs before using in file paths
- Validate all JSON payloads against expected shapes

**Files:** `lib/routes.js` (API endpoints), `lib/claude.js` (message handler)

---

## Audit markdown parser for XSS
**Priority:** Medium
**Effort:** Low

Hand-rolled markdown parser uses `escapeHtml()` everywhere, but complex edge cases could bypass it.

**Approach:**
- Fuzz test the markdown parser with adversarial inputs
- Specifically test: nested code blocks, malformed links, HTML entities, script injection in URLs
- Consider using DOMPurify as a final sanitization pass on rendered HTML
- Or switch to a battle-tested markdown library (adds dependency)

**Files:** `public/js/markdown.js`, `public/js/render.js` (renderMarkdown calls)

---

## Scope search to authenticated user
**Priority:** Low (only matters with auth)
**Effort:** Low

Search endpoint returns results from all conversations. If multi-user auth is added, search must filter by user.

**Approach:**
- Once auth exists, add user context to search
- Filter conversation list by owner before searching messages

**Files:** `lib/routes.js` (search endpoint)

---

## CSRF protection for REST endpoints
**Priority:** Low
**Effort:** Low

REST endpoints have no CSRF tokens. Not exploitable in single-user local mode, but matters if auth is added.

**Approach:**
- Generate CSRF token per session
- Include in a meta tag, send as header on all fetch requests
- Validate server-side on state-changing endpoints (POST, PATCH, DELETE)
- Or use `SameSite=Strict` cookies if switching to cookie-based auth

**Files:** `server.js` (middleware), `public/js/utils.js` (apiFetch wrapper), `public/index.html` (meta tag)
