# Developer Quick Reference

Fast-access reference for coding in this repository. Consult this before reading source files.

---

## File Map with Key Line Ranges

### `server.js` (~654 lines)

| Lines | Section |
|-------|---------|
| 1-20 | Imports, constants, `MODELS` array |
| 22-47 | HTTPS cert detection, Express setup, static serving |
| 49-53 | `atomicWrite(filePath, data)` - safe file writes |
| 55-145 | `loadConversations()`, `saveIndex()`, `saveMessages()`, legacy migration |
| 147-154 | `ensureMessages(id)` - lazy message loading |
| 156-158 | `activeProcesses` Map, `PROCESS_TIMEOUT` (5min) |
| 160-210 | REST: `POST /api/conversations` (create) |
| 212-260 | REST: `GET /api/conversations` (list), `GET :id` (detail) |
| 262-300 | REST: `PATCH :id` (update), `DELETE :id` (delete) |
| 302-370 | REST: `GET /api/conversations/search`, `GET /api/stats` |
| 372-418 | REST: `GET /api/models`, `GET /api/browse`, `POST /api/mkdir` |
| 420-430 | WebSocket: `cancel` handler |
| 431-561 | WebSocket: `message` handler (spawns Claude CLI) |
| 563-631 | `processStreamEvent()` - parses Claude JSON output |
| 633-654 | Server listen, shutdown handler |

### `public/app.js` (~1254 lines)

| Lines | Section |
|-------|---------|
| 1-25 | DOM element references |
| 26-90 | Global state variables |
| 92-170 | `connectWS()`, WebSocket event handlers |
| 172-240 | `loadConversations()`, `renderConversationList()` |
| 242-328 | `openConversation()`, `showListView()`, view transitions |
| 329-399 | Swipe gesture handling (touch events) |
| 401-464 | Long-press / right-click context menu |
| 466-478 | Search (debounced, 250ms) |
| 480-520 | `sendMessage()`, `cancelMessage()` |
| 522-548 | `renderMessages()` - full message rendering |
| 550-610 | `appendDelta()` - streaming chunk rendering |
| 612-670 | `finalizeMessage()` - complete message rendering |
| 672-720 | New conversation modal handlers |
| 722-780 | Dialog system (custom alert/confirm/prompt) |
| 782-818 | Archive, rename, delete conversation actions |
| 819-894 | Directory browser modal |
| 896-975 | Voice input (SpeechRecognition) |
| 977-1031 | Text-to-speech (SpeechSynthesis) |
| 1033-1050 | Model selection dropdown |
| 1051-1066 | Context bar (token usage display) |
| 1068-1117 | Model switching, autopilot toggle |
| 1119-1244 | Stats page rendering |
| 1246-1254 | Initialization: `connectWS()`, `loadModels()`, `loadConversations()`, SW registration |

### `public/markdown.js` (~66 lines)

| Lines | Section |
|-------|---------|
| 1-5 | `escapeHtml()` helper |
| 7-66 | `renderMarkdown(text)` - full parser |

### `public/style.css` (~1715 lines)

| Lines | Section |
|-------|---------|
| 1-30 | CSS variables (`:root` theme) |
| 32-70 | Base styles, animations (`loading-bar`) |
| 72-160 | Top bar, status indicators |
| 162-300 | Conversation list, cards, swipe actions |
| 302-520 | Chat view, messages (user/assistant), typing indicator |
| 522-600 | Input bar, mic button, recording animation |
| 602-700 | Code blocks, copy button, syntax highlighting |
| 702-900 | Modals, dialog, folder browser |
| 902-1000 | Model selector, context bar |
| 1002-1100 | Stats page, stat cards, charts |
| 1102-1200 | Action popup, search bar |
| 1202-1280 | View transitions (slide-out, slide-in) |
| 1282-1715 | highlight.js theme, misc utilities, safe area padding |

### `public/sw.js` (~53 lines)

| Lines | Section |
|-------|---------|
| 1-10 | Cache name, static asset list |
| 13-18 | Install event (pre-cache) |
| 21-28 | Activate event (clean old caches) |
| 31-52 | Fetch event (cache-first, skip API/WS) |

### `public/index.html` (~157 lines)

| Lines | Section |
|-------|---------|
| 1-16 | Head: meta tags, PWA config, CSS |
| 17-34 | List view DOM |
| 36-42 | Action popup |
| 45-82 | Chat view DOM |
| 84-91 | Stats view DOM |
| 95-138 | New conversation modal |
| 140-151 | Dialog system |
| 153-157 | Script tags |

---

## Data Models

### Conversation (in-memory & index.json)

```javascript
{
  id: string,              // UUID v4
  name: string,            // User-given name
  cwd: string,             // Working directory for Claude CLI
  claudeSessionId: string, // Claude CLI session ID (set after first response)
  messages: Message[],     // null when not loaded (lazy)
  status: 'idle' | 'thinking',
  archived: boolean,
  autopilot: boolean,      // --dangerously-skip-permissions
  model: string,           // Model ID from MODELS array
  createdAt: number,       // Unix timestamp (ms)
  messageCount: number,    // Cached count for list display
  lastMessage: {           // Cached for list preview
    role, text, timestamp, cost, duration, sessionId
  }
}
```

### User Message

```javascript
{ role: 'user', text: string, timestamp: number }
```

### Assistant Message

```javascript
{
  role: 'assistant',
  text: string,
  timestamp: number,
  cost: number,           // USD
  duration: number,       // ms
  sessionId: string,      // Claude CLI session ID
  inputTokens: number,
  outputTokens: number
}
```

---

## Common Modification Patterns

### Adding a new REST endpoint

1. Add route in `server.js` after existing routes (before WebSocket setup ~line 420)
2. Access conversation data via `conversations` Map
3. Call `ensureMessages(id)` before accessing `.messages`
4. Call `saveIndex()` after metadata changes, `saveMessages(id)` after message changes

### Adding a new WebSocket event type

1. **Server → Client**: Add to the `ws.on('message')` handler in `server.js` ~line 431. Send via `ws.send(JSON.stringify({ type: 'newtype', ... }))`
2. **Client handler**: Add case to `ws.onmessage` handler in `app.js` ~line 110

### Adding a new UI feature to chat view

1. Add DOM elements to `#chat-view` in `index.html`
2. Add styling in `style.css` (chat view section ~line 302)
3. Add JS logic in `app.js` - reference element at top (~line 1-25), add handlers
4. If it needs data from server, add a REST endpoint or WebSocket event

### Adding a conversation property

1. Add to creation in `POST /api/conversations` in `server.js` ~line 199
2. Add to `PATCH` handler in `server.js` ~line 270
3. Add UI control in the new conversation modal (`index.html` ~line 95)
4. Add to `openConversation()` in `app.js` ~line 242 to restore state
5. Pass to Claude CLI args if needed in the WebSocket `message` handler ~line 471

### Modifying the markdown renderer

Edit `public/markdown.js`. The order of regex operations matters:
1. Code blocks extracted first (protected from all other transforms)
2. Inline code next
3. Bold before italic (both use asterisks)
4. Block elements (headers, lists, etc.)
5. Code blocks restored last

### Updating the service worker cache

Increment the version number in `CACHE_NAME` in `public/sw.js` (currently `claude-chat-v10`). Add new static assets to the `STATIC_ASSETS` array.

---

## Key Functions Reference

### Backend (`server.js`)

| Function | Purpose |
|----------|---------|
| `atomicWrite(path, data)` | Write JSON safely (tmp + rename) |
| `loadConversations()` | Load index.json into memory Map |
| `saveIndex()` | Persist metadata to index.json |
| `saveMessages(id)` | Persist messages to conv/{id}.json |
| `ensureMessages(id)` | Lazy-load messages from disk |

### Frontend (`app.js`)

| Function | Purpose |
|----------|---------|
| `connectWS()` | Establish/reconnect WebSocket |
| `loadConversations()` | Fetch + render conversation list |
| `renderConversationList()` | Build conversation card DOM |
| `openConversation(id)` | Load + display conversation |
| `showListView()` | Return to conversation list |
| `sendMessage()` | Send user message via WebSocket |
| `cancelMessage()` | Cancel active Claude process |
| `renderMessages()` | Full re-render of all messages |
| `appendDelta(id, text)` | Append streaming text chunk |
| `finalizeMessage(id, data)` | Complete streaming message |
| `renderMarkdown(text)` | Convert markdown to HTML |
| `showDialog(opts)` | Show custom dialog (alert/confirm/prompt) |
| `updateContextBar(conv)` | Update token usage display |
| `showStats()` | Render stats dashboard |

---

## CSS Class Conventions

| Class | Usage |
|-------|-------|
| `.message.user` | User message bubble (right-aligned, purple) |
| `.message.assistant` | Assistant message bubble (left-aligned, dark) |
| `.message.streaming` | Message currently being streamed |
| `.conversation-card` | Conversation list item |
| `.swipe-content` | Swipeable inner content of card |
| `.swipe-actions` | Hidden action buttons behind card |
| `.slide-out` | List view exiting (dims + shifts left) |
| `.slide-in` | Chat/stats view entering (slides from right) |
| `.recording` | Mic button while recording (red pulse) |
| `.speaking` | TTS button while playing |
| `.glass-bg` | Glass-morphism background effect |

---

## Claude CLI Integration

The server spawns `claude` as a child process with these args:

```bash
claude \
  -p "{user_message}" \
  --output-format stream-json \
  --verbose \
  --model {model_id} \
  --include-partial-messages \
  [--dangerously-skip-permissions]  # if autopilot=true
  [--resume {sessionId}]            # if continuing conversation
  [--add-dir {cwd}]                 # working directory
```

The `stream-json` format outputs newline-delimited JSON objects. Key event types:

- `{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"..."}}}` - Text chunk
- `{"type":"result","costUSD":0.01,"durationMs":5000,"sessionId":"...","inputTokens":100,"outputTokens":500}` - Final result

Session IDs enable conversation continuity: once a `sessionId` is received from a `result`, it's stored and passed via `--resume` on subsequent messages.
