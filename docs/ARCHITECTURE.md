# Architecture Guide

## System Overview

Concierge is a mobile-first PWA interface for AI coding agents. The architecture is a three-tier system: a Node.js backend manages provider processes/requests (Claude CLI, Codex CLI, Ollama HTTP) and streams output over WebSocket to a vanilla JS frontend. Conversations persist as JSON files on disk.

```
+-------------+                  +--------------+                  +------------------+
|   Browser   |  WebSocket/REST  |  server.js   |  stdio/spawn/API | Provider CLI/API |
|    (PWA)    | <--------------> |  Express+WS  | <--------------> | Claude/Codex/Ollama |
+-------------+                  +--------------+                  +------------------+
                                        |
                                        | JSON files
                                        v
                                 +--------------+
                                 |    data/     |
                                 +--------------+
```

## Backend

### Provider System

Concierge supports multiple LLM providers through an abstract provider interface. Each provider implements the same API, allowing conversations to use different backends.

**Available Providers:**
- **Claude** (default) - Claude CLI integration with full feature support (tools, files, sessions, sandbox)
- **Codex** - OpenAI Codex CLI integration with session resume and tool tracing
- **Ollama** - Local LLM support via Ollama HTTP API (free, offline, no tool use)

**Architecture:**
```
LLMProvider (base.js)          # Abstract interface
    ├── getModels()            # List available models
    ├── chat()                 # Send message, stream response
    ├── cancel()               # Cancel generation
    ├── isActive()             # Check if generating
    └── generateSummary()      # Compress conversations

ClaudeProvider extends LLMProvider
CodexProvider extends LLMProvider
OllamaProvider extends LLMProvider

Provider Registry (index.js)
    ├── registerProvider()     # Add provider to registry
    ├── getProvider(id)        # Get provider instance
    ├── getAllProviders()      # List all providers
    └── initProviders()        # Initialize at startup
```

**Provider Selection:**
- Set per conversation via `provider` field (defaults to 'claude')
- Models are provider-specific (e.g., claude-sonnet-4.5 vs gpt-5.3-codex vs llama3.2)
- Server calls appropriate provider based on conversation.provider

**Limitations by Provider:**
- **Claude**: Full features (tools, files, sessions, thinking, compression)
- **Codex**: Full chat flow with tool events, sessions, and compression
- **Ollama**: Basic chat only (no files, no tools, stateless, free)

### Module Structure

```
server.js          # Entry point, Express/WS setup, WebSocket handlers
lib/
  routes/          # REST API (modular)
    index.js       # Route setup
    conversations.js  # CRUD, search, export, fork, compress
    git.js            # Git operations
    files.js          # File browser
    memory.js         # Memory management
    capabilities.js   # Provider/model capabilities
    preview.js        # Live web preview server controls
    duckdb.js         # DuckDB data analysis endpoints
    bigquery.js       # BigQuery ADC + query endpoints
    workflow.js       # Write locks + patch queue APIs
    helpers.js        # Shared utilities (withConversation, etc.)
  providers/       # LLM provider system
    base.js        # Base provider interface
    claude.js      # Claude CLI provider
    codex.js       # OpenAI Codex CLI provider
    ollama.js      # Ollama provider
    index.js       # Provider registry
  memory-prompt.txt  # Memory injection template
  claude.js        # Backwards compat wrapper
  data.js          # Storage, atomic writes, lazy loading
  duckdb.js        # DuckDB query/load helpers
  bigquery.js      # BigQuery ADC/token/query helpers
  embeddings.js    # Semantic search with local embeddings
  workflow/        # Parallel workflow coordination
    locks.js       # Single-writer repository locks
    patch-queue.js # Queue/apply/reject patch proposals
  constants.js     # Shared constants
```

### Process Management

**Claude Provider:** Each conversation spawns one Claude CLI child process:

```bash
claude -p "{text}" --output-format stream-json --verbose \
  --model {model} --include-partial-messages \
  [--settings {sandbox_json}] \            # Sandbox configuration
  [--dangerously-skip-permissions] \       # Only if unsandboxed + autopilot
  [--resume {sessionId}] \
  [--add-dir {cwd}] \
  [--append-system-prompt {memories}]
```

**Codex Provider:** Each conversation spawns one Codex CLI child process:

```bash
codex exec --json -m {model} -C {cwd} --skip-git-repo-check \
  [-s workspace-write|read-only] [--add-dir {uploads}] "{prompt}"

codex exec resume {sessionId} --json -m {model} --skip-git-repo-check "{prompt}"
```
(`exec resume` does not use `-C` or `-s`.)

**Ollama Provider:** Stateless HTTP requests to Ollama API:
- POST to `/api/chat` with full message history
- Streaming response via newline-delimited JSON
- No session persistence - history sent each time
- AbortController for cancellation

**Lifecycle:**
- Process/request starts → `status: "thinking"` sent to client
- Output stream → parsed and forwarded as `delta` events
- Tool calls (Claude/Codex) → `tool_start` and `tool_result` events
- Process/request completes → `result` event with cost/duration/tokens, then `status: "idle"`
- 5 minute timeout per message

**Sandbox Mode:**
Conversations default to sandboxed mode for safety. Sandbox configuration:
```json
{
  "sandbox": {
    "enabled": true,
    "autoAllowBashIfSandboxed": true,
    "allowUnsandboxedCommands": false,
    "network": {
      "allowedDomains": ["github.com", "*.npmjs.org", "registry.yarnpkg.com", "api.github.com"]
    }
  },
  "permissions": {
    "allow": ["Edit(/{cwd}/**)", "Write(/{cwd}/**)"],
    "deny": ["Read(**/.env)", "Read(**/.env.*)", "Read(**/credentials.json)",
             "Read(~/.ssh/**)", "Read(~/.aws/**)", "Read(~/.config/**)"]
  }
}
```

**Permission Modes:**
- **Sandboxed** (default): Uses --settings with restrictive permissions
- **Autopilot + Unsandboxed**: Uses --dangerously-skip-permissions
- **Unsandboxed only**: No special flags (prompts for each permission)

### Stream Event Processing

**Claude Provider:** CLI outputs newline-delimited JSON. Key event types:
- `content_block_delta` with `text_delta` → send as `delta`
- `content_block_delta` with `thinking_delta` → send as `thinking` event (extended thinking)
- `content_block_start` with `tool_use` → send as `tool_start` event
- `tool_result` → send as `tool_result` event
- `result` → extract cost, duration, sessionId, tokens → send as `result`

**Codex Provider:** CLI outputs newline-delimited JSON events:
- `thread.started` → capture `thread_id` as resume session id
- `item.completed` with `reasoning` / `agent_message` → `thinking` / `delta`
- `item.started` / `item.completed` (tool items) → `tool_start` / `tool_result`
- `turn.completed` → final `result` with usage + session id

**Ollama Provider:** HTTP stream with newline-delimited JSON:
- `message.content` → send as `delta`
- `done: true` → send as `result` with token counts (cost always $0)

### Data Storage

**Lazy Loading:**
- `data/index.json` — lightweight metadata for all conversations (loaded at startup)
- `data/conv/{id}.json` — full message arrays (loaded on demand)
- `data/uploads/{id}/` — file attachments per conversation
- `data/memory/` — global and project-scoped memories

**Atomic Writes:** All saves write to `.tmp` then `rename()` to prevent corruption.

**Embeddings & Semantic Search:**
- `data/embeddings.json` — 384-dim vectors generated by all-MiniLM-L6-v2
- Embeddings created from conversation name + first user message (truncated to 512 chars)
- Generated automatically after first assistant response
- Backfill process runs at startup for existing conversations without embeddings
- Search uses cosine similarity between query vector and conversation vectors
- Model downloaded (~23MB) on first use and cached locally

**Memory System:**
- `data/memory/global.json` — memories that apply to all conversations
- `data/memory/{hash}.json` — project-scoped memories (hash of cwd path)
- Each memory has: id, text, scope, category (optional), enabled (default true), source, createdAt
- Memories injected via --append-system-prompt using template from memory-prompt.txt
- Template has placeholders for {{GLOBAL_MEMORIES}} and {{PROJECT_MEMORIES}}
- Conversations can disable memory injection via useMemory flag

**Conversation Metadata:**
```javascript
{
  id, name, cwd, claudeSessionId, codexSessionId, status,
  archived, pinned, autopilot, sandboxed, useMemory,
  provider, model, createdAt,
  messageCount, parentId, forkIndex, forkSourceCwd,
  lastMessage: { role, text, timestamp, cost, duration, sessionId }
}
```
- `sandboxed` - boolean, defaults to true for safety
- `provider` - string, defaults to 'claude' ('claude' | 'codex' | 'ollama')
- `model` - string, provider-specific model ID

### REST API

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET/POST` | `/api/conversations` | List/create conversations |
| `GET/PATCH/DELETE` | `/api/conversations/:id` | Get/update/delete conversation |
| `GET` | `/api/conversations/search` | Full-text search with filters |
| `GET` | `/api/conversations/semantic-search` | Semantic search by meaning |
| `GET` | `/api/conversations/:id/tree` | Branch tree (forks) |
| `GET` | `/api/conversations/:id/export` | Export as markdown/JSON |
| `POST` | `/api/conversations/:id/fork` | Fork from message index (same workspace or worktree, optional local-state copy) |
| `POST` | `/api/conversations/:id/compress` | Compress old messages |
| `GET` | `/api/providers` | List available providers |
| `GET` | `/api/providers/:id/models` | Get models for a provider |
| `GET` | `/api/stats` | Aggregate usage stats (cached 30s) |
| `GET` | `/api/capabilities` | Skills/commands/agents |
| `GET/POST/PATCH/DELETE` | `/api/memory` | Memory CRUD |

**File Browser:**
| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/browse` | Directory listing (cwd picker) |
| `GET` | `/api/files` | General file browser |
| `GET` | `/api/files/content` | Get structured file content (standalone cwd) |
| `GET` | `/api/files/download` | Download file |
| `POST` | `/api/files/upload` | Upload file |
| `GET` | `/api/conversations/:id/files` | List files in cwd |
| `GET` | `/api/conversations/:id/files/content` | Get file content |
| `GET` | `/api/conversations/:id/files/search` | Git grep search |
| `GET` | `/api/conversations/:id/files/download` | Download file from conversation cwd |

**Data Analysis (DuckDB + BigQuery):**
| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/duckdb/load` | Load local CSV/TSV/Parquet/JSON/GeoJSON data file into DuckDB |
| `POST` | `/api/duckdb/query` | Run SQL query against loaded DuckDB tables |
| `POST` | `/api/duckdb/export` | Download DuckDB query result (`csv|json|parquet`) |
| `GET` | `/api/duckdb/tables` | List loaded DuckDB tables |
| `DELETE` | `/api/duckdb/tables/:name` | Drop a loaded DuckDB table |
| `GET` | `/api/bigquery/auth/status` | Read BigQuery ADC auth status |
| `POST` | `/api/bigquery/auth/refresh` | Refresh BigQuery ADC auth state |
| `POST` | `/api/bigquery/query/start` | Start BigQuery query job |
| `GET` | `/api/bigquery/query/status` | Poll BigQuery query job status |
| `POST` | `/api/bigquery/query/cancel` | Cancel BigQuery query job |
| `POST` | `/api/bigquery/query/save` | Save full BigQuery result into conversation cwd (`csv|json|parquet|geojson`) |
| `POST` | `/api/bigquery/query/download` | Download full BigQuery result to browser (`csv|json|parquet|geojson`) |

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
| `POST` | `.../git/hunk-action` | Accept/reject hunk (stage/discard/unstage) |
| `POST` | `.../git/revert-hunk` | Legacy hunk revert endpoint (compatibility) |

**File Viewer Content:**
| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/files/content?path=` | Standalone viewer content payload |
| `GET` | `/api/conversations/:id/files/content?path=` | Conversation-scoped viewer content payload |

Supported file types:
- **Text/code** - UTF-8 content with language hinting
- **CSV/TSV** - Parsed and rendered as tables
- **Parquet** - Decoded using parquetjs-lite, rendered as tables
- **Jupyter Notebooks (.ipynb)** - Rendered with code cells and outputs
- **GeoJSON/JSON/JSONL/NDJSON** - Map viewer for GeoJSON-compatible payloads (Map/Raw toggle, basemap switch, feature hover/details, fit-to-bounds)
- **Images** - Displayed inline via download/content URL

**Live Web Preview Server:**
| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/conversations/:id/preview/start` | Start project preview server |
| `POST` | `/api/conversations/:id/preview/stop` | Stop preview server |
| `GET` | `/api/conversations/:id/preview/status` | Get preview status + URL |

**Workflow Coordination:**
| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/workflow/lock?cwd=` | Read current writer lock |
| `POST` | `/api/workflow/lock/acquire` | Acquire single-writer lock |
| `POST` | `/api/workflow/lock/heartbeat` | Renew lock TTL |
| `POST` | `/api/workflow/lock/release` | Release lock |
| `GET` | `/api/workflow/patches` | List queued patches |
| `POST` | `/api/workflow/patches` | Submit patch proposal |
| `POST` | `/api/workflow/patches/:id/apply` | Apply queued patch |
| `POST` | `/api/workflow/patches/:id/reject` | Reject queued patch |

### WebSocket Protocol

**Client → Server:**
| Type | Description |
|------|-------------|
| `message` | Send user message, spawns provider process/request |
| `cancel` | Kill active process or abort request |
| `regenerate` | Re-generate last response (resets session) |
| `edit` | Edit message, auto-forks conversation |
| `resend` | Resend a previous message (forks if not last) |

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
| `resend_forked` | Resend created a fork |

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
  explorer/        # Shared file viewer + git controllers
  file-panel/      # Conversation-scoped shell for explorer modules
  files-standalone.js # Cwd-scoped shell reusing explorer modules
  ui/              # Modular UI features (stats, memory, voice, theme, etc.)
```

### Views

Five mutually exclusive views with CSS transform transitions:

1. **List View** — Conversation browser grouped by cwd, search (keyword + semantic), archive toggle
2. **Chat View** — Messages, input bar, file panel with preview
3. **Stats View** — Analytics dashboard with cost tracking, activity charts
4. **Branches View** — Fork tree visualization with parent/child navigation
5. **Memory View** — Memory management (global + project-scoped)

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
  themes/         # 8 color themes: darjeeling, budapest, aquatic, catppuccin, fjord, monokai, moonrise, paper
```

### Design System

- **Light/Dark Mode:** Each theme defines `:root` (dark) and `html[data-theme="light"]` variants
- **Glass-morphism:** Headers and modals use `backdrop-filter: blur()`
- **Safe areas:** iOS insets via `env(safe-area-inset-*)`
