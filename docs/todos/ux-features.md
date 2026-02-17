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

## ~~Live code preview~~ ✅ DONE
**Priority:** High
**Effort:** Medium

~~Render HTML/CSS/JS code blocks live as Claude streams them.~~ **IMPLEMENTED**

- "Preview" button on HTML/JSX/SVG code blocks
- Opens sandboxed iframe modal with live render
- Supports React and Tailwind via CDN
- Works during streaming (updates as code completes)

---

## Diff review UI
**Priority:** High
**Effort:** High

When Claude edits a file, show a GitHub-style diff with accept/reject per hunk instead of just "Using Edit".

**Why:** Massive trust improvement. Users see exactly what Claude wants to change and can approve granularly. Human-in-the-loop at the right level of detail.

**Approach:**
- Intercept `tool_start` events for Edit tool
- Fetch the file's current content via existing file API
- When tool completes, compute diff between old and new content
- Render split or unified diff view with per-hunk accept/reject buttons
- "Accept All" / "Reject All" for quick actions
- On reject: need to communicate back to Claude (or just revert the file)

**UI options:**
- Inline in chat stream (expanding panel)
- Modal overlay with full diff view
- Side panel (reuse file panel slot)

**Challenges:**
- Edit tool may have already applied the change by the time we see it
- Need to capture "before" state when tool starts, "after" when it completes
- Rejecting changes mid-stream could confuse Claude's state
- May need `--confirm-edits` flag in Claude CLI (if it exists) or custom wrapper

**Files:** `public/js/render.js` (diff rendering), `lib/claude.js` (capture before/after), `lib/routes.js` (file content endpoint), `public/css/messages.css` (diff styling)

---

## ~~Screenshot-to-code~~ ✅ DONE
**Priority:** High
**Effort:** Medium

~~Paste or upload a screenshot, Claude analyzes it and generates code, live preview shows the result materializing.~~ **IMPLEMENTED**

- Paste images directly into chat (Cmd+V)
- Upload images as attachments via existing infrastructure
- Claude vision analyzes screenshots and generates matching code
- Live preview renders the result as it streams

---

## Voice-to-voice conversation
**Priority:** High
**Effort:** High

Real-time bidirectional voice conversation with Claude. Speak naturally, hear responses as they stream.

**Why:** Transformative UX. Pair programming by voice while walking, cooking, or away from keyboard. No typing, no reading.

**Current state:**
- Voice input exists (SpeechRecognition API, tap mic to dictate)
- TTS exists (SpeechSynthesis API, tap speaker to read response)
- Both are manual, sequential actions

**Approach:**
- "Voice mode" toggle in chat header
- Hold-to-talk or voice activity detection
- Stream transcription as user speaks (show interim results)
- On speech end, send message automatically
- Stream TTS as Claude responds (don't wait for full response)
- Use Web Speech API for browser-native, or consider Whisper API for better accuracy

**Challenges:**
- Interruption handling: user starts speaking while Claude is talking
- Background noise filtering / voice activity detection
- Latency: transcription + Claude + TTS adds up
- Mobile browser support varies for continuous speech recognition

**Nice to have:**
- Conversation pace controls (speed up TTS)
- "Repeat that" command
- Audio waveform visualization
- Push-to-talk hardware button support

**Files:** `public/js/voice.js` (new module for voice mode), `public/js/ui.js` (voice mode toggle), `public/js/render.js` (auto-TTS on response), `public/css/components.css` (voice mode UI)

---

## ~~Context visualization + auto-compression~~ ✅ DONE
**Priority:** High
**Effort:** High

~~Show accurate context window usage with breakdown, and automatically compress conversations when nearing the limit.~~ **IMPLEMENTED**

- Click context bar to see token breakdown (system prompt, memories, conversation)
- "Compress conversation" button appears at 50%+ context usage
- At 85% context, auto-compression prompt appears
- Compression summarizes older messages via Claude CLI and starts fresh session
- Compressed messages hidden by default but expandable
- `POST /api/conversations/:id/compress` endpoint
- Compression history tracked in conversation metadata

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
