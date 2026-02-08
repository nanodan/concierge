# Claude Remote Chat

A mobile-first Progressive Web App that wraps the [Claude CLI](https://docs.anthropic.com/en/docs/claude-code), providing a real-time streaming chat interface with persistent conversations and mobile-optimized UX.

## Features

- **Real-time streaming** - See Claude's responses as they're generated, token by token
- **Persistent conversations** - Chat history saved to disk, survives restarts
- **Session continuity** - Conversations resume where you left off using Claude CLI sessions
- **Multiple models** - Switch between Opus, Sonnet, and Haiku models per conversation
- **Voice input** - Dictate messages using the Web Speech API (requires HTTPS)
- **Text-to-speech** - Listen to Claude's responses read aloud
- **Mobile-first design** - Swipe gestures, long-press menus, safe area support for iOS
- **Autopilot mode** - Skip CLI permission prompts for trusted workflows
- **Working directory** - Set a per-conversation working directory for Claude to operate in
- **Full-text search** - Search across conversation names and message content
- **Usage stats** - Dashboard with cost tracking, activity charts, and fun facts
- **Offline support** - Service worker caches the app shell for offline access
- **Installable PWA** - Add to home screen on iOS/Android for a native app feel

## Quick Start

```bash
# Install dependencies
npm install

# Start the server
npm start
```

The app runs at `https://localhost:3577` (or `http://` if no certs are configured).

### Prerequisites

- **Node.js** (v18+)
- **Claude CLI** installed and authenticated (`claude` must be available on PATH)

### HTTPS Setup (required for voice input on non-localhost)

```bash
mkdir -p certs
openssl req -x509 -newkey rsa:2048 \
  -keyout certs/key.pem -out certs/cert.pem \
  -days 365 -nodes -subj '/CN=localhost'
```

The server auto-detects certs and enables HTTPS. Without certs, it falls back to HTTP.

## Usage

1. **Create a conversation** - Tap the + button, give it a name, and optionally set a working directory
2. **Chat** - Type a message and hit Enter (or tap Send). Claude streams its response in real time
3. **Voice input** - Tap the mic icon to dictate (requires HTTPS)
4. **Listen** - Tap the speaker icon on any assistant message to hear it read aloud
5. **Switch models** - Tap the model name in the chat header to change models
6. **Autopilot** - Tap the mode badge (AP/ASK) to toggle permission skipping
7. **Manage conversations** - Swipe left on a card to archive/delete, or long-press for more options
8. **Search** - Use the search bar to find conversations by name or content
9. **Stats** - Tap the chart icon to view usage analytics

## Configuration

| Environment Variable | Default | Description |
|---------------------|---------|-------------|
| `PORT` | `3577` | Server port |

## Tech Stack

- **Backend**: Node.js, Express, WebSocket (`ws`), child_process
- **Frontend**: Vanilla JavaScript, HTML5, CSS3 (no framework, no bundler)
- **Storage**: JSON files on disk (`data/` directory)
- **PWA**: Service worker with cache-first strategy, web app manifest

## Project Structure

```
remote/
├── server.js              # Express + WebSocket backend
├── public/
│   ├── index.html         # Single-page app HTML
│   ├── app.js             # Frontend application logic
│   ├── style.css          # Complete styling (dark theme)
│   ├── markdown.js        # Hand-rolled markdown renderer
│   ├── sw.js              # Service worker
│   ├── manifest.json      # PWA manifest
│   └── lib/
│       └── highlight.min.js  # Syntax highlighting
├── data/
│   ├── index.json         # Conversation metadata
│   └── conv/              # Individual conversation message files
├── certs/                 # Optional HTTPS certificates
│   ├── key.pem
│   └── cert.pem
├── docs/                  # Detailed documentation
│   ├── ARCHITECTURE.md    # System architecture
│   └── REFERENCE.md       # Developer quick reference
└── package.json
```

## Documentation

- [Architecture Guide](docs/ARCHITECTURE.md) - Detailed system design, data flow, and component breakdown
- [Developer Reference](docs/REFERENCE.md) - Quick-reference for APIs, data models, file map, and common patterns
