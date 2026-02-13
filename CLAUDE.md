# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Before You Start

**IMPORTANT:** If you haven't already read the documentation in this conversation, read these files FIRST before making any code changes:

1. **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** — Full system design: backend modules, frontend structure, service worker, data flow, WebSocket protocol, REST API, CSS architecture, touch interactions
2. **[docs/REFERENCE.md](docs/REFERENCE.md)** — Developer quick reference: file map with line ranges, data models, key functions, CSS classes, common modification patterns

This codebase has a specific modular structure (backend split into `lib/*.js`, CSS split into `public/css/*.css` + themes). Reading the docs first will help you make changes in the right places and follow existing patterns.

## What This Is

A mobile-first PWA that wraps the Claude CLI, providing a chat interface with real-time streaming, persistent conversations, and mobile-optimized UX (swipe gestures, long-press menus, voice input/output).

## Commands

```bash
npm start          # Start server (port 3577, or PORT env var)
npm test           # Run unit tests (Node.js built-in test runner)
npm install        # Install dependencies (express, ws, uuid)
```

No build step. The frontend is vanilla JS served as static files.

## Testing & Linting

**Run tests and lint after notable changes.**

```bash
npm test           # Run all unit tests
npm run lint       # Run ESLint

Test files:
- `test/server.test.js` — `convMeta`, `atomicWrite`, `processStreamEvent`
- `test/claude.test.js` — Stream event handling, tool calls, thinking, tokens
- `test/data.test.js` — Data layer, stats cache
- `test/markdown.test.js` — Markdown rendering, XSS prevention
- `test/utils.test.js` — `formatTime`, `formatTokens`, `truncate`

Test helpers in `test/helpers/*.cjs` provide CommonJS wrappers for ES modules.

## File Map (quick reference)

### Backend
| File | Lines | Purpose |
|------|-------|---------|
| `server.js` | ~226 | Express + WebSocket server, entry point |
| `lib/routes.js` | ~364 | REST API endpoints |
| `lib/claude.js` | ~240 | Claude CLI process management, streaming |
| `lib/data.js` | ~170 | Data storage, atomic writes, lazy loading |

### Frontend JS (`public/js/`)
| File | Lines | Purpose |
|------|-------|---------|
| `app.js` | ~266 | Main entry point, imports all modules, initialization |
| `state.js` | ~481 | Shared state module, all mutable state variables and setters |
| `ui.js` | ~1320 | UI interactions, event handlers, modals, theme, stats |
| `conversations.js` | ~693 | Conversation management, list rendering, swipe/long-press, bulk selection |
| `render.js` | ~429 | Rendering functions: messages, code blocks, TTS, reactions |
| `utils.js` | ~165 | Helper functions: formatTime, haptic, showToast (with undo), showDialog |
| `websocket.js` | ~108 | WebSocket connection management, reconnect logic |
| `markdown.js` | ~66 | Hand-rolled markdown parser |

### Frontend CSS (`public/css/`)
| File | Lines | Purpose |
|------|-------|---------|
| `base.css` | ~82 | CSS variables, resets, animations |
| `layout.css` | ~620 | Page layout, headers, view structure |
| `components.css` | ~1070 | Buttons, inputs, modals, toasts |
| `messages.css` | ~657 | Chat messages, code blocks, streaming |
| `list.css` | ~677 | Conversation list, cards, swipe actions, bulk selection |
| `themes/*.css` | ~210 ea | Color themes (darjeeling, claude, nord, budapest) |

### Other
| File | Lines | Purpose |
|------|-------|---------|
| `public/index.html` | ~276 | HTML structure, three views, modals |
| `public/sw.js` | ~86 | Service worker (cache-first for assets, network-first for API) |
| `public/manifest.json` | — | PWA manifest |

### Tests (`test/`)
| File | Purpose |
|------|---------|
| `server.test.js` | Core server functions: convMeta, atomicWrite, processStreamEvent |
| `claude.test.js` | Stream event handling: tool calls, thinking, tokens |
| `data.test.js` | Data layer: convMeta edge cases, stats cache |
| `markdown.test.js` | Markdown rendering, XSS prevention |
| `utils.test.js` | Utility functions: formatTime, formatTokens, truncate |
| `helpers/*.cjs` | CommonJS wrappers for ES modules (for testing) |

See [docs/REFERENCE.md](docs/REFERENCE.md) for detailed line ranges within each file.

## Architecture

**Backend** (`server.js`, `lib/*.js`): Express + WebSocket server. Code split into modules: `server.js` (entry), `lib/routes.js` (REST API), `lib/claude.js` (CLI process management), `lib/data.js` (storage). Spawns `claude` CLI as a child process per message, streams JSON output back to the client via WebSocket. Conversations stored as JSON files on disk.

**Frontend** (`public/js/*.js`, `public/index.html`, `public/css/*.css`): Single-page app with three views — conversation list, chat view, and stats dashboard. No framework, no bundler. Code is split into ES modules: `app.js` (entry), `state.js` (shared state), `utils.js` (helpers), `websocket.js` (WS connection), `render.js` (rendering), `conversations.js` (conversation management), `ui.js` (UI interactions), `markdown.js` (markdown parser). CSS is split into: `base.css`, `layout.css`, `components.css`, `messages.css`, `list.css`, plus color themes in `themes/`. Voice input uses SpeechRecognition API, voice output uses SpeechSynthesis API.

**Service Worker** (`public/sw.js`): Cache-first for static assets, network-first for conversation list API (offline support). Cache name `claude-chat-v32`.

### Data Flow

1. User sends message → WebSocket `message` event → server spawns `claude -p "text" --output-format stream-json --resume <sessionId> --add-dir <cwd>`
2. Claude CLI streams JSON to stdout → server parses line-by-line → sends `delta` events over WebSocket
3. CLI exits → server sends `result` event with full text, cost, duration → saves to disk

### Data Storage

- `data/index.json` — conversation metadata (loaded at startup, always in memory)
- `data/conv/{id}.json` — messages per conversation (lazy-loaded via `ensureMessages()`)
- `data/uploads/{id}/` — uploaded file attachments per conversation
- Atomic writes: all saves go through `atomicWrite()` (write to .tmp, rename to target)

### HTTPS

Certs in `certs/key.pem` + `certs/cert.pem` enable HTTPS automatically. Required for microphone access from non-localhost. Generated with `openssl req -x509 -newkey rsa:2048 -keyout certs/key.pem -out certs/cert.pem -days 365 -nodes`.

## Key Patterns

- **Message rendering**: `renderMessages()` for full re-render on conversation open, `appendDelta()` for streaming chunks (throttled via `requestAnimationFrame`), `finalizeMessage()` when Claude finishes. TTS and regenerate buttons are injected in both `renderMessages` and `finalizeMessage`.
- **Message actions**: Long-press/right-click on messages shows edit (user), copy, and fork options. Regenerate button on last assistant message.
- **File attachments**: Upload via REST, reference in WS message. Images render inline; files show as chips.
- **Conversation forking**: Fork from any message via long-press menu. Creates a new conversation with messages up to that point and a fresh Claude session.
- **Conversation list**: Cards grouped by working directory (scope) with collapsible headers. Swipe-to-reveal actions (archive/delete) and long-press/right-click context menu (pin/archive/rename/delete).
- **Pinned conversations**: Pin conversations to the top of the list via long-press menu. Stored as `pinned` boolean on conversation.
- **Bulk selection**: Multi-select mode for batch archive/delete. "Select" button in header, tap cards to select, bulk action bar at bottom.
- **Undo delete**: Single conversation deletes show 5-second toast with "Undo" button. Actual deletion is delayed.
- **Swipe-to-go-back**: In chat view, swipe from left edge to return to list (iOS-style).
- **Color themes**: Four color palettes (Darjeeling, Claude, Nord, Budapest) in `public/css/themes/`. Switched via dropdown in header.
- **Light/dark mode**: Cycles auto/light/dark via theme toggle. CSS uses `html[data-theme="light"]` selector.
- **Offline queue**: Messages queued while offline are persisted to localStorage and flushed on reconnect. SW caches conversation list for offline app loading.
- **Virtual scrolling**: Long conversations render last 100 messages initially; "Load earlier messages" button at top loads more pages.
- **Safe areas**: iOS safe area insets handled via `env(safe-area-inset-*)` CSS variables.
- **View transitions**: Three views (list, chat, stats) swap via CSS transform + opacity animations with `slide-out`/`slide-in` classes.
- **Keyboard shortcuts**: Cmd+K (search), Cmd+N (new chat), Cmd+E (export), Cmd+Shift+A (toggle archived), Escape (back/close).

## REST API

- `GET/POST /api/conversations` — list/create
- `GET/PATCH/DELETE /api/conversations/:id` — detail/update/delete
- `GET /api/conversations/search?q=` — full-text search
- `GET /api/models` — list available Claude models
- `GET /api/stats` — aggregate usage statistics
- `GET /api/browse?path=` / `POST /api/mkdir` — directory browser for setting conversation cwd
- `GET /api/conversations/:id/export?format=markdown|json` — export conversation
- `POST /api/conversations/:id/upload` — upload file attachment (raw body, X-Filename header)
- `POST /api/conversations/:id/fork` — fork conversation from message index

## WebSocket Events

**Client → Server:** `message` (send chat), `cancel` (kill process), `regenerate` (re-run last prompt), `edit` (edit & resend message)
**Server → Client:** `delta` (text chunk), `result` (final response), `status` (thinking/idle), `error`, `stderr`, `messages_updated` (after edit)

## Common Modification Patterns

See [docs/REFERENCE.md](docs/REFERENCE.md) for step-by-step guides on:
- Adding a new REST endpoint
- Adding a new WebSocket event type
- Adding a new UI feature to chat view
- Adding a conversation property
- Modifying the markdown renderer
- Updating the service worker cache

## Documentation Maintenance

**When making code changes, update the docs to match.** Specifically:

- **`CLAUDE.md`**: Update if you add/remove/rename files, API endpoints, WebSocket events, or key patterns. Update the File Map line counts if they shift significantly (50+ lines).
- **`docs/REFERENCE.md`**: Update line ranges when adding/removing significant code sections. Update data models when fields change. Update the key functions table when adding important new functions.
- **`docs/ARCHITECTURE.md`**: Update when changing system design, adding new views/features, modifying the data flow, or changing the CSS design system.

Keep it proportional — a small bug fix doesn't need doc updates, but adding a new feature or API endpoint does.
