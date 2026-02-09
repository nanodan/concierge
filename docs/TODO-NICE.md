# Nice-to-Have Improvements

## 11. Conversation Folders / Tags

**Problem:** No way to organize conversations beyond archive/active.

### Backend (`server.js`)
- Add `tags` field to conversation metadata (array of strings): `tags: []`
- Update `convMeta()` to include `tags`
- Update `PATCH /api/conversations/:id` to accept `tags` array
- Add `GET /api/tags` endpoint that returns all unique tags across conversations with counts
- Update search to support `tag` query param filter

### Frontend (`public/app.js`)
- Add tag chips below each conversation card's preview text
- Add tag filter bar at the top of conversation list (horizontal scroll of tag chips)
- In the long-press/right-click context menu, add "Tag" action that shows a tag picker dialog
- Tag picker: shows existing tags as checkboxes + a text input to create new tags

### Frontend (`public/style.css`)
- Style tag chips (small, rounded pill, muted color per tag)
- Style tag filter bar (horizontal scroll, active state for selected tags)

---

## 12. Prompt Library

**Problem:** No saved/reusable prompts or templates.

### Backend (`server.js`)
- Add a separate `prompts.json` data file in `data/`
- `GET /api/prompts` - list all saved prompts
- `POST /api/prompts` - create prompt `{ title, text, tags? }`
- `DELETE /api/prompts/:id` - delete a prompt
- `PATCH /api/prompts/:id` - update a prompt

### Frontend (`public/app.js`)
- Add a "Prompts" button in the input bar (bookmark icon or lightning bolt)
- On click: show a sheet/modal listing saved prompts
- Tap a prompt: insert its text into the message input
- Long-press a prompt: edit or delete it
- "Save as prompt" option: long-press on a sent user message to save it

### Frontend (`public/index.html`)
- Add prompt library modal markup
- Add prompt button in input bar

### Frontend (`public/style.css`)
- Style prompt list (similar to conversation list cards, but more compact)
- Style the "save as prompt" action

---

## 13. Conversation Forking

**Problem:** Can't branch from a point in conversation to try different approaches.

### Backend (`server.js`)
- Add `POST /api/conversations/:id/fork` endpoint
  - Accepts `{ fromMessageIndex }`
  - Creates a new conversation with:
    - Same `cwd`, `model`, `autopilot` settings
    - Messages copied up to `fromMessageIndex`
    - New `claudeSessionId: null` (fresh Claude session)
    - Name: `"{original name} (fork)"`
  - Returns the new conversation

### Frontend (`public/app.js`)
- Add "Fork from here" to long-press menu on messages
- On fork: call the endpoint, then navigate to the new conversation
- Show a toast: "Forked conversation"

---

## 14. Accessibility Improvements

**Problem:** Missing ARIA labels, no focus trapping in modals, no live regions for streaming content.

### Frontend (`public/index.html`)
- Add `role="dialog"` and `aria-modal="true"` to `#modal-overlay .modal` and `#dialog-overlay .dialog`
- Add `aria-label` to interactive elements missing them:
  - `#mode-badge` -> `aria-label="Toggle autopilot mode"`
  - `#model-btn` -> `aria-label="Change model"`
  - `#context-bar` -> `aria-label="Context window usage"`
- Add `aria-live="polite"` to `#messages` for screen reader announcements of new messages
- Add `aria-live="assertive"` to `#toast-container` for toast announcements
- Add `role="status"` to `#typing-indicator`

### Frontend (`public/app.js`)
- Add focus trapping in modals:
  - When modal opens, find all focusable elements inside
  - On Tab: cycle through them; on Shift+Tab: cycle backwards
  - On Escape: close modal
- Add `aria-expanded` to `#model-btn` that toggles with dropdown visibility

### Frontend (`public/style.css`)
- Add visible focus indicators: `:focus-visible` outlines on all interactive elements
  ```
  :focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  ```
- Ensure contrast ratios meet WCAG AA (4.5:1 for normal text)
  - `--text-secondary` (#a8a3a0) on `--bg` (#1c1c1e) is borderline; may need to lighten to #b8b3b0

---

## 15. Offline Queue

**Problem:** Messages are lost when the WebSocket disconnects. No offline resilience.

### Frontend (`public/app.js`)
- Maintain a queue in `localStorage`: `offlineQueue`
- When sending a message and WS is not open:
  - Add to `offlineQueue` with `{ conversationId, text, timestamp }`
  - Show the message in the UI with a "pending" indicator (clock icon in meta)
  - Show toast: "Message queued - will send when reconnected"
- On WS reconnect (`ws.onopen`):
  - Read `offlineQueue` from localStorage
  - Send each message in order with a small delay between them
  - Update UI: remove "pending" indicator as each is sent
  - Clear queue from localStorage as messages are confirmed sent
- Mark queued messages visually distinct (slightly transparent, clock icon)

### Frontend (`public/style.css`)
- Style pending message indicator (opacity, clock icon in meta)
- Style the "offline" banner (shown when WS is disconnected)

### Service Worker (`public/sw.js`)
- Cache the API response for conversation list so the app loads even offline
- Show cached conversations when offline (read-only mode)
