# Developer Quick Reference

Fast-access reference for coding in this repository. Consult this before reading source files.

---

## File Map with Key Line Ranges

### `server.js` (~839 lines)

| Lines | Section |
|-------|---------|
| 1-20 | Imports, constants, `MODELS` array |
| 22-47 | HTTPS cert detection, Express setup, static serving (incl. uploads) |
| 49-53 | `atomicWrite(filePath, data)` - safe file writes |
| 55-145 | `loadConversations()`, `saveIndex()`, `saveMessages()`, legacy migration |
| 147-154 | `ensureMessages(id)` - lazy message loading |
| 156-158 | `activeProcesses` Map, `PROCESS_TIMEOUT` (5min) |
| 160-210 | REST: `POST /api/conversations` (create) |
| 212-260 | REST: `GET /api/conversations` (list), `GET :id` (detail) |
| 262-300 | REST: `PATCH :id` (update), `DELETE :id` (delete + upload cleanup) |
| 302-393 | REST: `GET /api/conversations/search`, `GET /api/stats` (cached, 30s TTL) |
| 395-460 | REST: `GET /api/conversations/:id/export`, `POST /api/conversations/:id/upload` |
| 462-480 | REST: `GET /api/models`, `GET /api/browse`, `POST /api/mkdir` |
| 482-536 | WebSocket: `cancel`, `message`, `regenerate`, `edit` handlers (dispatcher) |
| 538-614 | `handleRegenerate()`, `handleEdit()` - message mutation + re-send |
| 615-690 | `spawnClaude()` - spawns Claude CLI, streams output |
| 692-780 | `processStreamEvent()` - parses Claude JSON output |
| 782-825 | Server listen, shutdown handler |

### `public/app.js` (~1954 lines)

| Lines | Section |
|-------|---------|
| 1-25 | DOM element references (incl. export, attach, file input, attachment preview, msg action popup, reconnect banner, theme toggle, filter elements, load-more) |
| 26-125 | Global state variables (incl. streaming throttle, reconnect, attachments, theme, message queue, virtual scroll) |
| 127-195 | `connectWS()`, WebSocket event handlers (incl. `messages_updated`, reconnect banner, message queue flush) |
| 187-260 | `loadConversations()`, `renderConversationList()` |
| 262-348 | `openConversation()`, `showListView()`, view transitions |
| 349-420 | Swipe gesture handling (touch events) |
| 421-485 | Long-press / right-click context menu (conversation cards) |
| 486-500 | Search (debounced, 250ms) |
| 500-560 | `sendMessage()` (async, uploads attachments first), `cancelMessage()` |
| 562-580 | `setThinking()`, `scrollToBottom()`, `isNearBottom()` |
| 640-700 | `renderMessages()` - full message rendering (with attachments, regen btn, message actions) |
| 700-760 | `appendDelta()` (RAF-throttled), `flushDelta()`, `finalizeMessage()` |
| 762-820 | New conversation modal handlers |
| 822-870 | Dialog system (custom alert/confirm/prompt) |
| 870-930 | Archive, rename, delete conversation actions |
| 930-966 | Message actions: `attachMessageActions()` (long-press/right-click on messages) |
| 968-1000 | `showMsgActionPopup()`, `hideMsgActionPopup()` |
| 1003-1043 | `startEditMessage()` - inline message editing |
| 1045-1073 | `attachRegenHandlers()`, `regenerateMessage()`, export button |
| 1075-1120 | Toast notifications, `showToast()` |
| 1120-1200 | Directory browser modal |
| 1200-1280 | Voice input (SpeechRecognition) |
| 1280-1340 | Text-to-speech (SpeechSynthesis) |
| 1340-1360 | Model selection dropdown |
| 1360-1380 | Context bar (token usage display) |
| 1380-1430 | Model switching, autopilot toggle |
| 1430-1560 | Stats page rendering |
| 1560-1610 | Attachment handling: `addAttachment()`, `removeAttachment()`, `clearPendingAttachments()`, `renderAttachmentPreviewUI()` |
| 1610-1720 | Attachment handling, paste handler |
| 1720-1810 | Theme system: `applyTheme()`, `cycleTheme()`, OS media query listener |
| 1810-1860 | Keyboard shortcuts: global `keydown` handler |
| 1860-1920 | Search filters: `getSearchFilters()`, `triggerSearch()`, filter row handlers |
| 1920-1954 | Load-more / virtual scroll, IntersectionObserver, init |

### `public/markdown.js` (~66 lines)

| Lines | Section |
|-------|---------|
| 1-5 | `escapeHtml()` helper |
| 7-66 | `renderMarkdown(text)` - full parser |

### `public/style.css` (~2268 lines)

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
| 1282-1860 | highlight.js theme, misc utilities, safe area padding |
| 1861-1920 | Export button, attach button |
| 1921-2000 | Attachment preview, attachment items, message attachments |
| 2001-2040 | Regenerate button, message editing (textarea, actions) |
| 2041-2170 | Light mode: `[data-theme="light"]` overrides, syntax highlighting, media query |
| 2171-2268 | Theme toggle, reconnect banner, queued messages, filter bar, filter chips, load-more button |

### `public/sw.js` (~52 lines)

| Lines | Section |
|-------|---------|
| 1-10 | Cache name (`claude-chat-v12`), static asset list |
| 13-18 | Install event (pre-cache) |
| 21-28 | Activate event (clean old caches) |
| 31-52 | Fetch event (cache-first, skip API/WS) |

### `public/index.html` (~191 lines)

| Lines | Section |
|-------|---------|
| 1-16 | Head: meta tags, PWA config, CSS |
| 17-37 | List view DOM |
| 39-48 | Action popup (conversations + messages) |
| 50-101 | Chat view DOM (incl. export btn, attachment preview, attach btn, file input) |
| 103-110 | Stats view DOM |
| 116-158 | New conversation modal |
| 160-171 | Dialog system |
| 173-177 | Script tags |

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
{
  role: 'user',
  text: string,
  timestamp: number,
  attachments: [{ filename, url }]  // optional, present if files attached
}
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

1. Add route in `server.js` after existing routes (before WebSocket setup ~line 482)
2. Access conversation data via `conversations` Map
3. Call `ensureMessages(id)` before accessing `.messages`
4. Call `saveIndex()` after metadata changes, `saveMessages(id)` after message changes

### Adding a new WebSocket event type

1. **Server → Client**: Add to the WS dispatcher in `server.js` ~line 482. Send via `ws.send(JSON.stringify({ type: 'newtype', ... }))`
2. **Client handler**: Add case to `ws.onmessage` handler in `app.js` ~line 130

### Adding a new UI feature to chat view

1. Add DOM elements to `#chat-view` in `index.html`
2. Add styling in `style.css` (chat view section ~line 302)
3. Add JS logic in `app.js` - reference element at top (~line 1-25), add handlers
4. If it needs data from server, add a REST endpoint or WebSocket event

### Adding a conversation property

1. Add to creation in `POST /api/conversations` in `server.js` ~line 199
2. Add to `PATCH` handler in `server.js` ~line 270
3. Add UI control in the new conversation modal (`index.html` ~line 116)
4. Add to `openConversation()` in `app.js` ~line 262 to restore state
5. Pass to Claude CLI args if needed in `spawnClaude()` ~line 615

### Modifying the markdown renderer

Edit `public/markdown.js`. The order of regex operations matters:
1. Code blocks extracted first (protected from all other transforms)
2. Inline code next
3. Bold before italic (both use asterisks)
4. Block elements (headers, lists, etc.)
5. Code blocks restored last

### Updating the service worker cache

Increment the version number in `CACHE_NAME` in `public/sw.js` (currently `claude-chat-v12`). Add new static assets to the `STATIC_ASSETS` array.

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
| `spawnClaude(ws, convId, conv, text, attachments)` | Spawn Claude CLI process with streaming |
| `handleRegenerate(ws, msg)` | Pop last assistant msg, re-send last user msg |
| `handleEdit(ws, msg)` | Update message at index, truncate, re-send |

### Frontend (`app.js`)

| Function | Purpose |
|----------|---------|
| `connectWS()` | Establish/reconnect WebSocket (exponential backoff) |
| `loadConversations()` | Fetch + render conversation list |
| `renderConversationList()` | Build conversation card DOM |
| `openConversation(id)` | Load + display conversation |
| `showListView()` | Return to conversation list |
| `sendMessage()` | Send user message (async, handles uploads) |
| `cancelMessage()` | Cancel active Claude process |
| `renderMessages()` | Full re-render of all messages |
| `appendDelta(text)` | Buffer streaming text (RAF-throttled) |
| `flushDelta()` | Apply buffered streaming text to DOM |
| `finalizeMessage(data)` | Complete streaming message |
| `renderMarkdown(text)` | Convert markdown to HTML |
| `showDialog(opts)` | Show custom dialog (alert/confirm/prompt) |
| `updateContextBar(conv)` | Update token usage display |
| `showStats()` | Render stats dashboard |
| `addAttachment(file)` | Queue file for upload |
| `renderAttachmentPreviewUI()` | Render attachment thumbnails above input |
| `attachMessageActions()` | Add long-press/right-click to message bubbles |
| `startEditMessage(el, index)` | Inline edit a user message |
| `regenerateMessage()` | Re-generate last assistant response |
| `applyTheme()` | Apply current theme (auto/light/dark) to DOM |
| `loadMoreMessages()` | Prepend older messages (virtual scroll) |
| `triggerSearch()` | Run search with current query + filters |

---

## CSS Class Conventions

| Class | Usage |
|-------|-------|
| `.message.user` | User message bubble (right-aligned, purple) |
| `.message.assistant` | Assistant message bubble (left-aligned, dark) |
| `.message.editing` | Message being inline-edited |
| `.conversation-card` | Conversation list item |
| `.swipe-content` | Swipeable inner content of card |
| `.swipe-actions` | Hidden action buttons behind card |
| `.slide-out` | List view exiting (dims + shifts left) |
| `.slide-in` | Chat/stats view entering (slides from right) |
| `.recording` | Mic button while recording (red pulse) |
| `.speaking` | TTS button while playing |
| `.glass-bg` | Glass-morphism background effect |
| `.regen-btn` | Regenerate button on last assistant message |
| `.attachment-preview` | Queued attachment thumbnails above input |
| `.msg-attachments` | Inline attachments in rendered messages |
| `.export-btn` | Export button in chat header |
| `.attach-btn` | Attach file button in input bar |
| `.theme-toggle` | Theme cycle button (auto/light/dark) |
| `.reconnect-banner` | WS disconnected warning banner |
| `.filter-row` | Collapsible search filter chips |
| `.filter-chip` | Date range filter pill |
| `.load-more-btn` | Load earlier messages button |
| `.queued` | Message queued while offline |

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
  [--add-image {path}]              # for image attachments (repeatable)
```

The `stream-json` format outputs newline-delimited JSON objects. Key event types:

- `{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"..."}}}` - Text chunk
- `{"type":"result","costUSD":0.01,"durationMs":5000,"sessionId":"...","inputTokens":100,"outputTokens":500}` - Final result

Session IDs enable conversation continuity: once a `sessionId` is received from a `result`, it's stored and passed via `--resume` on subsequent messages. When editing or regenerating, `claudeSessionId` is reset to `null` to start a fresh session.
