# High Priority Improvements

## 1. Message Editing & Regeneration

**Problem:** Users can't fix typos or retry a bad response. Messages are append-only.

### Backend (`server.js`)
- Add `PATCH /api/conversations/:id/messages/:index` endpoint to update message text
- Add `POST /api/conversations/:id/regenerate` endpoint that:
  - Removes the last assistant message from `conv.messages`
  - Re-sends the last user message through the existing `handleMessage` flow
  - Resets `conv.claudeSessionId` if needed (since Claude CLI session may be stale)
- Both endpoints call `saveConversation()` after mutation

### Frontend (`public/app.js`)
- Add long-press / right-click on user messages to show "Edit" option
- On edit: replace message bubble with inline `<textarea>`, pre-filled with original text
- On save: PATCH the message, re-render from that point forward
- Add a "Regenerate" button (circular arrow icon) on the last assistant message's `.meta` row
- On regenerate: call the regenerate endpoint, remove last assistant bubble, trigger `setThinking(true)`

### Frontend (`public/style.css`)
- Style the inline edit textarea (match message bubble shape, accent border)
- Style the regenerate button (small icon, same row as TTS button)

### Frontend (`public/index.html`)
- No structural changes needed (dynamically created elements)

---

## 2. Image / File Attachments

**Problem:** Claude CLI supports `--add-image` but the UI has no way to attach files.

### Backend (`server.js`)
- Add `POST /api/conversations/:id/upload` endpoint using `multer` or manual multipart parsing
  - Save files to `data/uploads/{convId}/`
  - Return `{ filename, path, type }`
- In `handleMessage()`, check for `msg.attachments` array
  - For each image attachment, add `--add-image <path>` to the `args` array (line ~453)
  - Store attachment metadata in the user message object: `{ role: 'user', text, attachments: [...] }`
- Add `multer` to dependencies (or use built-in `busboy`)

### Frontend (`public/app.js`)
- Add an attach button next to the mic button in the input bar
- Handle click: open file picker (`accept="image/*,.pdf,.txt,.md,.js,.py,.ts"`)
- Handle paste: listen for `paste` event on `messageInput`, check `clipboardData.files`
- Show thumbnail previews above the input bar when files are queued
- On send: upload files first via the upload endpoint, then send message with attachment references
- In `renderMessages()` and `appendDelta()`: render image thumbnails inline in user messages

### Frontend (`public/index.html`)
- Add attach button markup in the `#input-form` (before mic button)
- Add a `<div id="attachment-preview">` area above the input bar

### Frontend (`public/style.css`)
- Style attachment preview thumbnails (small, rounded, with X to remove)
- Style the attach button (same dimensions as mic button)
- Style inline images in message bubbles (max-width, border-radius, tap to enlarge)

---

## 3. Streaming Render Throttle

**Problem:** `appendDelta()` (app.js:640-653) re-renders full markdown on every single chunk with no debounce. On fast streams this causes visible jank.

### Frontend (`public/app.js`)
- Add a `pendingDelta` buffer and `renderScheduled` flag at the top with other state vars
- Modify `appendDelta()`:
  ```
  // Instead of rendering immediately:
  pendingDelta += text;
  if (!renderScheduled) {
    renderScheduled = true;
    requestAnimationFrame(flushDelta);
  }
  ```
- Add `flushDelta()` function:
  ```
  function flushDelta() {
    renderScheduled = false;
    streamingText += pendingDelta;
    pendingDelta = '';
    streamingMessageEl.innerHTML = renderMarkdown(streamingText);
    enhanceCodeBlocks(streamingMessageEl);
    scrollToBottom();
  }
  ```
- Reset `pendingDelta` and `renderScheduled` in `finalizeMessage()` and `renderMessages()`
- Make sure `finalizeMessage()` flushes any pending delta before finalizing

---

## 4. Stats Endpoint Performance

**Problem:** `/api/stats` (server.js:305-371) loads ALL messages from ALL conversations into memory on every call. Gets slow with many conversations.

### Backend (`server.js`)
- Add an in-memory stats cache object: `let statsCache = null; let statsCacheTime = 0;`
- Cache TTL of 30 seconds (stats don't need to be real-time)
- In the `/api/stats` handler:
  - If `statsCache && Date.now() - statsCacheTime < 30000`, return cached
  - Otherwise compute as before, store in `statsCache`, update `statsCacheTime`
- Invalidate cache (`statsCache = null`) whenever `saveConversation()` is called
- Optional future improvement: maintain incremental stats counters updated on each message save, avoiding the full scan entirely

---

## 5. Conversation Export

**Problem:** No way to get data out of the app. Users want to share conversations or back up their data.

### Backend (`server.js`)
- Add `GET /api/conversations/:id/export?format=markdown` endpoint
  - Load messages via `ensureMessages()`
  - Format as markdown:
    ```
    # {conversation name}

    **Model:** {model} | **Created:** {date}

    ---

    **You:** {message text}

    **Claude:** {message text}

    ---
    ...
    ```
  - Set `Content-Type: text/markdown` and `Content-Disposition: attachment; filename="{name}.md"`
- Also support `format=json`:
  - Return raw conversation object with `Content-Type: application/json`
  - Set `Content-Disposition: attachment; filename="{name}.json"`

### Frontend (`public/app.js`)
- Add "Export" option to the chat header (could be in a "..." overflow menu, or an icon button next to delete)
- On click: show dialog with format choice (Markdown / JSON)
- Trigger download via `window.open('/api/conversations/{id}/export?format=markdown')`

### Frontend (`public/index.html`)
- Add export button in `.chat-header` (or add to an overflow menu if header is getting crowded)

### Frontend (`public/style.css`)
- Style the export button (same pattern as delete button)
