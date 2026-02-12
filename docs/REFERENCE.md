# Developer Quick Reference

Fast-access reference for coding in this repository. Consult this before reading source files.

---

## File Map with Key Line Ranges

### `server.js` (~868 lines)

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
| 262-300 | REST: `PATCH :id` (update) |
| 302-393 | REST: `GET /api/conversations/search`, `GET /api/stats` (cached, 30s TTL) |
| 395-460 | REST: `GET /api/conversations/:id/export`, `POST /api/conversations/:id/upload` |
| 464-490 | REST: `POST /api/conversations/:id/fork` - fork conversation from message index |
| 492-504 | REST: `DELETE :id` (delete + upload cleanup) |
| 506-510 | REST: `GET /api/models`, `GET /api/browse`, `POST /api/mkdir` |
| 512-566 | WebSocket: `cancel`, `message`, `regenerate`, `edit` handlers (dispatcher) |
| 568-644 | `handleRegenerate()`, `handleEdit()` - message mutation + re-send |
| 645-720 | `spawnClaude()` - spawns Claude CLI, streams output |
| 722-810 | `processStreamEvent()` - parses Claude JSON output |
| 812-855 | Server listen, shutdown handler |

### Frontend ES Modules (`public/js/`)

The frontend is split into ES modules. Entry point is `public/js/app.js`.

#### `public/js/app.js` (~222 lines) - Main entry point

| Lines | Section |
|-------|---------|
| 1-7 | Module imports |
| 9-80 | DOM element references |
| 82-100 | Module initialization (toast, dialog, state, WS) |
| 102-160 | Module initialization (conversations, UI) |
| 162-180 | Action popup and event listener setup |
| 182-200 | `loadModels()` - fetch available models |
| 202-222 | Init: connectWS, loadModels, loadConversations, service worker |

#### `public/js/state.js` (~433 lines) - Shared state

| Lines | Section |
|-------|---------|
| 1-60 | State variable declarations (conversations, models, streaming, UI) |
| 62-200 | State getters and setters |
| 202-300 | More state functions (pending messages, reactions, attachments) |
| 302-433 | Status/thinking state, DOM element management, scrollToBottom |

#### `public/js/utils.js` (~142 lines) - Helper functions

| Lines | Section |
|-------|---------|
| 1-35 | `haptic()`, `formatTime()`, `formatTokens()`, `truncate()`, `setLoading()` |
| 37-60 | Toast system: `initToast()`, `showToast()` |
| 62-142 | Dialog system: `initDialog()`, `showDialog()`, dialog helpers |

#### `public/js/websocket.js` (~108 lines) - WebSocket management

| Lines | Section |
|-------|---------|
| 1-20 | Imports, state variables, initialization |
| 22-60 | `connectWS()` - establish connection, handle reconnect |
| 62-108 | `handleWSMessage()` - dispatch incoming events |

#### `public/js/render.js` (~423 lines) - Rendering functions

| Lines | Section |
|-------|---------|
| 1-50 | `CLAUDE_AVATAR_SVG`, `enhanceCodeBlocks()` |
| 52-80 | `renderMessages()` - full message render |
| 82-130 | `renderMessageSlice()` - render message subset |
| 132-155 | `loadMoreMessages()` - virtual scroll |
| 157-210 | `appendDelta()`, `flushDelta()` - streaming render |
| 212-260 | `finalizeMessage()` - complete streaming |
| 262-320 | Reactions: `renderAllReactions()`, `renderReactionsForMessage()`, `toggleReaction()` |
| 322-380 | TTS: `attachTTSHandlers()`, `toggleTTS()`, `resetTTSBtn()` |
| 382-423 | `attachRegenHandlers()`, `attachMessageActions()` callback |

#### `public/js/conversations.js` (~534 lines) - Conversation management

| Lines | Section |
|-------|---------|
| 1-30 | Imports, DOM element references, initialization |
| 32-80 | `loadConversations()`, `getConversation()` |
| 82-150 | `createConversation()`, `deleteConversation()`, `archiveConversation()`, `renameConversation()` |
| 152-190 | `forkConversation()`, `searchConversations()` |
| 192-300 | `renderConversationList()` - render cards, scope grouping |
| 302-360 | `setupSwipe()`, `resetSwipe()` - swipe gesture handling |
| 362-410 | `setupLongPress()`, `showActionPopup()`, `hideActionPopup()` |
| 412-480 | `setupActionPopupHandlers()`, search filters |
| 482-534 | `openConversation()`, `showChatView()`, `showListView()` |

#### `public/js/ui.js` (~1085 lines) - UI interactions

| Lines | Section |
|-------|---------|
| 1-70 | Imports, DOM element references |
| 72-120 | `initUI()` - element initialization |
| 122-200 | `sendMessage()` - send with attachments |
| 202-250 | `renderAttachmentPreview()`, `attachMessageActions()` |
| 252-340 | `showMsgActionPopup()`, `hideMsgActionPopup()`, `startEditMessage()` |
| 342-380 | `regenerateMessage()`, model/mode badges |
| 382-430 | `updateContextBar()`, `switchModel()` |
| 432-500 | Directory browser: `browseTo()` |
| 502-560 | Voice input: `startRecording()`, `stopRecording()` |
| 562-620 | Theme: `applyTheme()`, `cycleTheme()`, `updateThemeIcon()` |
| 622-750 | Stats: `loadStats()`, `renderStats()` |
| 752-780 | `populateFilterModels()` |
| 782-1085 | `setupEventListeners()` - all event handlers |

#### `public/js/markdown.js` (~66 lines) - Markdown parser

| Lines | Section |
|-------|---------|
| 1-10 | `escapeHtml()` helper |
| 12-66 | `renderMarkdown(text)` - full parser |

### `public/markdown.js` (~66 lines)

| Lines | Section |
|-------|---------|
| 1-5 | `escapeHtml()` helper |
| 7-66 | `renderMarkdown(text)` - full parser |

### `public/style.css` (~2327 lines)

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
| 2171-2270 | Theme toggle, reconnect banner, queued messages, filter bar, filter chips, load-more button |
| 2271-2327 | Scope grouping: headers, chevrons, counts, collapsible items |

### `public/sw.js` (~78 lines)

| Lines | Section |
|-------|---------|
| 1-21 | Cache name (`claude-chat-v15`), static asset list (including all JS modules), cached API routes |
| 23-28 | Install event (pre-cache) |
| 30-37 | Activate event (clean old caches) |
| 39-78 | Fetch event (cache-first for static, network-first for cacheable API, skip other API/WS) |

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
2. **Client handler**: Add case to `handleWSMessage()` in `public/js/websocket.js`

### Adding a new UI feature to chat view

1. Add DOM elements to `#chat-view` in `index.html`
2. Add styling in `style.css` (chat view section ~line 302)
3. Add DOM reference in `public/js/app.js`, pass to `initUI()`
4. Add handler logic in `public/js/ui.js` - either in `initUI()` or `setupEventListeners()`
5. If it needs shared state, add to `public/js/state.js`
6. If it needs data from server, add a REST endpoint or WebSocket event

### Adding a conversation property

1. Add to creation in `POST /api/conversations` in `server.js` ~line 199
2. Add to `PATCH` handler in `server.js` ~line 270
3. Add UI control in the new conversation modal (`index.html` ~line 116)
4. Add state variable in `public/js/state.js` if needed
5. Add to `openConversation()` in `public/js/conversations.js` to restore state
6. Pass to Claude CLI args if needed in `spawnClaude()` ~line 615

### Modifying the markdown renderer

Edit `public/js/markdown.js`. The order of regex operations matters:
1. Code blocks extracted first (protected from all other transforms)
2. Inline code next
3. Bold before italic (both use asterisks)
4. Block elements (headers, lists, etc.)
5. Code blocks restored last

### Updating the service worker cache

Increment the version number in `CACHE_NAME` in `public/sw.js` (currently `claude-chat-v15`). Add new static assets to the `STATIC_ASSETS` array. All JS modules in `public/js/` should be listed.

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

### Frontend (ES Modules in `public/js/`)

#### `utils.js`

| Function | Purpose |
|----------|---------|
| `haptic(ms)` | Trigger vibration feedback |
| `formatTime(ts)` | Format timestamp for display |
| `formatTokens(count)` | Format token count (e.g., "10.5k") |
| `showToast(message, opts)` | Show toast notification |
| `showDialog(opts)` | Show custom dialog (alert/confirm/prompt) |

#### `websocket.js`

| Function | Purpose |
|----------|---------|
| `connectWS()` | Establish/reconnect WebSocket (exponential backoff) |
| `getWS()` | Get current WebSocket instance |

#### `render.js`

| Function | Purpose |
|----------|---------|
| `renderMessages(messages)` | Full re-render of all messages |
| `renderMessageSlice(messages, startIndex)` | Render subset of messages |
| `appendDelta(text)` | Buffer streaming text (RAF-throttled) |
| `flushDelta()` | Apply buffered streaming text to DOM |
| `finalizeMessage(data)` | Complete streaming message |
| `enhanceCodeBlocks(container)` | Add copy buttons, syntax highlighting |
| `attachTTSHandlers()` | Add TTS button handlers |
| `attachRegenHandlers()` | Add regenerate button handlers |
| `loadMoreMessages()` | Prepend older messages (virtual scroll) |

#### `conversations.js`

| Function | Purpose |
|----------|---------|
| `loadConversations()` | Fetch + render conversation list |
| `renderConversationList(items)` | Build conversation card DOM (grouped by cwd scope) |
| `openConversation(id)` | Load + display conversation |
| `showListView()` | Return to conversation list |
| `forkConversation(fromMessageIndex)` | Fork conversation from a message |
| `triggerSearch()` | Run search with current query + filters |

#### `ui.js`

| Function | Purpose |
|----------|---------|
| `sendMessage(text)` | Send user message (async, handles uploads) |
| `regenerateMessage()` | Re-generate last assistant response |
| `updateContextBar(inputTokens, outputTokens, modelId)` | Update token usage display |
| `renderAttachmentPreview()` | Render attachment thumbnails above input |
| `attachMessageActions()` | Add long-press/right-click to message bubbles |
| `startEditMessage(el, index)` | Inline edit a user message |
| `setupEventListeners(createConversation)` | Initialize all event handlers |

#### `state.js`

| Function | Purpose |
|----------|---------|
| `setThinking(thinking)` | Update thinking state and UI |
| `scrollToBottom(force)` | Scroll messages to bottom |
| `addPendingMessage(msg)` | Persist offline message to localStorage |
| `resetStreamingState()` | Reset all streaming-related state |

#### `markdown.js`

| Function | Purpose |
|----------|---------|
| `escapeHtml(text)` | Escape HTML special characters |
| `renderMarkdown(text)` | Convert markdown to HTML |

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
| `.scope-group` | Conversation group by working directory |
| `.scope-header` | Collapsible scope section header |
| `.scope-items` | Container for cards within a scope group |

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

Session IDs enable conversation continuity: once a `sessionId` is received from a `result`, it's stored and passed via `--resume` on subsequent messages. When editing or regenerating, `claudeSessionId` is reset to `null` to start a fresh session.
