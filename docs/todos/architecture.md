# Architecture TODOs

## ~~Break up app.js into modules~~ ✅ DONE
**Priority:** High
**Effort:** High

~~`app.js` is 2039 lines with ~25 top-level state variables.~~ **IMPLEMENTED**

Code has been split into ES modules:
- `state.js` — central state store, getters/setters
- `websocket.js` — WebSocket connection, reconnect, message handling
- `render.js` — DOM rendering, message display
- `conversations.js` — conversation list, CRUD, swipe gestures
- `ui.js` — UI interactions, settings, theme handling
- `utils.js` — utilities, toast, dialog
- `markdown.js` — markdown parsing
- `app.js` — main entry point, initialization

---

## ~~Add consistent error handling~~ ✅ DONE
**Priority:** High
**Effort:** Medium

~~Many fetch calls silently fail. No consistent pattern for showing errors to the user.~~ **IMPLEMENTED**

Created `apiFetch()` wrapper in `utils.js`:
- Checks `res.ok` and extracts error message from `{ error }` response
- Shows toast notification on error with appropriate message
- Returns `null` on error for caller to handle
- Supports `silent: true` option for background operations
- Logs errors to console with URL context

Updated 30+ fetch calls across:
- `conversations.js` — loadConversations, getConversation, createConversation, deleteConversation, archiveConversation, renameConversation, pinConversation, forkConversation, searchConversations
- `ui.js` — file upload, switchModel, browseTo, browseFiles, browseFilesGeneral, loadStats, createFolder, modeBadge toggle
- `file-panel.js` — loadFileTree, viewFile, loadGitStatus, viewDiff, stageFiles, unstageFiles, discardChanges, handleCommit, loadBranches, createBranch, checkoutBranch
- `branches.js` — loadBranchesTree
- `app.js` — loadModels

---

## ~~WebSocket reconnect jitter~~ ✅ DONE
**Priority:** Medium
**Effort:** Low

~~Exponential backoff has no jitter.~~ **IMPLEMENTED**

- Added random jitter: `baseDelay * (0.5 + Math.random())` gives 50-150% of base delay
- Prevents thundering herd on server restart

---

## ~~Add basic test coverage~~ ✅ DONE
**Priority:** Medium
**Effort:** High

~~Zero tests currently.~~ **IMPLEMENTED**

Test files created using Node.js built-in test runner:
- `test/server.test.js` — convMeta, atomicWrite, processStreamEvent
- `test/claude.test.js` — stream event handling, tool calls, thinking, tokens
- `test/data.test.js` — data layer, stats cache
- `test/markdown.test.js` — markdown rendering, XSS prevention
- `test/utils.test.js` — formatTime, formatTokens, truncate

Run with `npm test`.

---

## localStorage versioning
**Priority:** Low
**Effort:** Low

Offline messages, unread convs, theme, collapsed scopes all stored in localStorage with no schema versioning. If the schema changes, old data silently becomes garbage.

**Approach:**
- Add a `schemaVersion` key to localStorage
- On app load, check version and migrate if needed
- Write migration functions for each version bump
- Clear stale keys that are no longer used

**Files:** `public/js/app.js` (initialization)
