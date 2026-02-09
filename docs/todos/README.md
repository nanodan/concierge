# Improvement TODOs

Organized by category. Each file contains individual items with priority, effort estimate, approach, and affected files.

## Categories

| File | Items | Focus |
|------|-------|-------|
| [performance.md](performance.md) | 5 | Render caching, pagination, search/stats optimization |
| [ux-features.md](ux-features.md) | 12 | Notifications, templates, tags, batch ops, search, shortcuts |
| [architecture.md](architecture.md) | 5 | Module split, error handling, reconnect, tests, localStorage |
| [security.md](security.md) | 6 | Auth, rate limiting, input validation, XSS, CSRF |
| [accessibility.md](accessibility.md) | 4 | ARIA, keyboard focus, screen readers, contrast |

## Priority Guide

**High priority** — items that noticeably improve daily usage or address real pain points:
- Cache markdown render output (performance)
- Tab-unfocused completion notification (ux)
- Prompt templates (ux)
- Conversation tags/favorites (ux)
- Batch operations (ux)
- Break up app.js (architecture)
- Consistent error handling (architecture)
- Authentication (security, if used remotely)

**Quick wins** — low effort, meaningful improvement:
- WebSocket reconnect jitter (architecture)
- Dynamic token limits per model (ux)
- Accent color customization (ux)
- Input validation hardening (security)
- ARIA labels (accessibility)
