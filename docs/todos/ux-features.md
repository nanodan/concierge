# UX Feature TODOs

## ~~Tab-unfocused completion notification~~ ✅ DONE
**Priority:** High
**Effort:** Low

~~No way to know when a response finishes if the tab is backgrounded.~~ **IMPLEMENTED**

- Native browser notification when response completes
- Title prefix "✓ " when tab is hidden, clears on focus
- Permission requested on first interaction
- User toggle in more menu (Notifications: On/Off)
- Preference persisted to localStorage

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

**Files:** `public/js/ui.js` (new UI), `public/index.html` (modal), `public/css/components.css`, optionally `server.js` (if server-stored)

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

**Files:** `lib/routes.js` (conversation model, PATCH endpoint), `public/js/conversations.js` (renderConversationList, filters), `public/css/list.css`

---

## ~~Batch operations on conversation list~~ ✅ DONE
**Priority:** High
**Effort:** Medium

Multi-select mode for archive/delete. ~~Managing lots of conversations is tedious one-by-one.~~ **IMPLEMENTED**

- "Select" button in header enters multi-select mode
- Tap cards to select/deselect
- Bulk action bar with Select All, Archive, Delete
- Undo delete with 5-second toast

---

## ~~Keyboard shortcuts~~ ✅ DONE
**Priority:** Medium
**Effort:** Medium

~~No keyboard navigation.~~ **IMPLEMENTED**

- `Cmd/Ctrl+K` — focus search
- `Cmd/Ctrl+N` — new conversation
- `Cmd/Ctrl+Shift+A` — toggle archived
- `Cmd/Ctrl+E` — export conversation
- `Escape` — go back / close modal

---

## ~~Pin conversations~~ ✅ DONE
**Priority:** Medium
**Effort:** Low

Pin important conversations to the top of the list. **IMPLEMENTED**

- Long-press menu includes Pin/Unpin option
- Pinned conversations sort to top
- Pin icon displayed on pinned cards

---

## ~~Swipe-to-go-back~~ ✅ DONE
**Priority:** Medium
**Effort:** Low

iOS-style edge swipe to go back from chat view. **IMPLEMENTED**

- Swipe from left edge (30px) triggers back navigation
- Visual feedback during swipe

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

**Files:** `lib/routes.js` (search endpoint params), `public/js/conversations.js` (search UI, result rendering)

---

## ~~Dynamic token limits per model~~ ✅ DONE
**Priority:** Medium
**Effort:** Low

~~Context bar hardcodes `200000` tokens.~~ **IMPLEMENTED**

- Models array already includes `context` field
- `updateContextBar()` reads the active model's context limit
- Context bar shows accurate percentage for each model

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

**Files:** `public/js/ui.js` (settings UI), `public/css/base.css` (ensure all accent usage goes through variable)

---

## Rich export formats
**Priority:** Low
**Effort:** Medium

Only markdown and JSON export currently. HTML with styling and PDF would be more shareable.

**Approach:**
- HTML export: wrap markdown output in a styled template with the app's CSS
- PDF: use a headless browser or a library like `jspdf` (adds dependency)
- Include conversation metadata (model, cost, date) in export header

**Files:** `lib/routes.js` (export endpoint), new template files for HTML export

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

**Files:** `lib/routes.js` (new summarize endpoint), `lib/claude.js` (hook into result handler), `public/js/conversations.js` (display)

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

**Files:** `public/js/ui.js` (new view), `public/index.html` (view markup), `public/css/layout.css`

---

## ~~Message timestamps~~ ✅ DONE
**Priority:** Medium
**Effort:** Low

~~Show exact timestamp when tapping/hovering on messages.~~ **IMPLEMENTED**

- Tap meta info to toggle between relative and full timestamp
- Full timestamp shows: "Wed, Feb 12, 2026, 8:04:32 PM"
- Toggles back to relative on second tap

---

## Search within conversation
**Priority:** Medium
**Effort:** Medium

Cmd+F style search in current chat to find specific messages.

**Approach:**
- Search bar in chat header (toggles with Cmd+F)
- Highlight matching text in messages
- Navigate between matches with up/down arrows
- Show match count

**Files:** `public/js/ui.js`, `public/js/render.js`, `public/css/messages.css`

---

## ~~Per-conversation stats~~ ✅ DONE
**Priority:** Low
**Effort:** Low

~~Show token usage, message count, and cost for each conversation.~~ **IMPLEMENTED**

- Stats button (bar chart icon) in chat header
- Dropdown shows: message count, tokens in/out, total cost
- Calculated from messages array on demand

---

## ~~Image lightbox~~ ✅ DONE
**Priority:** Low
**Effort:** Low

~~Full-screen preview when tapping image attachments.~~ **IMPLEMENTED**

- Tap any image attachment to open fullscreen lightbox
- Dark overlay with centered image
- Download button to save original
- Click overlay or X to close
- Escape key closes lightbox

---

## Starred messages
**Priority:** Low
**Effort:** Medium

Bookmark important messages within conversations for quick reference.

**Approach:**
- Star icon on messages (visible on hover/tap)
- Starred messages view or filter
- Persist in message metadata
- Jump-to-starred navigation

**Files:** `lib/data.js` (message metadata), `public/js/render.js`, `public/css/messages.css`

---

## Better code blocks
**Priority:** Low
**Effort:** Medium

Line numbers, syntax theme matching color theme, improved copy feedback.

**Approach:**
- Optional line numbers (toggle)
- Match syntax highlighting to color theme (darjeeling, budapest, etc.)
- "Copied!" feedback animation on copy button
- Horizontal scroll indicator

**Files:** `public/js/render.js`, `public/css/messages.css`, color theme files

---

## Accessibility audit
**Priority:** Medium
**Effort:** Medium

Ensure all interactive elements have proper ARIA labels and keyboard support.

**Approach:**
- Add aria-label to icon-only buttons
- Ensure focus management in modals
- Screen reader announcements for dynamic content
- Test with VoiceOver/NVDA

**Files:** `public/index.html`, `public/js/*.js`
