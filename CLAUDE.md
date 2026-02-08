# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

A mobile-first PWA that wraps the Claude CLI, providing a chat interface with real-time streaming, persistent conversations, and mobile-optimized UX (swipe gestures, long-press menus, voice input/output).

## Commands

```bash
npm start          # Start server (port 3577, or PORT env var)
npm install        # Install dependencies (express, ws, uuid)
```

No build step, no tests, no linting. The frontend is vanilla JS served as static files.

## Architecture

**Backend** (`server.js`): Express + WebSocket server. Spawns `claude` CLI as a child process per message, streams JSON output back to the client via WebSocket. Conversations stored as JSON files on disk.

**Frontend** (`public/app.js`, `public/index.html`, `public/style.css`): Single-page app with two views — conversation list and chat view. No framework, no bundler. Markdown rendering is hand-rolled. Voice input uses SpeechRecognition API, voice output uses SpeechSynthesis API.

**Service Worker** (`public/sw.js`): Cache-first for static assets, network-first for API calls. Cache name `claude-chat-v1`.

### Data Flow

1. User sends message → WebSocket `message` event → server spawns `claude -p "text" --output-format stream-json --resume <sessionId> --add-dir <cwd>`
2. Claude CLI streams JSON to stdout → server parses line-by-line → sends `delta` events over WebSocket
3. CLI exits → server sends `result` event with full text, cost, duration → saves to disk

### Data Storage

- `data/index.json` — conversation metadata (loaded at startup)
- `data/conv/{id}.json` — messages per conversation (lazy-loaded on open)
- Messages are only loaded into memory when a conversation is opened (`ensureMessages()`)

### HTTPS

Certs in `certs/key.pem` + `certs/cert.pem` enable HTTPS automatically. Required for microphone access from non-localhost. Generated with `openssl req -x509 -newkey rsa:2048 -keyout certs/key.pem -out certs/cert.pem -days 365 -nodes`.

## Key Patterns

- **Message rendering**: `renderMessages()` for full re-render on conversation open, `appendDelta()` for streaming chunks, `finalizeMessage()` when Claude finishes. TTS buttons are injected in both `renderMessages` and `finalizeMessage`.
- **Conversation list**: Cards with swipe-to-reveal actions (archive/delete) and long-press/right-click context menu.
- **CSS variables**: Dark theme defined in `:root` in `style.css`. Accent color is `#6c63ff`.
- **Safe areas**: iOS safe area insets handled via `env(safe-area-inset-*)` CSS variables.

## REST API

- `GET/POST /api/conversations` — list/create
- `GET/PATCH/DELETE /api/conversations/:id` — detail/update/delete
- `GET /api/conversations/search?q=` — full-text search
- `GET /api/browse?path=` / `POST /api/mkdir` — directory browser for setting conversation cwd
