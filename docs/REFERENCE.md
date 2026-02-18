# Developer Quick Reference

## File Structure

### Backend
```
server.js              # Entry point, WebSocket handlers
lib/
  routes/              # REST API endpoints
    index.js           # Route setup
    conversations.js   # CRUD, export, fork, compress
    git.js             # Git operations
    files.js           # File browser
    memory.js          # Memory system
    capabilities.js    # Model/CLI capabilities
    preview.js         # File preview
    helpers.js         # Shared utilities
  claude.js            # CLI process management, stream parsing
  data.js              # Storage, atomic writes
  constants.js         # Shared constants
```

### Frontend
```
public/js/
  app.js               # Entry point
  state.js             # Shared state
  utils.js             # Helpers (toast, dialog, formatTime)
  websocket.js         # WebSocket connection
  render.js            # Message rendering, TTS
  conversations.js     # Conversation list UI
  ui.js                # Event handlers
  markdown.js          # Markdown parser
  branches.js          # Fork tree visualization
  file-panel/          # File browser + git modules
  ui/                  # Stats, memory, voice, theme modules
```

### CSS
```
public/css/
  base.css             # Variables, resets
  layout.css           # Page structure
  components.css       # UI components
  messages.css         # Chat messages
  list.css             # Conversation list
  file-panel.css       # File panel
  branches.css         # Branch tree
  themes/              # 8 color themes
```

---

## Data Models

### Conversation
```javascript
{
  id: string,              // UUID
  name: string,
  cwd: string,             // Working directory
  claudeSessionId: string, // For --resume
  messages: Message[],     // null when not loaded
  status: 'idle' | 'thinking',
  archived: boolean,
  pinned: boolean,
  autopilot: boolean,      // --dangerously-skip-permissions
  useMemory: boolean,
  model: string,
  createdAt: number,
  messageCount: number,
  parentId: string,        // Fork parent
  forkIndex: number,       // Fork point
  lastMessage: { role, text, timestamp, cost, duration }
}
```

### User Message
```javascript
{
  role: 'user',
  text: string,
  timestamp: number,
  attachments: [{ filename, url }]  // optional
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
  sessionId: string,
  inputTokens: number,
  outputTokens: number
}
```

### Memory
```javascript
{
  id: string,
  text: string,
  scope: string,          // 'global' or cwd path
  category: string,
  enabled: boolean,
  source: string,
  createdAt: number
}
```

---

## Key Functions

### Backend

| Function | Location | Purpose |
|----------|----------|---------|
| `atomicWrite(path, data)` | data.js | Safe JSON write (tmp + rename) |
| `loadFromDisk()` | data.js | Load index.json at startup |
| `saveIndex()` | data.js | Persist metadata |
| `saveConversation(id)` | data.js | Persist messages |
| `ensureMessages(id)` | data.js | Lazy-load messages |
| `convMeta(conv)` | data.js | Extract metadata |
| `spawnClaude(ws, convId, conv, ...)` | claude.js | Spawn CLI with streaming |
| `processStreamEvent(line)` | claude.js | Parse CLI JSON output |
| `cancelProcess(convId)` | claude.js | Kill active process |

### Frontend

| Function | Location | Purpose |
|----------|----------|---------|
| `showToast(msg, opts)` | utils.js | Toast with optional undo action |
| `showDialog(opts)` | utils.js | Alert/confirm/prompt |
| `connectWS()` | websocket.js | Establish WebSocket |
| `renderMessages(msgs)` | render.js | Full message render |
| `appendDelta(text)` | render.js | Buffer streaming chunk |
| `finalizeMessage(data)` | render.js | Complete streaming |
| `loadConversations()` | conversations.js | Fetch + render list |
| `openConversation(id)` | conversations.js | Load + display conversation |
| `forkConversation(idx)` | conversations.js | Fork from message |
| `sendMessage(text)` | ui.js | Send with attachments |
| `renderMarkdown(text)` | markdown.js | Markdown → HTML |

---

## Common Patterns

### Adding a REST endpoint
1. Add route in `lib/routes/{file}.js`
2. Access data via `conversations` Map from data.js
3. Call `ensureMessages(id)` before accessing `.messages`
4. Call `saveIndex()` or `saveConversation(id)` after changes

### Adding a WebSocket event
1. **Server → Client:** Add to handler in `server.js`, send via `ws.send(JSON.stringify({...}))`
2. **Client handler:** Add case in `handleWSMessage()` in websocket.js

### Adding a conversation property
1. Add to `POST /api/conversations` in routes/conversations.js
2. Add to `PATCH` handler
3. Add to `convMeta()` in data.js
4. Add UI control in index.html modal
5. Add state in state.js if needed
6. Restore in `openConversation()` in conversations.js

### Adding a color theme
1. Create `public/css/themes/{name}.css` (copy existing)
2. Define `:root` (dark) and `html[data-theme="light"]` variants
3. Add to `STATIC_ASSETS` in sw.js
4. Add option to theme dropdown in index.html
5. Increment service worker cache version

---

## CSS Classes

| Class | Usage |
|-------|-------|
| `.message.user` | User bubble (right, gradient) |
| `.message.assistant` | Assistant bubble (left) |
| `.conv-card` | Conversation list item |
| `.conv-card.selected` | Selected in bulk mode |
| `.slide-in` / `.slide-out` | View transitions |
| `.recording` | Mic button recording state |
| `.speaking` | TTS button playing state |
| `.glass-bg` | Glass-morphism effect |
| `.scope-group` | Conversation group by cwd |
| `.selection-mode` | Bulk select active |

---

## Claude CLI Integration

```bash
claude -p "{text}" \
  --output-format stream-json \
  --verbose \
  --model {model_id} \
  --include-partial-messages \
  [--dangerously-skip-permissions]  # if autopilot
  [--resume {sessionId}]            # continuing conversation
  [--add-dir {cwd}]                 # working directory
  [--append-system-prompt {memories}]
```

Session IDs enable continuity: stored after first `result`, passed via `--resume` on subsequent messages. Reset to `null` when editing or regenerating.
