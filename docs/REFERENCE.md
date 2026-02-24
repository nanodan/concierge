# Developer Quick Reference

## File Structure

### Backend
```
server.js              # Entry point, WebSocket handlers
lib/
  routes/              # REST API endpoints
    index.js           # Route setup
    conversations.js   # CRUD, export, fork, compress, search
    git.js             # Git operations
    files.js           # File browser
    memory.js          # Memory system
    capabilities.js    # Model/CLI capabilities
    preview.js         # Live web preview server controls
    duckdb.js          # DuckDB data analysis routes
    bigquery.js        # BigQuery ADC + query routes
    workflow.js        # Write lock + patch queue routes
    helpers.js         # Shared utilities (withConversation, etc.)
  providers/           # LLM provider system
    base.js            # Base provider interface
    claude.js          # Claude CLI provider
    codex.js           # OpenAI Codex CLI provider
    ollama.js          # Ollama HTTP API provider
    index.js           # Provider registry
  memory-prompt.txt    # Memory injection template
  claude.js            # Backwards compat wrapper
  data.js              # Storage, atomic writes
  bigquery.js          # BigQuery ADC/token/query helpers
  embeddings.js        # Semantic search with local embeddings
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
  explorer/            # Shared file viewer + git controllers
  files-standalone.js  # Standalone cwd-scoped files/git view
  file-panel/          # Conversation-scoped shell + live preview tab
    index.js           # Main file panel module
    file-browser.js    # File tree shell bindings
    git-branches.js    # Branch shell bindings
    git-changes.js     # Changes shell bindings
    git-commits.js     # Commit history shell bindings
    gestures.js        # Touch interactions
    data.js            # Data tab (DuckDB + BigQuery SQL + exports)
    preview.js         # Live preview server controls
  ui/                  # Modular UI features
    capabilities.js    # Provider/model capabilities
    context-bar.js     # Context usage indicator
    directory-browser.js  # CWD picker
    file-browser.js    # Standalone file browser
    memory.js          # Memory management
    stats.js           # Usage dashboard
    theme.js           # Theme switcher
    voice.js           # Speech input/output
  constants.js         # Frontend constants
  file-utils.js        # File handling utilities
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
  claudeSessionId: string, // For --resume (Claude)
  codexSessionId: string,  // For `codex exec resume` (Codex)
  messages: Message[],     // null when not loaded
  status: 'idle' | 'thinking',
  archived: boolean,
  pinned: boolean,
  autopilot: boolean,      // Skip permissions (when unsandboxed)
  sandboxed: boolean,      // Default true - use sandbox settings
  useMemory: boolean,      // Default true - inject memories
  provider: string,        // 'claude' | 'codex' | 'ollama' (default: 'claude')
  model: string,           // Provider-specific model ID
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
  category: string,       // optional
  enabled: boolean,       // default true
  source: string,         // where memory came from
  createdAt: number
}
```

### Provider
```javascript
{
  id: string,             // 'claude' | 'codex' | 'ollama'
  name: string,           // Display name
}
```

### Model
```javascript
{
  id: string,             // e.g., 'claude-sonnet-4.5'
  name: string,           // Display name
  context: number,        // Context window size
  inputPrice: number,     // Per million tokens (optional)
  outputPrice: number,    // Per million tokens (optional)
}
```

### Sandbox Settings
```javascript
{
  sandbox: {
    enabled: boolean,
    autoAllowBashIfSandboxed: boolean,
    allowUnsandboxedCommands: boolean,
    network: {
      allowedDomains: string[]
    }
  },
  permissions: {
    allow: string[],      // Glob patterns like "Edit(/path/**)"
    deny: string[]        // Glob patterns like "Read(**/.env)"
  }
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
| `spawnClaude(ws, convId, conv, ...)` | claude.js | Spawn CLI with streaming (backwards compat) |
| `processStreamEvent(line)` | claude.js | Parse CLI JSON output |
| `cancelProcess(convId)` | claude.js | Kill active process |
| `initProviders()` | providers/index.js | Initialize all providers at startup |
| `getProvider(id)` | providers/index.js | Get provider instance by ID |
| `getAllProviders()` | providers/index.js | List all registered providers |
| `provider.chat(ws, convId, ...)` | providers/base.js | Send message (provider-specific) |
| `provider.cancel(convId)` | providers/base.js | Cancel active generation |
| `provider.generateSummary(msgs, model, cwd)` | providers/base.js | Summarize for compression |
| `embedConversation(conv)` | embeddings.js | Generate embedding for conversation |
| `semanticSearch(query, topK)` | embeddings.js | Search by meaning |
| `backfillEmbeddings(convs, loadMsgs)` | embeddings.js | Generate missing embeddings |
| `deleteEmbedding(convId)` | embeddings.js | Remove embedding on delete |

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

### Adding a new provider
1. Create class extending LLMProvider in `lib/providers/`
2. Implement required methods: `getModels()`, `chat()`, `cancel()`, `isActive()`, `generateSummary()`
3. Set static `id` and `name` properties
4. Register in `lib/providers/index.js` `initProviders()`
5. Add UI option in new conversation modal
6. Test with different conversation settings (autopilot, sandbox)

### Working with sandbox settings
1. Sandbox is enabled by default (`conv.sandboxed !== false`)
2. Use --settings JSON flag to pass sandbox config to Claude CLI
3. Permission patterns use glob syntax (e.g., `Edit(/path/**)`)
4. Always deny sensitive paths (.env, .ssh, credentials) in deny list
5. Unsandboxed + autopilot mode uses --dangerously-skip-permissions
6. Unsandboxed without autopilot prompts for each permission

### Adding file preview support
1. Extend structured content handling in `lib/routes/files.js` (`sendFileContentResponse`)
2. Add/adjust parsing or normalization logic for the new format
3. Add rendering support in `public/js/explorer/file-viewer-content.js`
4. If interactive, add helper module(s) in `public/js/explorer/` (for example `geo-preview.js`)
5. Reuse shared viewer wiring from `public/js/explorer/context.js` so both convo and standalone shells inherit it
6. Update docs and supported-type UI hints in the viewer header

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
| `.file-panel` | File browser side panel |
| `.preview-container` | File preview display |
| `.branch-tree` | Fork visualization |
| `.memory-item` | Memory list item |
| `.sandbox-badge` | Indicates sandboxed conversation |

---

## Claude CLI Integration

```bash
claude -p "{text}" \
  --output-format stream-json \
  --verbose \
  --model {model_id} \
  --include-partial-messages \
  [--settings {sandbox_json}]          # if sandboxed (default)
  [--dangerously-skip-permissions]     # if unsandboxed + autopilot
  [--resume {sessionId}]               # continuing conversation
  [--add-dir {cwd}]                    # working directory
  [--append-system-prompt {memories}]  # inject memories
```

**Session IDs:** Stored after first `result`, passed via `--resume` on subsequent messages. Reset to `null` when editing or regenerating.

**Sandbox Settings:** When `conv.sandboxed !== false`, the --settings flag passes a JSON config with permission rules:
- `allow` patterns grant specific permissions (e.g., `Edit(/Users/me/project/**)`)
- `deny` patterns block access (e.g., `Read(**/.env)`)
- Network domains whitelist (e.g., `github.com`, `*.npmjs.org`)

**Autopilot:** When `conv.sandboxed === false` AND `conv.autopilot !== false`, uses --dangerously-skip-permissions instead.
