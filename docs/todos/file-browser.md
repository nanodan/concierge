# File Browser TODOs

## ~~File upload~~ ✅ DONE
**Priority:** High
**Effort:** Medium

~~Allow uploading files from phone to any directory on the server.~~ **IMPLEMENTED**

- Upload button in file browser header
- `uploadToFileBrowser()` function handles uploads
- Works in both conversation attachments and general filesystem mode
- `POST /api/files/upload?path=&filename=` endpoint
- Success toast on upload completion

---

## Quick actions (delete, rename, move)
**Priority:** Medium
**Effort:** Medium

Add context menu or swipe actions on files for common operations.

**Approach:**
- Long-press/right-click on file shows action popup (similar to conversation cards)
- Actions: Delete, Rename, Copy path
- Confirmation dialog for destructive actions
- Add corresponding API endpoints

**Files:** `lib/routes.js`, `public/js/ui.js`, `public/index.html`

---

## Recent files view
**Priority:** Medium
**Effort:** Medium

Show recently modified files across all directories for quick access.

**Approach:**
- Add "Recent" tab/toggle in file browser
- API endpoint that scans recent files (configurable depth/limit)
- Sort by mtime, show relative path
- Could also track files Claude has created/modified

**Files:** `lib/routes.js`, `public/js/ui.js`

---

## Text file editing
**Priority:** Medium
**Effort:** Medium-High

Open and edit text files directly in a modal editor.

**Approach:**
- Click text file opens in editor modal instead of new tab
- Simple textarea or lightweight code editor (CodeMirror/Monaco)
- Save button writes back via API
- Syntax highlighting for common file types

**Files:** `lib/routes.js` (add PUT endpoint), `public/js/ui.js`, `public/index.html`, `public/css/components.css`

---

## ~~Image preview thumbnails~~ ✅ DONE
**Priority:** Low
**Effort:** Low

~~Show image thumbnails inline in the file browser instead of generic icon.~~ **IMPLEMENTED**

- Image files show actual thumbnail instead of icon
- Uses `object-fit: cover` for consistent sizing
- Lazy loading with `loading="lazy"` attribute
- Works in both file browser modal and file tree panel

---

## ~~Open files in new tab~~ ✅ DONE
**Priority:** Low
**Effort:** Low

~~Allow opening files in a new browser tab for direct viewing/rendering.~~ **IMPLEMENTED**

- All text files show floating "Open in new tab" button in file viewer
- HTML files render in browser when opened in new tab
- Button styled consistently with image full-size button
- Fixed position with safe area insets for iOS

---

## iOS share sheet integration
**Priority:** Low
**Effort:** Medium

Receive files from iOS share sheet to upload to server.

**Approach:**
- Register as share target in manifest.json
- Handle shared files via Web Share Target API
- Show directory picker for upload destination
- Works for photos, screenshots, documents

**Files:** `public/manifest.json`, `public/js/app.js`, `lib/routes.js`

---

## Create new file
**Priority:** Low
**Effort:** Low

Create empty files or files from templates.

**Approach:**
- "New file" button in file browser
- Prompt for filename
- Optional: template selection (empty, .js, .py, .md, etc.)
- Opens in editor after creation

**Files:** `lib/routes.js`, `public/js/ui.js`
