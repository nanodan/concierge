# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Detailed Documentation

Before reading source files, consult these docs for context:

- **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** — Full system design: backend, frontend, service worker, data flow, WebSocket protocol, REST API, CSS architecture
- **[docs/REFERENCE.md](docs/REFERENCE.md)** — Developer quick reference: file map with line ranges, data models, key functions, CSS classes, common modification patterns, Claude CLI integration details

## What This Is

A mobile-first PWA that wraps the Claude CLI, providing a chat interface with real-time streaming, persistent conversations, and mobile-optimized UX (swipe gestures, long-press menus, voice input/output).

## Commands

```bash
npm start          # Start server (port 3577, or PORT env var)
npm install        # Install dependencies (express, ws, uuid)
```

No build step, no tests, no linting. The frontend is vanilla JS served as static files.

## File Map (quick reference)

| File | Lines | Purpose |
|------|-------|---------|
| `server.js` | ~654 | Express + WebSocket backend, Claude CLI process management |
| `public/app.js` | ~1406 | Frontend SPA logic, state, all UI interactions |
| `public/index.html` | ~164 | HTML structure, three views, modals |
| `public/style.css` | ~1858 | Dark theme, glass-morphism, animations, safe areas |
| `public/markdown.js` | ~66 | Hand-rolled markdown parser |
| `public/sw.js` | ~53 | Service worker (cache-first for assets) |
| `public/manifest.json` | — | PWA manifest |

See [docs/REFERENCE.md](docs/REFERENCE.md) for detailed line ranges within each file.

## Architecture

**Backend** (`server.js`): Express + WebSocket server. Spawns `claude` CLI as a child process per message, streams JSON output back to the client via WebSocket. Conversations stored as JSON files on disk.

**Frontend** (`public/app.js`, `public/index.html`, `public/style.css`): Single-page app with three views — conversation list, chat view, and stats dashboard. No framework, no bundler. Markdown rendering is hand-rolled. Voice input uses SpeechRecognition API, voice output uses SpeechSynthesis API.

**Service Worker** (`public/sw.js`): Cache-first for static assets, network-only for API calls. Cache name `claude-chat-v10`.

### Data Flow

1. User sends message → WebSocket `message` event → server spawns `claude -p "text" --output-format stream-json --resume <sessionId> --add-dir <cwd>`
2. Claude CLI streams JSON to stdout → server parses line-by-line → sends `delta` events over WebSocket
3. CLI exits → server sends `result` event with full text, cost, duration → saves to disk

### Data Storage

- `data/index.json` — conversation metadata (loaded at startup, always in memory)
- `data/conv/{id}.json` — messages per conversation (lazy-loaded via `ensureMessages()`)
- Atomic writes: all saves go through `atomicWrite()` (write to .tmp, rename to target)

### HTTPS

Certs in `certs/key.pem` + `certs/cert.pem` enable HTTPS automatically. Required for microphone access from non-localhost. Generated with `openssl req -x509 -newkey rsa:2048 -keyout certs/key.pem -out certs/cert.pem -days 365 -nodes`.

## Key Patterns

- **Message rendering**: `renderMessages()` for full re-render on conversation open, `appendDelta()` for streaming chunks, `finalizeMessage()` when Claude finishes. TTS buttons are injected in both `renderMessages` and `finalizeMessage`.
- **Conversation list**: Cards with swipe-to-reveal actions (archive/delete) and long-press/right-click context menu.
- **CSS variables**: Dark theme defined in `:root` in `style.css`. Accent color is `#7c6cf0`.
- **Safe areas**: iOS safe area insets handled via `env(safe-area-inset-*)` CSS variables.
- **View transitions**: Three views (list, chat, stats) swap via CSS transform + opacity animations with `slide-out`/`slide-in` classes.

## REST API

- `GET/POST /api/conversations` — list/create
- `GET/PATCH/DELETE /api/conversations/:id` — detail/update/delete
- `GET /api/conversations/search?q=` — full-text search
- `GET /api/models` — list available Claude models
- `GET /api/stats` — aggregate usage statistics
- `GET /api/browse?path=` / `POST /api/mkdir` — directory browser for setting conversation cwd

## WebSocket Events

**Client → Server:** `message` (send chat), `cancel` (kill process)
**Server → Client:** `delta` (text chunk), `result` (final response), `status` (thinking/idle), `error`, `stderr`

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
