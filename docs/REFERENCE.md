# Developer Quick Reference

Fast-access reference for coding in this repository. Consult this before reading source files.

---

## File Map with Key Line Ranges

### Backend

#### `server.js` (~226 lines)

| Lines | Section |
|-------|---------|
| 1-25 | Imports, HTTPS cert detection, Express setup |
| 27-48 | Static serving, routes setup |
| 50-95 | WebSocket handlers: `handleMessage`, `handleCancel` |
| 97-160 | `handleRegenerate()`, `handleEdit()` |
| 162-210 | `broadcastStatus()`, server startup |

#### `lib/routes.js` (~364 lines)

| Lines | Section |
|-------|---------|
| 1-25 | Imports from data.js and claude.js |
| 27-55 | `GET/POST /api/conversations` |
| 57-100 | `GET /api/conversations` (list with pinned sorting) |
| 102-160 | `GET /api/conversations/search` |
| 162-175 | `PATCH /api/conversations/:id` (archive, name, model, autopilot, pinned) |
| 177-260 | `GET /api/stats` (cached 30s) |
| 262-310 | `GET /api/conversations/:id/export`, `POST /api/conversations/:id/upload` |
| 312-360 | `POST /api/conversations/:id/fork`, `DELETE /api/conversations/:id` |

#### `lib/claude.js` (~240 lines)

| Lines | Section |
|-------|---------|
| 1-20 | Imports, `MODELS` array, constants |
| 22-100 | `spawnClaude()` - spawn CLI, stream handling |
| 102-200 | `processStreamEvent()` - parse Claude JSON output |
| 202-240 | `cancelProcess()`, `hasActiveProcess()` |

#### `lib/data.js` (~170 lines)

| Lines | Section |
|-------|---------|
| 1-30 | Constants, paths, conversations Map |
| 32-50 | `convMeta()` - extract metadata (incl. pinned) |
| 52-80 | `saveIndex()`, `saveConversation()` |
| 82-130 | `loadMessages()`, `loadFromDisk()`, migration |
| 132-170 | `ensureMessages()`, stats cache helpers |

### Frontend ES Modules (`public/js/`)

The frontend is split into ES modules. Entry point is `public/js/app.js`.

#### `public/js/app.js` (~266 lines) - Main entry point

| Lines | Section |
|-------|---------|
| 1-25 | Module imports |
| 27-100 | DOM element references |
| 102-150 | Module initialization (toast, dialog, state, WS, conversations, UI) |
| 152-210 | Action popup and event listener setup |
| 212-235 | `loadModels()` - fetch available models |
| 237-266 | Init, service worker, bulk selection handlers |

#### `public/js/state.js` (~481 lines) - Shared state

| Lines | Section |
|-------|---------|
| 1-70 | State variable declarations (conversations, models, streaming, UI, selection) |
| 72-200 | State getters and setters |
| 202-340 | More state functions (pending messages, reactions, attachments, selection mode) |
| 342-481 | Status/thinking state, DOM element management, scrollToBottom |

#### `public/js/utils.js` (~165 lines) - Helper functions

| Lines | Section |
|-------|---------|
| 1-40 | `haptic()`, `formatTime()`, `formatTokens()`, `truncate()`, `setLoading()` |
| 42-80 | Toast system: `initToast()`, `showToast()` (with action/undo support) |
| 82-165 | Dialog system: `initDialog()`, `showDialog()`, dialog helpers |

#### `public/js/websocket.js` (~108 lines) - WebSocket management

| Lines | Section |
|-------|---------|
| 1-20 | Imports, state variables, initialization |
| 22-60 | `connectWS()` - establish connection, handle reconnect |
| 62-108 | `handleWSMessage()` - dispatch incoming events |

#### `public/js/render.js` (~429 lines) - Rendering functions

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
| 382-429 | `attachRegenHandlers()`, `attachMessageActions()` callback |

#### `public/js/conversations.js` (~693 lines) - Conversation management

| Lines | Section |
|-------|---------|
| 1-35 | Imports, DOM element references, initialization |
| 37-95 | `loadConversations()`, `getConversation()`, `createConversation()` |
| 97-145 | `deleteConversation()`, `softDeleteConversation()` (with undo) |
| 147-170 | `archiveConversation()`, `renameConversation()`, `pinConversation()` |
| 172-210 | `forkConversation()`, `searchConversations()` |
| 212-340 | `renderConversationList()` - render cards, scope grouping, pin icons |
| 342-420 | `setupSwipe()`, `resetSwipe()` - swipe gesture handling |
| 422-480 | `setupLongPress()`, `showActionPopup()`, `hideActionPopup()` |
| 482-550 | `setupActionPopupHandlers()` (pin/archive/rename/delete), search filters |
| 552-610 | `openConversation()`, `showChatView()`, `showListView()` |
| 612-693 | Bulk selection: `enterSelectionMode()`, `exitSelectionMode()`, `bulkArchive()`, `bulkDelete()` |

#### `public/js/ui.js` (~1320 lines) - UI interactions

| Lines | Section |
|-------|---------|
| 1-70 | Imports, DOM element references |
| 72-120 | `initUI()` - element initialization |
| 122-200 | `sendMessage()` - send with attachments |
| 202-260 | `renderAttachmentPreview()`, `attachMessageActions()` |
| 262-350 | `showMsgActionPopup()`, `hideMsgActionPopup()`, `startEditMessage()` |
| 352-400 | `regenerateMessage()`, model/mode badges |
| 402-460 | `updateContextBar()`, `switchModel()` |
| 462-540 | Directory browser: `browseTo()` |
| 542-600 | Voice input: `startRecording()`, `stopRecording()` |
| 602-700 | Theme: `applyTheme()`, `cycleTheme()`, `updateThemeIcon()` |
| 702-780 | Color themes: `applyColorTheme()`, `selectColorTheme()` |
| 782-900 | Stats: `loadStats()`, `renderStats()` |
| 902-940 | `populateFilterModels()` |
| 942-1270 | `setupEventListeners()` - all event handlers |
| 1272-1320 | Swipe-to-go-back, keyboard shortcuts |

#### `public/js/markdown.js` (~66 lines) - Markdown parser

| Lines | Section |
|-------|---------|
| 1-10 | `escapeHtml()` helper |
| 12-66 | `renderMarkdown(text)` - full parser |

### Frontend CSS (`public/css/`)

CSS is split into modular files:

| File | Lines | Purpose |
|------|-------|---------|
| `base.css` | ~82 | CSS variables, resets, base animations |
| `layout.css` | ~620 | Page layout, headers, view transitions |
| `components.css` | ~1070 | Buttons, inputs, modals, toasts (with undo action) |
| `messages.css` | ~657 | Chat messages, code blocks, attachments |
| `list.css` | ~677 | Conversation list, cards, swipe, bulk selection, pin icon |
| `themes/darjeeling.css` | ~224 | Default warm earth tone theme |
| `themes/claude.css` | ~210 | Purple accent with neutral grays |
| `themes/nord.css` | ~213 | Arctic blue palette |
| `themes/budapest.css` | ~214 | Grand Budapest Hotel inspired |

### `public/sw.js` (~86 lines)

| Lines | Section |
|-------|---------|
| 1-28 | Cache name (`claude-chat-v32`), static asset list (JS modules, CSS files, themes) |
| 30-36 | Install event (pre-cache) |
| 38-46 | Activate event (clean old caches) |
| 48-86 | Fetch event (cache-first for static, network-first for cacheable API, skip other API/WS) |

### `public/index.html` (~276 lines)

| Lines | Section |
|-------|---------|
| 1-26 | Head: meta tags, PWA config, color theme link, CSS imports |
| 27-48 | List view header: select mode, color theme toggle, theme toggle, stats, archive |
| 49-65 | Search bar, filters, pull indicator |
| 66-88 | Conversation list, FAB, bulk action bar |
| 89-100 | Action popups (conversations: pin/archive/rename/delete, messages) |
| 101-145 | Chat view DOM (header, messages, typing, attachments, input) |
| 146-175 | Stats view DOM |
| 176-220 | New conversation modal |
| 221-250 | Dialog system, theme/color dropdowns |
| 251-276 | Script tags (ES modules) |

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
  pinned: boolean,         // Pinned conversations sort to top
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

1. Add route in `lib/routes.js` inside `setupRoutes(app)`
2. Access conversation data via `conversations` Map (imported from `lib/data.js`)
3. Call `ensureMessages(id)` before accessing `.messages`
4. Call `saveIndex()` after metadata changes, `saveConversation(id)` after message changes

### Adding a new WebSocket event type

1. **Server → Client**: Add to the WS handler in `server.js`. Send via `ws.send(JSON.stringify({ type: 'newtype', ... }))`
2. **Client handler**: Add case to `handleWSMessage()` in `public/js/websocket.js`

### Adding a new UI feature to chat view

1. Add DOM elements to `#chat-view` in `index.html`
2. Add styling in appropriate CSS file (`messages.css` for chat, `components.css` for UI elements)
3. Add DOM reference in `public/js/app.js`, pass to `initUI()`
4. Add handler logic in `public/js/ui.js` - either in `initUI()` or `setupEventListeners()`
5. If it needs shared state, add to `public/js/state.js`
6. If it needs data from server, add a REST endpoint or WebSocket event

### Adding a conversation property

1. Add to creation in `POST /api/conversations` in `lib/routes.js`
2. Add to `PATCH` handler in `lib/routes.js`
3. Add to `convMeta()` in `lib/data.js`
4. Add UI control in the new conversation modal (`index.html`)
5. Add state variable in `public/js/state.js` if needed
6. Add to `openConversation()` in `public/js/conversations.js` to restore state
7. Pass to Claude CLI args if needed in `spawnClaude()` in `lib/claude.js`

### Modifying the markdown renderer

Edit `public/js/markdown.js`. The order of regex operations matters:
1. Code blocks extracted first (protected from all other transforms)
2. Inline code next
3. Bold before italic (both use asterisks)
4. Block elements (headers, lists, etc.)
5. Code blocks restored last

### Updating the service worker cache

Increment the version number in `CACHE_NAME` in `public/sw.js` (currently `claude-chat-v32`). Add new static assets to the `STATIC_ASSETS` array. All JS modules in `public/js/` and CSS files in `public/css/` should be listed.

### Adding a new color theme

1. Create new theme file in `public/css/themes/` (copy from `darjeeling.css`)
2. Define both `:root` (dark) and `html[data-theme="light"]` variants
3. Add to `STATIC_ASSETS` in `public/sw.js`
4. Add option to color theme dropdown in `index.html`
5. Increment service worker cache version

---

## Key Functions Reference

### Backend (`server.js` + `lib/*.js`)

| Function | Location | Purpose |
|----------|----------|---------|
| `atomicWrite(path, data)` | `lib/data.js` | Write JSON safely (tmp + rename) |
| `loadFromDisk()` | `lib/data.js` | Load index.json into memory Map |
| `saveIndex()` | `lib/data.js` | Persist metadata to index.json |
| `saveConversation(id)` | `lib/data.js` | Persist messages to conv/{id}.json |
| `ensureMessages(id)` | `lib/data.js` | Lazy-load messages from disk |
| `convMeta(conv)` | `lib/data.js` | Extract metadata including pinned field |
| `spawnClaude(ws, convId, conv, ...)` | `lib/claude.js` | Spawn Claude CLI process with streaming |
| `processStreamEvent(line)` | `lib/claude.js` | Parse Claude JSON output line |
| `cancelProcess(convId)` | `lib/claude.js` | Kill active Claude process |
| `setupRoutes(app)` | `lib/routes.js` | Register all REST API endpoints |
| `handleRegenerate(ws, msg)` | `server.js` | Pop last assistant msg, re-send last user msg |
| `handleEdit(ws, msg)` | `server.js` | Update message at index, truncate, re-send |

### Frontend (ES Modules in `public/js/`)

#### `utils.js`

| Function | Purpose |
|----------|---------|
| `haptic(ms)` | Trigger vibration feedback |
| `formatTime(ts)` | Format timestamp for display |
| `formatTokens(count)` | Format token count (e.g., "10.5k") |
| `showToast(message, opts)` | Show toast notification (supports `action` and `onAction` for undo) |
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
| `renderConversationList(items)` | Build conversation card DOM (grouped by cwd scope, pinned first) |
| `openConversation(id)` | Load + display conversation |
| `showListView()` | Return to conversation list |
| `forkConversation(fromMessageIndex)` | Fork conversation from a message |
| `triggerSearch()` | Run search with current query + filters |
| `pinConversation(id, pinned)` | Pin/unpin a conversation |
| `softDeleteConversation(id)` | Delete with 5-second undo toast |
| `enterSelectionMode()` | Enable bulk selection mode |
| `exitSelectionMode()` | Exit bulk selection mode |
| `bulkArchive()` | Archive all selected conversations |
| `bulkDelete()` | Delete all selected conversations |

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
| `.message.user` | User message bubble (right-aligned, gradient) |
| `.message.assistant` | Assistant message bubble (left-aligned, dark) |
| `.message.editing` | Message being inline-edited |
| `.conv-card` | Conversation list item |
| `.conv-card-wrapper` | Container for card + swipe actions |
| `.conv-card-wrapper.pinned` | Pinned conversation |
| `.conv-card.selected` | Selected in bulk mode |
| `.conv-card-select` | Selection checkbox (hidden unless selection mode) |
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
| `.pin-icon` | Pin icon on pinned conversations |
| `.selection-mode` | Applied to list view in bulk select mode |
| `.bulk-action-bar` | Fixed bar at bottom with bulk actions |
| `.select-mode-btn` | Button to enter selection mode |
| `.toast-action` | Undo button in toast notifications |

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
