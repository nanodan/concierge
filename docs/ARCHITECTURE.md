# Architecture Guide

## System Overview

Claude Remote Chat is a mobile-first interface for **Claude Code** (Anthropic's agentic coding CLI). Each conversation spawns a Claude Code process that can autonomously execute multi-step workflows: running shell commands, editing files, searching code, making API calls, and iterating until the task is complete.

The architecture is a three-tier PWA: a Node.js backend manages Claude Code processes and streams their output over WebSocket to a vanilla JS frontend. Conversations persist as JSON files on disk, and Claude's session state allows conversations to resume with full context.

```
┌─────────────┐     WebSocket      ┌──────────────┐     stdio      ┌───────────────────────────┐
│   Browser    │ ◄──────────────► │   server.js   │ ◄────────────► │       Claude Code         │
│  (app.js)   │     HTTP/REST      │  Express+WS   │   spawn/kill   │  ┌─────────────────────┐  │
└─────────────┘                    └──────────────┘                 │  │   Agentic Loop      │  │
                                         │                          │  │ ┌────┐→┌────┐→┌────┐│  │
                                    JSON files                      │  │ │Read│ │Edit│ │Run ││  │
                                         │                          │  │ └────┘ └────┘ └────┘│  │
                                   ┌─────┴─────┐                    │  └─────────────────────┘  │
                                   │   data/    │                    │ Tools: Bash, Edit, Read  │
                                   │ index.json │                    │ Grep, Write, WebFetch    │
                                   │ conv/*.json│                    └───────────────────────────┘
                                   │ memory/*.json│
                                   └───────────┘
```

**Key insight:** Claude Code is an autonomous agent, not a simple chat model. When you send a message, Claude may execute dozens of tool calls — reading files, running commands, editing code, searching, retrying on failure — before returning a final result. This app streams that entire agentic process to your browser in real-time.

## Backend (`server.js` + `lib/*.js`)

The backend is split into modules:
- `server.js` (~270 lines) — Entry point, Express/WS setup, WebSocket message handlers
- `lib/routes.js` (~1860 lines) — REST API endpoints including git integration, file browser, capabilities, memory
- `lib/claude.js` (~435 lines) — Claude CLI process spawning, stream parsing, memory injection
- `lib/data.js` (~275 lines) — Data storage, atomic writes, lazy loading, memory persistence

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
  [--append-system-prompt {memories}]  # injected if memory enabled
```

**Lifecycle:**
- Process starts → server sends `status: "thinking"` to client
- stdout emits JSON lines → server parses and forwards as `delta` events
- Tool calls → server sends `tool_start` and `tool_result` events
- Process exits → server sends `result` event with cost/duration/tokens, then `status: "idle"`
- Timeout: 5 minutes (`PROCESS_TIMEOUT`) per message

**Cancellation:**
- Client sends `{ type: "cancel" }` → server sends SIGTERM to process

### Stream Event Processing

Claude CLI outputs newline-delimited JSON. Key event types:

1. **`stream_event`** with nested `content_block_delta` → extract `text_delta.text` → send as `delta`
2. **`stream_event`** with `thinking_delta` → send as `thinking` event
3. **`content_block_start`** with `tool_use` → send as `tool_start` event
4. **`user`** with `tool_result` → send as `tool_result` event
5. **`result`** → extract `costUSD`, `durationMs`, `sessionId`, token counts → send as `result`

Tool calls are accumulated separately and wrapped in a `:::trace` block in the final message.

A buffer handles partial JSON lines that span multiple stdout chunks.

### Data Storage

**Lazy Loading Pattern:**
- `data/index.json` holds lightweight metadata for all conversations (loaded at startup)
- `data/conv/{id}.json` holds full message arrays (loaded on demand via `ensureMessages()`)
- `data/uploads/{id}/` holds uploaded file attachments per conversation (cleaned up on delete)
- `data/memory/global.json` holds global memories (apply to all conversations)
- `data/memory/{scope-hash}.json` holds project-scoped memories (SHA-256 hash of cwd path)
- Messages are set to `null` after saving to allow garbage collection

**Atomic Writes:**
- All saves go through `atomicWrite(path, data)`: write to `.tmp`, then `rename()` to target
- Prevents corruption if the process crashes mid-write

**Conversation Metadata** (stored in index, always in memory):
```javascript
{
  id, name, cwd, claudeSessionId, status,
  archived, pinned, autopilot, useMemory, model, createdAt,
  messageCount, parentId, forkIndex,
  lastMessage: { role, text, timestamp, cost, duration, sessionId }
}
```

**Messages** (stored per-conversation, lazy-loaded):
```javascript
// User message
{ role: 'user', text, timestamp, attachments: [{ filename, url }] }

// Assistant message
{ role: 'assistant', text, timestamp, cost, duration, sessionId, inputTokens, outputTokens }
```

**Memory** (stored globally or per-project):
```javascript
{
  id, text, scope, // 'global' or cwd path
  category, enabled, source, createdAt
}
```

### REST API

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/conversations` | List conversations. Query: `?archived=true` |
| `POST` | `/api/conversations` | Create conversation. Body: `{ name, cwd, autopilot, model }` |
| `GET` | `/api/conversations/:id` | Get conversation with messages |
| `PATCH` | `/api/conversations/:id` | Update fields (archive, name, model, autopilot, pinned, useMemory) |
| `DELETE` | `/api/conversations/:id` | Delete conversation and message file |
| `GET` | `/api/conversations/search` | Search. Query: `?q=term&dateFrom=ISO&dateTo=ISO&model=id` |
| `GET` | `/api/conversations/:id/tree` | Get conversation branch tree (ancestors + descendants) |
| `GET` | `/api/models` | List available Claude models |
| `GET` | `/api/browse` | Directory listing (for cwd picker). Query: `?path=/some/dir` |
| `GET` | `/api/files` | General file browser. Query: `?path=/some/dir` |
| `GET` | `/api/files/download` | Download file. Query: `?path=/file&inline=true` |
| `POST` | `/api/files/upload` | Upload file. Query: `?path=/dir&filename=name` |
| `POST` | `/api/mkdir` | Create directory. Body: `{ path }` |
| `GET` | `/api/stats` | Aggregate stats across all conversations (cached 30s) |
| `GET` | `/api/conversations/:id/export` | Export conversation. Query: `?format=markdown\|json` |
| `POST` | `/api/conversations/:id/upload` | Upload attachment (raw body, `X-Filename` header) |
| `POST` | `/api/conversations/:id/fork` | Fork conversation from message index. Body: `{ fromMessageIndex }` |
| `GET` | `/api/conversations/:id/files` | List files in conversation cwd. Query: `?path=subdir` |
| `GET` | `/api/conversations/:id/files/content` | Get file content as JSON. Query: `?path=file` |
| `GET` | `/api/conversations/:id/files/search` | Git grep search. Query: `?q=pattern` |
| `GET` | `/api/conversations/:id/files/download` | Download file from cwd. Query: `?path=file` |
| `GET` | `/api/capabilities` | List skills/commands/agents. Query: `?cwd=/path` |
| `GET` | `/api/memory` | List memories. Query: `?scope=cwd` |
| `POST` | `/api/memory` | Create memory. Body: `{ text, scope, category?, source? }` |
| `PATCH` | `/api/memory/:id` | Update memory. Body: `{ enabled?, text?, category?, scope }` |
| `DELETE` | `/api/memory/:id` | Delete memory. Query: `?scope=...` |

#### Git Integration Endpoints

All git endpoints operate on the conversation's working directory:

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/conversations/:id/git/status` | Get git status (branch, staged, unstaged, untracked, ahead/behind) |
| `GET` | `/api/conversations/:id/git/branches` | List local and remote branches |
| `POST` | `/api/conversations/:id/git/diff` | Get diff for file. Body: `{ path, staged }` |
| `POST` | `/api/conversations/:id/git/stage` | Stage files. Body: `{ paths: [...] }` |
| `POST` | `/api/conversations/:id/git/unstage` | Unstage files. Body: `{ paths: [...] }` |
| `POST` | `/api/conversations/:id/git/discard` | Discard changes. Body: `{ paths: [...] }` |
| `POST` | `/api/conversations/:id/git/commit` | Create commit. Body: `{ message }` |
| `POST` | `/api/conversations/:id/git/branch` | Create branch. Body: `{ name, checkout? }` |
| `POST` | `/api/conversations/:id/git/checkout` | Checkout branch. Body: `{ branch }` |
| `POST` | `/api/conversations/:id/git/push` | Push to remote |
| `POST` | `/api/conversations/:id/git/pull` | Pull from remote |
| `GET` | `/api/conversations/:id/git/stash` | List stashes |
| `POST` | `/api/conversations/:id/git/stash` | Create stash. Body: `{ message? }` |
| `POST` | `/api/conversations/:id/git/stash/pop` | Pop stash. Body: `{ index }` |
| `POST` | `/api/conversations/:id/git/stash/apply` | Apply stash. Body: `{ index }` |
| `POST` | `/api/conversations/:id/git/stash/drop` | Drop stash. Body: `{ index }` |
| `GET` | `/api/conversations/:id/git/commits` | Get recent commits |
| `GET` | `/api/conversations/:id/git/commits/:hash` | Get single commit diff |
| `POST` | `/api/conversations/:id/git/revert` | Revert commit. Body: `{ hash }` |
| `POST` | `/api/conversations/:id/git/reset` | Reset to commit. Body: `{ hash, mode: soft\|mixed\|hard }` |
| `POST` | `/api/conversations/:id/git/undo-commit` | Undo last commit (soft reset HEAD~1) |

### WebSocket Protocol

**Client → Server:**

| Type | Fields | Description |
|------|--------|-------------|
| `message` | `conversationId`, `text`, `attachments?` | Send user message, spawns Claude process |
| `cancel` | `conversationId` | Kill active process |
| `regenerate` | `conversationId` | Re-generate last assistant response (resets session) |
| `edit` | `conversationId`, `messageIndex`, `text` | Edit message, auto-forks conversation |

**Server → Client:**

| Type | Fields | Description |
|------|--------|-------------|
| `delta` | `conversationId`, `text` | Streaming text chunk |
| `thinking` | `conversationId`, `text` | Extended thinking output |
| `tool_start` | `conversationId`, `tool`, `id?` | Tool execution started |
| `tool_result` | `conversationId`, `toolUseId`, `isError` | Tool execution completed |
| `result` | `conversationId`, `text`, `cost`, `duration`, `sessionId`, `inputTokens`, `outputTokens` | Final complete response |
| `status` | `conversationId`, `status` | `"thinking"` or `"idle"` |
| `error` | `conversationId`, `error` | Error message |
| `stderr` | `conversationId`, `text` | Claude CLI stderr output |
| `edit_forked` | `originalConversationId`, `conversationId`, `conversation` | Edit created a fork, switch to it |

### Model Configuration

```javascript
MODELS = [
  { id: 'opus', name: 'Opus 4.6', context: 200000 },
  { id: 'claude-opus-4.5', name: 'Opus 4.5', context: 200000 },
  { id: 'sonnet', name: 'Sonnet 4.5', context: 200000 },
]
```

---

## Frontend (`public/js/`)

The frontend is split into ES modules for maintainability:

```
public/js/
  app.js           - Entry point, module imports, initialization
  state.js         - Shared mutable state, getters/setters, notifications
  utils.js         - Helper functions (formatTime, haptic, toast, dialog, apiFetch)
  websocket.js     - WebSocket connection management
  render.js        - Message rendering, code blocks, TTS, reactions
  conversations.js - Conversation CRUD, list rendering, swipe/long-press
  ui.js            - UI interactions, event handlers, modals, theme, stats
  markdown.js      - Hand-rolled markdown parser
  file-panel.js    - File browser panel, git status/commits, stash management
  branches.js      - Conversation branch tree visualization
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
currentColorTheme         // 'darjeeling' | 'claude' | 'budapest' | 'moonrise' | 'aquatic'
notificationsEnabled      // Desktop notification preference
pendingMessages[]         // Messages queued while WS disconnected (localStorage-persisted)
allMessages[]             // Full messages array for virtual scroll
messagesOffset            // How many messages rendered from start
collapsedScopes{}         // Which cwd scope groups are collapsed (localStorage-persisted)
memoryEnabled             // Global memory toggle
memories[]                // Current project's memories
```

### Module Dependencies

```
app.js (entry)
  ├── utils.js (pure functions)
  ├── state.js (shared state)
  ├── websocket.js ──► state.js, render.js, conversations.js
  ├── render.js ──► state.js, utils.js, markdown.js
  ├── conversations.js ──► state.js, utils.js, render.js
  ├── ui.js ──► state.js, utils.js, websocket.js, render.js, conversations.js
  ├── file-panel.js ──► state.js, utils.js, markdown.js
  └── branches.js ──► state.js, utils.js, markdown.js
```

### Four Views

The app has four mutually exclusive views, transitioned via CSS transforms:

1. **List View** (`#list-view`) - Conversation browser grouped by working directory (scope), with search, archive toggle, FAB
2. **Chat View** (`#chat-view`) - Message list, input bar, header with controls, file panel
3. **Stats View** (`#stats-view`) - Analytics dashboard
4. **Branches View** (`#branches-view`) - Conversation branch tree visualization
5. **Memory View** (`#memory-view`) - Memory management interface

View transitions use `slide-out` / `slide-in` CSS classes with `transform` + `opacity` animations (350ms cubic-bezier).

### Message Rendering Pipeline

Three phases handle different rendering needs:

1. **`renderMessages()`** - Full re-render when opening a conversation. Maps all messages to HTML, applies markdown, injects TTS/regenerate buttons, renders inline attachment thumbnails, attaches message action handlers (long-press/right-click for edit/copy/fork).

2. **`appendDelta(text)`** - Called on each streaming chunk. Buffers text in `pendingDelta` and schedules a `requestAnimationFrame` flush via `flushDelta()`. This throttles DOM updates to once per frame, eliminating jank on fast streams.

3. **`flushDelta()`** - RAF callback that applies buffered `pendingDelta` to `streamingText`, re-renders markdown, and auto-scrolls.

4. **`finalizeMessage(data)`** - Called on `result` event. Flushes any pending delta, replaces streaming element with final rendered message including metadata (cost, duration, tokens), TTS button, and regenerate button.

### Markdown Renderer (`public/js/markdown.js`)

Hand-rolled parser (no library). Processing order matters:

1. Escape HTML entities
2. Extract code blocks to numbered placeholders (protects from regex)
3. Handle `:::trace` blocks (collapsible tool call sections)
4. Apply inline formatting: code spans, bold, italic
5. Apply block formatting: headers, horizontal rules, lists, links, paragraphs
6. Convert line breaks
7. Restore code blocks from placeholders
8. Clean malformed tags

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
- Shows Pin/Archive/Rename/Branches/Delete options
- Positioned near the touch point

**Bulk selection mode**:
- "Select" button in header enters multi-select mode
- Tap cards to toggle selection
- Bulk action bar appears at bottom (Select All, Archive, Delete)
- Cancel exits selection mode

**Long-press / right-click** (message bubbles):
- 500ms timer triggers message action popup
- User messages: Edit, Copy, Fork options
- Assistant messages: Copy, Remember (save to memory) options
- Edit creates a fork instead of truncating

**Desktop fallback:**
- Right-click opens same context menu as long-press (both cards and messages)

### Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Cmd/Ctrl+K` | Focus search input |
| `Cmd/Ctrl+N` | New conversation |
| `Cmd/Ctrl+E` | Export conversation |
| `Cmd/Ctrl+Shift+A` | Toggle archived view |
| `Escape` | Go back / close modal / close panel |

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

### File Panel (Project Mode)

Slide-in panel for file browsing and git operations:
- **Files Tab**: Browse conversation cwd, search with git grep, view file content
- **Changes Tab**: Git status, stage/unstage, commit, push/pull, stash management
- **History Tab**: Commit history, view diffs, revert, reset, undo commit

Mobile: slides up from bottom with snap points (30%, 60%, 90%)
Desktop: slides in from right as a sidebar with resize handle

### Conversation Branches

Visual tree of forked conversations:
- Triggered from long-press menu or branches button
- SVG-based tree visualization with pan/zoom
- Click nodes to navigate between forks
- Shows fork point (message index) on edges

### Desktop Notifications

- Toggle in settings (more menu)
- Shows when Claude completes a response while tab is hidden
- Updates page title with checkmark when response completes
- Requires HTTPS for Notification API on non-localhost

---

## Service Worker (`public/sw.js`)

**Strategy:** Cache-first for static assets, network-first for selected API routes (offline support), skip other API calls.

**Cached assets:**
- `/`, `/index.html`, `/style.css`, `/manifest.json`, `/lib/highlight.min.js`
- All ES modules in `/js/`: `app.js`, `state.js`, `utils.js`, `websocket.js`, `render.js`, `conversations.js`, `ui.js`, `markdown.js`, `file-panel.js`, `branches.js`
- All CSS files in `/css/`: `base.css`, `layout.css`, `components.css`, `messages.css`, `list.css`, `file-panel.css`, `branches.css`
- All color themes: `themes/darjeeling.css`, `themes/claude.css`, `themes/budapest.css`, `themes/moonrise.css`, `themes/aquatic.css`

**Cached API routes (network-first):**
- `/api/conversations` — enables offline conversation list loading

**Cache versioning:** `claude-chat-v73` - increment the version number to bust caches on deploy.

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
  .top-bar (select mode, files btn, stats btn, archive toggle, more menu)
  #search-bar (input + filter toggle)
  #filter-row (date chips, model dropdown) [collapsible]
  #conversation-list
  #fab (new conversation button)
  #bulk-action-bar (cancel, count, select all, archive, delete)

#action-popup (long-press/right-click menu for conversation cards)
#msg-action-popup (long-press/right-click menu for messages)

#chat-view
  .top-bar (back, name, status dot, mode badge, model selector, branches, memory, files, export, delete, more)
  #context-bar
  #reconnect-banner (shown when WS disconnected)
  #messages (with #load-more-btn for virtual scroll)
  #chat-empty-state (shown when no messages)
  #jump-to-bottom (scroll pill)
  #typing-indicator
  #attachment-preview (queued file thumbnails)
  .input-bar (attach, mic, textarea, send/cancel)
  #file-panel (file browser + git + history)

#stats-view
  .top-bar (back, title)
  #stats-content

#branches-view
  .top-bar (back, title)
  #branches-content

#memory-view
  .top-bar (back, title)
  #memory-content

#new-conversation-modal
  (name, cwd browser, autopilot toggle, model select)

#dialog (custom alert/confirm/prompt replacement)
#lightbox (image viewer)
#file-browser-modal (general file browser)
#capabilities-modal (commands & skills browser)
```

---

## CSS Architecture (`public/css/`)

CSS is split into modular files:

| File | Lines | Purpose |
|------|-------|---------|
| `base.css` | ~82 | CSS variables, resets, base animations |
| `layout.css` | ~620 | Page layout, headers, view transitions |
| `components.css` | ~1070 | Buttons, inputs, modals, toasts, toggles |
| `messages.css` | ~660 | Chat messages, code blocks, attachments |
| `list.css` | ~680 | Conversation list, cards, swipe, bulk selection |
| `file-panel.css` | ~900 | File browser panel, git UI, history |
| `branches.css` | ~150 | Branch tree visualization |

### Color Themes (`public/css/themes/`)

Five swappable color themes:
- **Darjeeling** (default) — Warm earth tones
- **Claude** — Purple accent with neutral grays
- **Budapest** — Grand Budapest Hotel inspired (plum/cream)
- **Moonrise** — Soft moonlit palette
- **Aquatic** — Ocean-inspired blues

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
- **Tool trace blocks**: Collapsible section for tool calls, dimmed appearance
