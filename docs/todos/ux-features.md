# UX Feature TODOs

## Tab-unfocused completion notification
**Priority:** High
**Effort:** Low

No way to know when a response finishes if the tab is backgrounded.

**Approach:**
- Use `Notification API` when response completes and `document.hidden === true`
- Request permission on first use
- Fallback: update `document.title` with a prefix like "(done)" and revert on focus
- Respect a user preference toggle

**Files:** `public/app.js` (finalizeMessage, handleResult)

---

## Prompt templates / quick-send library
**Priority:** High
**Effort:** Medium

Save and reuse frequently-used prompts. Big time-saver for repetitive workflows.

**Approach:**
- Store templates in localStorage or as a server-side JSON file
- UI: button near the message input to open a template picker
- Support variables/placeholders (e.g. `{{filename}}`) that prompt before sending
- Allow creating templates from sent messages (long-press → "Save as template")

**Files:** `public/app.js` (new UI), `public/index.html` (modal), `public/style.css`, optionally `server.js` (if server-stored)

---

## Conversation tags and favorites
**Priority:** High
**Effort:** Medium

Star or tag conversations for quick access. Scope-based grouping alone isn't enough for heavy users.

**Approach:**
- Add `tags: string[]` and `starred: boolean` fields to conversation metadata
- Filter/sort by tags in the conversation list
- UI: star icon on conversation cards, tag editor in long-press menu
- Add tag filter chips above the conversation list

**Files:** `server.js` (conversation model, PATCH endpoint), `public/app.js` (renderConversationList, filters), `public/style.css`

---

## Batch operations on conversation list
**Priority:** High
**Effort:** Medium

Multi-select mode for archive/delete. Managing lots of conversations is tedious one-by-one.

**Approach:**
- Long-press or checkbox toggle enters multi-select mode
- Floating action bar appears with archive/delete/tag buttons
- Batch API endpoint: `POST /api/conversations/batch` with `{action, ids}`
- Select all / deselect all buttons

**Files:** `server.js` (new batch endpoint), `public/app.js` (selection state, UI), `public/style.css`

---

## Keyboard shortcuts
**Priority:** Medium
**Effort:** Medium

No keyboard navigation. Desktop experience suffers.

**Approach:**
- `Ctrl/Cmd+K` — focus search
- `Escape` — go back / close modal
- `Ctrl/Cmd+N` — new conversation
- `Up/Down` arrows — navigate conversation list
- `Enter` — open selected conversation
- `Ctrl/Cmd+Shift+Backspace` — delete conversation (with confirm)
- Show shortcut hints in a help modal (`?` key)

**Files:** `public/app.js` (global keydown handler), `public/index.html` (help modal)

---

## Improved search UX
**Priority:** Medium
**Effort:** Medium

Search could be much more useful with filtering and better result display.

**Approach:**
- Filter by message role (user-only, assistant-only)
- Filter by cost range
- Show multiple match snippets per conversation, not just the first
- Highlight matched terms in results
- Regex support (toggle)
- Loading spinner during search API call

**Files:** `server.js` (search endpoint params), `public/app.js` (search UI, result rendering)

---

## Dynamic token limits per model
**Priority:** Medium
**Effort:** Low

Context bar hardcodes `200000` tokens. Should reflect actual model limits.

**Approach:**
- `/api/models` endpoint already exists — add `context_window` to each model's data
- Frontend reads the limit for the active model
- Update context bar percentage calculation accordingly

**Files:** `server.js` (GET /api/models), `public/app.js` (context bar update logic)

---

## Accent color customization
**Priority:** Low
**Effort:** Low

Only purple (`#7c6cf0`) right now. Users may want to personalize.

**Approach:**
- Add color picker in settings (or preset palette)
- Store choice in localStorage
- Override `--accent` CSS variable at runtime
- Derive related colors (hover, muted) programmatically from the chosen accent

**Files:** `public/app.js` (settings UI), `public/style.css` (ensure all accent usage goes through variable)

---

## Rich export formats
**Priority:** Low
**Effort:** Medium

Only markdown and JSON export currently. HTML with styling and PDF would be more shareable.

**Approach:**
- HTML export: wrap markdown output in a styled template with the app's CSS
- PDF: use a headless browser or a library like `jspdf` (adds dependency)
- Include conversation metadata (model, cost, date) in export header

**Files:** `server.js` (export endpoint), new template files for HTML export

---

## Conversation auto-summarization
**Priority:** Low
**Effort:** Medium-High

Auto-generate a summary of long conversations for quick reference.

**Approach:**
- After N messages, offer to summarize via a lightweight Claude call
- Store summary in conversation metadata
- Show summary on conversation card hover or in detail view
- Could also extract key decisions/action items

**Files:** `server.js` (new summarize endpoint or hook into result handler), `public/app.js` (display)

---

## Side-by-side conversation comparison
**Priority:** Low
**Effort:** High

Compare two conversations or responses to the same prompt across models.

**Approach:**
- New view: split-pane with two conversation renders
- Conversation picker for each side
- Optional diff highlighting for similar messages
- Useful for model comparison workflows

**Files:** `public/app.js` (new view), `public/index.html` (view markup), `public/style.css`
