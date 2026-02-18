# Architecture Guide

## System Overview

Concierge is a mobile-first PWA interface for Claude Code. The architecture is a three-tier system: a Node.js backend manages Claude Code processes and streams output over WebSocket to a vanilla JS frontend. Conversations persist as JSON files on disk.

```
+-------------+                  +--------------+                  +-------------+
|   Browser   |  WebSocket/REST  |  server.js   |  stdio/spawn     | Claude Code |
|    (PWA)    | <--------------> |  Express+WS  | <--------------> |     CLI     |
+-------------+                  +--------------+                  +-------------+
                                        |
                                        | JSON files
                                        v
                                 +--------------+
                                 |    data/     |
                                 +--------------+
```

## Backend

### Module Structure

```
server.js          # Entry point, Express/WS setup, WebSocket handlers
lib/
  routes/          # REST API (modular)
    index.js       # Route setup
    conversations.js
    git.js
    files.js
    memory.js
    capabilities.js
    preview.js
    helpers.js
  claude.js        # CLI process spawning, stream parsing
  data.js          # Storage, atomic writes, lazy loading
  constants.js     # Shared constants
```

### Process Management

Each conversation spawns one Claude CLI child process:

```bash
claude -p "{text}" --output-format stream-json --verbose \
  --model {model} --include-partial-messages \
  [--dangerously-skip-permissions] \
  [--resume {sessionId}] \
  [--add-dir {cwd}] \
  [--append-system-prompt {memories}]
```

**Lifecycle:**
- Process starts → `status: "thinking"` sent to client
- stdout emits JSON lines → parsed and forwarded as `delta` events
- Tool calls → `tool_start` and `tool_result` events
- Process exits → `result` event with cost/duration/tokens, then `status: "idle"`
- 5 minute timeout per message

### Stream Event Processing

Claude CLI outputs newline-delimited JSON. Key event types:
- `content_block_delta` with `text_delta` → send as `delta`
- `thinking_delta` → send as `thinking` event
- `tool_use` → send as `tool_start` event
- `tool_result` → send as `tool_result` event
- `result` → extract cost, duration, sessionId, tokens → send as `result`

### Data Storage

**Lazy Loading:**
- `data/index.json` — lightweight metadata for all conversations (loaded at startup)
- `data/conv/{id}.json` — full message arrays (loaded on demand)
- `data/uploads/{id}/` — file attachments per conversation
- `data/memory/` — global and project-scoped memories

**Atomic Writes:** All saves write to `.tmp` then `rename()` to prevent corruption.

**Conversation Metadata:**
```javascript
{
  id, name, cwd, claudeSessionId, status,
  archived, pinned, autopilot, useMemory, model, createdAt,
  messageCount, parentId, forkIndex,
  lastMessage: { role, text, timestamp, cost, duration, sessionId }
}
```

### REST API

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET/POST` | `/api/conversations` | List/create conversations |
| `GET/PATCH/DELETE` | `/api/conversations/:id` | Get/update/delete conversation |
| `GET` | `/api/conversations/search` | Full-text search with filters |
| `GET` | `/api/conversations/:id/tree` | Branch tree (forks) |
| `GET` | `/api/conversations/:id/export` | Export as markdown/JSON |
| `POST` | `/api/conversations/:id/fork` | Fork from message index |
| `POST` | `/api/conversations/:id/compress` | Compress old messages |
| `GET` | `/api/models` | Available Claude models |
| `GET` | `/api/stats` | Aggregate usage stats (cached 30s) |
| `GET` | `/api/capabilities` | Skills/commands/agents |
| `GET/POST/PATCH/DELETE` | `/api/memory` | Memory CRUD |

**File Browser:**
| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/browse` | Directory listing (cwd picker) |
| `GET` | `/api/files` | General file browser |
| `GET` | `/api/files/download` | Download file |
| `POST` | `/api/files/upload` | Upload file |
| `GET` | `/api/conversations/:id/files` | List files in cwd |
| `GET` | `/api/conversations/:id/files/content` | Get file content |
| `GET` | `/api/conversations/:id/files/search` | Git grep search |

**Git Integration:**
| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `.../git/status` | Branch, staged, unstaged, ahead/behind |
| `GET` | `.../git/branches` | Local and remote branches |
| `POST` | `.../git/diff` | Diff for file |
| `POST` | `.../git/stage` | Stage files |
| `POST` | `.../git/unstage` | Unstage files |
| `POST` | `.../git/discard` | Discard changes |
| `POST` | `.../git/commit` | Create commit |
| `POST` | `.../git/branch` | Create branch |
| `POST` | `.../git/checkout` | Checkout branch |
| `POST` | `.../git/push` | Push to remote |
| `POST` | `.../git/pull` | Pull from remote |
| `GET/POST` | `.../git/stash` | List/create stash |
| `POST` | `.../git/stash/pop\|apply\|drop` | Stash operations |
| `GET` | `.../git/commits` | Commit history |
| `GET` | `.../git/commits/:hash` | Single commit diff |
| `POST` | `.../git/revert` | Revert commit |
| `POST` | `.../git/reset` | Reset to commit |
| `POST` | `.../git/undo-commit` | Undo last commit |

### WebSocket Protocol

**Client → Server:**
| Type | Description |
|------|-------------|
| `message` | Send user message, spawns Claude process |
| `cancel` | Kill active process |
| `regenerate` | Re-generate last response (resets session) |
| `edit` | Edit message, auto-forks conversation |

**Server → Client:**
| Type | Description |
|------|-------------|
| `delta` | Streaming text chunk |
| `thinking` | Extended thinking output |
| `tool_start` | Tool execution started |
| `tool_result` | Tool execution completed |
| `result` | Final response with cost/duration/tokens |
| `status` | `"thinking"` or `"idle"` |
| `error` | Error message |
| `edit_forked` | Edit created a fork |

---

## Frontend

### Module Structure

```
public/js/
  app.js           # Entry point, initialization
  state.js         # Shared state, getters/setters
  utils.js         # Helpers (formatTime, toast, dialog)
  websocket.js     # WebSocket connection
  render.js        # Message rendering, TTS
  conversations.js # Conversation CRUD, list UI
  ui.js            # UI interactions, event handlers
  markdown.js      # Markdown parser
  branches.js      # Branch tree visualization
  file-panel/      # File browser + git
  ui/              # Modular UI features (stats, memory, voice, theme, etc.)
```

### Views

Five mutually exclusive views with CSS transform transitions:

1. **List View** — Conversation browser grouped by cwd, search, archive toggle
2. **Chat View** — Messages, input bar, file panel
3. **Stats View** — Analytics dashboard
4. **Branches View** — Fork tree visualization
5. **Memory View** — Memory management

### Message Rendering

1. **`renderMessages()`** — Full re-render on conversation open
2. **`appendDelta()`** — Buffers streaming chunks, RAF-throttled
3. **`flushDelta()`** — Applies buffered text to DOM once per frame
4. **`finalizeMessage()`** — Completes streaming with metadata, TTS button

### Touch Interactions

- **Swipe-to-reveal** — Conversation cards reveal archive/delete actions
- **Swipe-to-go-back** — Left edge swipe returns to list
- **Long-press** — Context menus for cards and messages
- **Bulk selection** — Multi-select mode for batch operations

### Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Cmd/Ctrl+K` | Focus search |
| `Cmd/Ctrl+N` | New conversation |
| `Cmd/Ctrl+E` | Export conversation |
| `Cmd/Ctrl+Shift+A` | Toggle archived |
| `Escape` | Go back / close modal |

---

## Service Worker

**Strategy:** Cache-first for static assets, network-first for `/api/conversations` (offline list).

**Cache versioning:** Increment `CACHE_NAME` version to bust caches on deploy.

---

## CSS Architecture

```
public/css/
  base.css        # Variables, resets, animations
  layout.css      # Page layout, view transitions
  components.css  # Buttons, inputs, modals, toasts
  messages.css    # Chat messages, code blocks
  list.css        # Conversation list, cards, swipe
  file-panel.css  # File browser, git UI
  branches.css    # Branch tree
  themes/         # 8 color themes (dark + light variants each)
```

### Design System

- **Light/Dark Mode:** Each theme defines `:root` (dark) and `html[data-theme="light"]` variants
- **Glass-morphism:** Headers and modals use `backdrop-filter: blur()`
- **Safe areas:** iOS insets via `env(safe-area-inset-*)`
