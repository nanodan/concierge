# Security TODOs

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

