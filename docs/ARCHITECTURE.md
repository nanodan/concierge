# Architecture Guide

## System Overview

Claude Remote Chat is a three-tier PWA: a Node.js backend spawns Claude CLI processes, streams output over WebSocket to a vanilla JS frontend, and persists conversations as JSON files on disk.

```
┌─────────────┐     WebSocket      ┌──────────────┐     stdio      ┌───────────┐
│   Browser    │ ◄──────────────► │   server.js   │ ◄────────────► │ Claude CLI│
│  (app.js)   │     HTTP/REST      │  Express+WS   │   spawn/kill   │  Process  │
└─────────────┘                    └──────────────┘                 └───────────┘
                                         │
                                    JSON files
                                         │
                                   ┌─────┴─────┐
                                   │   data/    │
                                   │ index.json │
                                   │ conv/*.json│
                                   └───────────┘
```

## Backend (`server.js` + `lib/*.js`)

The backend is split into modules:
- `server.js` (~226 lines) — Entry point, Express/WS setup, WebSocket message handlers
- `lib/routes.js` (~364 lines) — REST API endpoints
- `lib/claude.js` (~240 lines) — Claude CLI process spawning and stream parsing
- `lib/data.js` (~170 lines) — Data storage, atomic writes, lazy loading

### Server Startup

1. Loads conversation metadata from `data/index.json` into a `Map<id, conversation>` (via `lib/data.js`)
2. Migrates legacy `data/conversations.json.bak` if present (one-time)
3. Starts Express for REST API + static file serving
4. Sets up REST routes via `setupRoutes()` from `lib/routes.js`
5. Starts WebSocket server on the same HTTP(S) server
6. Auto-detects `certs/key.pem` + `certs/cert.pem` for HTTPS

### Process Management

Each active conversation spawns one Claude CLI child process:

```
activeProcesses: Map<conversationId, ChildProcess>
```

**Spawning** (via `spawnClaude()`, triggered by `message`, `regenerate`, or `edit` events):
```
claude -p "{text}" --output-format stream-json --verbose \
  --model {model} --include-partial-messages \
  [--dangerously-skip-permissions] \
  [--resume {sessionId}] \
  [--add-dir {cwd}] \
  [--add-image {path}]  # for image attachments (repeatable)
```

**Lifecycle:**
- Process starts → server sends `status: "thinking"` to client
- stdout emits JSON lines → server parses and forwards as `delta` events
- Process exits → server sends `result` event with cost/duration/tokens, then `status: "idle"`
- Timeout: 5 minutes (`PROCESS_TIMEOUT`) per message

**Cancellation:**
- Client sends `{ type: "cancel" }` → server sends SIGTERM to process

### Stream Event Processing

Claude CLI outputs newline-delimited JSON. Two event types matter:

1. **`stream_event`** with nested `content_block_delta` → extract `text_delta.text` → send as `delta`
2. **`result`** → extract `costUSD`, `durationMs`, `sessionId`, token counts → send as `result`

A buffer handles partial JSON lines that span multiple stdout chunks.

### Data Storage

**Lazy Loading Pattern:**
- `data/index.json` holds lightweight metadata for all conversations (loaded at startup)
- `data/conv/{id}.json` holds full message arrays (loaded on demand via `ensureMessages()`)
- `data/uploads/{id}/` holds uploaded file attachments per conversation (cleaned up on delete)
- Messages are set to `null` after saving to allow garbage collection

**Atomic Writes:**
- All saves go through `atomicWrite(path, data)`: write to `.tmp`, then `rename()` to target
- Prevents corruption if the process crashes mid-write

**Conversation Metadata** (stored in index, always in memory):
```javascript
{
  id, name, cwd, claudeSessionId, status,
  archived, pinned, autopilot, model, createdAt,
  messageCount, lastMessage: { role, text, timestamp, cost, duration, sessionId }
}
```

**Messages** (stored per-conversation, lazy-loaded):
```javascript
// User message
{ role: 'user', text, timestamp, attachments: [{ filename, url }] }

// Assistant message
{ role: 'assistant', text, timestamp, cost, duration, sessionId, inputTokens, outputTokens }
```

### REST API

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/conversations` | List conversations. Query: `?archived=true` |
| `POST` | `/api/conversations` | Create conversation. Body: `{ name, cwd, autopilot, model }` |
| `GET` | `/api/conversations/:id` | Get conversation with messages |
| `PATCH` | `/api/conversations/:id` | Update fields (archive, name, model, autopilot, pinned) |
| `DELETE` | `/api/conversations/:id` | Delete conversation and message file |
| `GET` | `/api/conversations/search` | Search. Query: `?q=term&dateFrom=ISO&dateTo=ISO&model=id` |
| `GET` | `/api/models` | List available Claude models |
| `GET` | `/api/browse` | Directory listing. Query: `?path=/some/dir` |
| `POST` | `/api/mkdir` | Create directory. Body: `{ path }` |
| `GET` | `/api/stats` | Aggregate stats across all conversations (cached 30s) |
| `GET` | `/api/conversations/:id/export` | Export conversation. Query: `?format=markdown\|json` |
| `POST` | `/api/conversations/:id/upload` | Upload file attachment (raw body, `X-Filename` header) |
| `POST` | `/api/conversations/:id/fork` | Fork conversation from message index. Body: `{ fromMessageIndex }` |

### WebSocket Protocol

**Client → Server:**

| Type | Fields | Description |
|------|--------|-------------|
| `message` | `conversationId`, `text`, `attachments?` | Send user message, spawns Claude process |
| `cancel` | `conversationId` | Kill active process |
| `regenerate` | `conversationId` | Re-generate last assistant response (resets session) |
| `edit` | `conversationId`, `messageIndex`, `text` | Edit user message at index, truncate & re-send |

**Server → Client:**

| Type | Fields | Description |
|------|--------|-------------|
| `delta` | `conversationId`, `text` | Streaming text chunk |
| `result` | `conversationId`, `text`, `cost`, `duration`, `sessionId`, `inputTokens`, `outputTokens` | Final complete response |
| `status` | `conversationId`, `status` | `"thinking"` or `"idle"` |
| `error` | `conversationId`, `error` | Error message |
| `stderr` | `conversationId`, `text` | Claude CLI stderr output |
| `messages_updated` | `conversationId`, `messages` | Full message array after edit (triggers re-render) |

### Model Configuration

```javascript
MODELS = [
  { id: 'opus', name: 'Opus 4.6', context: 200000 },
  { id: 'claude-opus-4-20250514', name: 'Opus 4', context: 200000 },
  { id: 'sonnet', name: 'Sonnet 4.5', context: 200000 },
  { id: 'claude-sonnet-4-20250514', name: 'Sonnet 4', context: 200000 },
  { id: 'haiku', name: 'Haiku 4.5', context: 200000 }
]
```

---

## Frontend (`public/js/`)

The frontend is split into ES modules for maintainability:

```
public/js/
  app.js           - Entry point, module imports, initialization
  state.js         - Shared mutable state, getters/setters
  utils.js         - Helper functions (formatTime, haptic, toast, dialog)
  websocket.js     - WebSocket connection management
  render.js        - Message rendering, code blocks, TTS, reactions
  conversations.js - Conversation CRUD, list rendering, swipe/long-press
  ui.js            - UI interactions, event handlers, modals, theme, stats
  markdown.js      - Hand-rolled markdown parser
```

### State Management (`state.js`)

All state lives in a dedicated module with getters/setters (no framework, no store):

```javascript
// Exported state variables (via getters/setters)
conversations[]           // Conversation list from API
currentConversationId     // Active conversation UUID
ws                        // WebSocket connection (in websocket.js)
streamingMessageEl        // DOM element for in-progress message
streamingText             // Accumulated streaming text
pendingDelta              // Buffered streaming text (RAF-throttled)
renderScheduled           // Whether a RAF flush is pending
showingArchived           // Archive filter toggle
models[]                  // Available models from API
currentModel              // Selected model ID
currentAutopilot          // Autopilot toggle state
isRecording               // Voice recording state
currentTTSBtn             // Active TTS button reference
pendingAttachments[]      // Files queued for upload with next message
currentTheme              // 'auto' | 'light' | 'dark'
pendingMessages[]         // Messages queued while WS disconnected (localStorage-persisted)
allMessages[]             // Full messages array for virtual scroll
messagesOffset            // How many messages rendered from start
collapsedScopes{}         // Which cwd scope groups are collapsed (localStorage-persisted)
```

### Module Dependencies

```
app.js (entry)
  ├── utils.js (pure functions)
  ├── state.js (shared state)
  ├── websocket.js ──► state.js, render.js, conversations.js
  ├── render.js ──► state.js, utils.js, markdown.js
  ├── conversations.js ──► state.js, utils.js, render.js
  └── ui.js ──► state.js, utils.js, websocket.js, render.js, conversations.js
```

### Three Views

The app has three mutually exclusive views, transitioned via CSS transforms:

1. **List View** (`#list-view`) - Conversation browser grouped by working directory (scope), with search, archive toggle, FAB
2. **Chat View** (`#chat-view`) - Message list, input bar, header with controls
3. **Stats View** (`#stats-view`) - Analytics dashboard

View transitions use `slide-out` / `slide-in` CSS classes with `transform` + `opacity` animations (350ms cubic-bezier).

### Message Rendering Pipeline

Three phases handle different rendering needs:

1. **`renderMessages()`** - Full re-render when opening a conversation. Maps all messages to HTML, applies markdown, injects TTS/regenerate buttons, renders inline attachment thumbnails, attaches message action handlers (long-press/right-click for edit/copy).

2. **`appendDelta(text)`** - Called on each streaming chunk. Buffers text in `pendingDelta` and schedules a `requestAnimationFrame` flush via `flushDelta()`. This throttles DOM updates to once per frame, eliminating jank on fast streams.

3. **`flushDelta()`** - RAF callback that applies buffered `pendingDelta` to `streamingText`, re-renders markdown, and auto-scrolls.

4. **`finalizeMessage(data)`** - Called on `result` event. Flushes any pending delta, replaces streaming element with final rendered message including metadata (cost, duration, tokens), TTS button, and regenerate button.

### Markdown Renderer (`public/js/markdown.js`)

Hand-rolled parser (no library). Processing order matters:

1. Escape HTML entities
2. Extract code blocks to numbered placeholders (protects from regex)
3. Apply inline formatting: code spans, bold, italic
4. Apply block formatting: headers, horizontal rules, lists, links, paragraphs
5. Convert line breaks
6. Restore code blocks from placeholders
7. Clean malformed tags

Code blocks get syntax highlighting via highlight.js and a "Copy" button overlay.

### Touch Interactions

**Swipe-to-reveal** (conversation cards):
- Tracks touch start position and direction lock
- Translates card up to -144px to reveal action buttons
- Snaps open/closed based on 60px threshold
- Only one card open at a time (`activeSwipeCard`)

**Swipe-to-go-back** (chat view):
- Swipe from left edge (30px) to return to conversation list
- Visual feedback during swipe (translateX)
- 80px threshold triggers navigation

**Long-press** (conversation cards):
- 500ms timer triggers floating action popup
- Shows Pin/Archive/Rename/Delete options
- Positioned near the touch point

**Bulk selection mode**:
- "Select" button in header enters multi-select mode
- Tap cards to toggle selection
- Bulk action bar appears at bottom (Select All, Archive, Delete)
- Cancel exits selection mode

**Long-press / right-click** (message bubbles):
- 500ms timer triggers message action popup
- User messages: Edit and Copy options
- Assistant messages: Copy option
- Edit replaces bubble with inline textarea + Save/Cancel buttons

**Desktop fallback:**
- Right-click opens same context menu as long-press (both cards and messages)

### Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Cmd/Ctrl+K` | Focus search input |
| `Cmd/Ctrl+N` | New conversation |
| `Cmd/Ctrl+E` | Export conversation |
| `Cmd/Ctrl+Shift+A` | Toggle archived view |
| `Escape` | Go back / close modal |

### Voice Input

Uses the Web SpeechRecognition API:
- Continuous mode with interim results
- Preserves pre-existing textarea text
- Mic button hidden if API unavailable
- Red pulse animation while recording

### Text-to-Speech

Uses the Web SpeechSynthesis API:
- Speaker button on each assistant message
- Extracts plain text (strips HTML, metadata)
- Cancels any active speech before starting new
- Toggle icon: speaker (play) / stop square (playing)

### Context Bar

Shows token usage for the current conversation:
- Format: `{tokens} / {contextWindow}k`
- Visual progress bar with color thresholds:
  - Normal (< 75%): accent purple
  - Warning (75-90%): orange
  - Danger (> 90%): red with pulse animation

### Stats Dashboard

Fetches aggregated data from `/api/stats` and renders:
- Conversation/message counts
- Cost breakdown
- Character/word/page estimates
- Day streaks
- Daily activity bar chart (last 30 days)
- Hourly distribution bar chart
- Top 5 conversations by message count

---

## Service Worker (`public/sw.js`)

**Strategy:** Cache-first for static assets, network-first for selected API routes (offline support), skip other API calls.

**Cached assets:**
- `/`, `/index.html`, `/style.css`, `/manifest.json`, `/lib/highlight.min.js`
- All ES modules in `/js/`: `app.js`, `state.js`, `utils.js`, `websocket.js`, `render.js`, `conversations.js`, `ui.js`, `markdown.js`
- All CSS files in `/css/`: `base.css`, `layout.css`, `components.css`, `messages.css`, `list.css`
- All color themes: `themes/darjeeling.css`, `themes/claude.css`, `themes/nord.css`, `themes/budapest.css`

**Cached API routes (network-first):**
- `/api/conversations` — enables offline conversation list loading

**Cache versioning:** `claude-chat-v32` - increment the version number to bust caches on deploy.

**Lifecycle:**
1. `install` - Pre-cache all static assets
2. `activate` - Delete old cache versions, claim clients
3. `fetch` - Network-first for cacheable API routes (fall back to cache), cache-first for static assets, skip other API/WS

---

## HTML Structure (`public/index.html`)

### PWA Meta Tags
- `viewport-fit=cover` for notch-aware layout
- `apple-mobile-web-app-capable` for iOS home screen
- `black-translucent` status bar style

### DOM Structure
```
#list-view
  .top-bar (title, theme toggle, stats button, archive toggle)
  #search-bar (input + filter toggle)
  #filter-row (date chips, model dropdown) [collapsible]
  #conversation-list
  #fab (new conversation button)

#action-popup (long-press/right-click menu for conversation cards)
#msg-action-popup (long-press/right-click menu for messages)

#chat-view
  .top-bar (back, name, status dot, mode badge, model selector, export, delete)
  #context-bar
  #reconnect-banner (shown when WS disconnected)
  #messages (with #load-more-btn for virtual scroll)
  #typing-indicator
  #attachment-preview (queued file thumbnails)
  .input-bar (attach, mic, textarea, send/cancel)

#stats-view
  .top-bar (back, title)
  #stats-content

#new-conversation-modal
  (name, cwd browser, autopilot toggle, model select)

#dialog (custom alert/confirm/prompt replacement)
```

---

## CSS Architecture (`public/css/`)

CSS is split into modular files:

| File | Lines | Purpose |
|------|-------|---------|
| `base.css` | ~82 | CSS variables, resets, base animations |
| `layout.css` | ~620 | Page layout, headers, view transitions |
| `components.css` | ~1070 | Buttons, inputs, modals, toasts, toggles |
| `messages.css` | ~657 | Chat messages, code blocks, attachments |
| `list.css` | ~677 | Conversation list, cards, swipe, bulk selection |

### Color Themes (`public/css/themes/`)

Four swappable color themes (~210 lines each):
- **Darjeeling** (default) — Warm earth tones
- **Claude** — Purple accent with neutral grays
- **Nord** — Arctic blue palette
- **Budapest** — Grand Budapest Hotel inspired (plum/cream)

Themes are loaded via `<link id="color-theme-link">` and swapped dynamically.

### Design System

**Light/Dark Mode:** Each color theme defines both dark (`:root`) and light (`html[data-theme="light"]`) variants. Mode cycles: auto → light → dark.

**CSS Variables:** Each theme defines:
| Variable | Usage |
|----------|-------|
| `--bg`, `--bg-secondary`, `--bg-tertiary` | Background hierarchy |
| `--surface` | Elevated elements |
| `--text`, `--text-secondary` | Text colors |
| `--accent`, `--accent-light` | Brand/interactive color |
| `--user-bubble`, `--user-bubble-end` | User message gradient |
| `--danger`, `--warning`, `--success` | Semantic colors |

**Glass-morphism:** Headers, input bars, and modals use `backdrop-filter: blur(20px) saturate(1.4)` with semi-transparent backgrounds.

**Safe areas:** iOS notch and home indicator insets applied via `env(safe-area-inset-*)` CSS variables stored as `--safe-top` / `--safe-bottom`.

### Key Animations

| Animation | Usage |
|-----------|-------|
| `loading-bar` | View transition progress indicator |
| Typing dots | Alternating opacity/scale on 3 dots |
| Status pulse | Breathing effect on thinking indicator |
| Mic pulse | Expanding rings while recording |
| Button press | `scale(0.92)` on `:active` |

### Message Styles

- **User messages**: Right-aligned, gradient purple background (`--accent` to `--accent-light`), white text, rounded corners (top-right square)
- **Assistant messages**: Left-aligned, dark background with border, full markdown rendering, rounded corners (top-left square)
