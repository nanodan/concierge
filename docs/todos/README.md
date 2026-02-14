# Improvement TODOs

Organized by category. Each file contains individual items with priority, effort estimate, approach, and affected files.

## Recently Completed ✅

- **Git revert/reset** — revert commits, reset to previous commits (soft/mixed/hard), undo last commit with action buttons in History tab
- **Open files in new tab** — floating button to open any text file in new tab (renders HTML, shows raw for others)
- **Consistent error handling** — `apiFetch()` wrapper with toast notifications for 30+ fetch calls across all frontend modules
- **Test coverage** — unit tests for server, claude, data, markdown, utils using Node.js built-in test runner
- **Image thumbnails** — file browser shows actual thumbnails for images with lazy loading
- **Tab notifications** — native browser notifications + title prefix when response completes in background
- **Tool call visibility** — show intermediate tool calls/results during streaming, collapsible in final message
- **Mobile-friendly buttons** — header buttons, TTS/regenerate buttons sized for touch (40px targets)
- **Recent directories** — quick-select recent cwds when creating new chats, plus "+" on scope headers
- **File browser** — browse/download files from conversation cwd or anywhere on server
- **Module split** — app.js broken into 8 ES modules (state, websocket, render, conversations, ui, utils, markdown, app)
- **Batch operations** — multi-select mode with bulk archive/delete and undo
- **Keyboard shortcuts** — Cmd+K search, Cmd+N new chat, Escape back, etc.
- **Pin conversations** — pin important chats to top of list
- **Swipe-to-go-back** — iOS-style edge swipe navigation
- **Undo delete** — 5-second undo toast for single deletes
- **ARIA labels** — added to 20+ icon-only buttons
- **Focus-visible styles** — accent-colored focus rings on interactive elements
- **Swipe optimizations** — will-change and touch-action CSS properties

## Categories

| File | Open Items | Focus |
|------|------------|-------|
| [performance.md](performance.md) | 4 | Render caching, pagination, search/stats optimization |
| [ux-features.md](ux-features.md) | 11 | Templates, tags, search, timestamps, lightbox |
| [architecture.md](architecture.md) | 1 | localStorage versioning |
| [security.md](security.md) | 6 | Auth, rate limiting, input validation, XSS, CSRF |
| [accessibility.md](accessibility.md) | 2 | Screen readers, contrast (ARIA/focus partial) |
| [multi-provider.md](multi-provider.md) | 1 | OpenAI, Google, provider abstraction layer |
| [file-browser.md](file-browser.md) | 5 | Upload, quick actions, recent files, editing, iOS share |

## Priority Guide

**High priority** — items that noticeably improve daily usage or address real pain points:
- Cache markdown render output (performance)
- Prompt templates (ux)
- Conversation tags/favorites (ux)
- Authentication (security, if used remotely)

**Quick wins** — low effort, meaningful improvement:
- Accent color customization (ux)
- Input validation hardening (security)
- localStorage versioning (architecture)
