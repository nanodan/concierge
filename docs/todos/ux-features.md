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

## Live code preview
**Priority:** High
**Effort:** Medium

Render HTML/CSS/JS code blocks live as Claude streams them. Watch a webpage materialize in real-time.

**Approach:**
- Detect `html`, `jsx`, or `svg` code fences during streaming
- MVP: "Preview" button appears on completed code blocks, opens modal with sandboxed iframe
- V2: Split pane with live preview updating as tokens stream (debounced 500ms)
- Handle partial code gracefully (render last-valid-state, swallow errors)
- Bundle common dependencies in preview frame (React CDN, Tailwind CDN)
- Reuse file panel slot on desktop, or floating modal on mobile

**Challenges:**
- Mid-stream HTML is invalid — either wait for block close or heuristically close tags
- Multiple code blocks — preview most recent, or show tabs
- Security — iframe sandbox attribute for isolation

**Files:** `public/js/render.js` (code block detection, preview button), `public/js/ui.js` (preview modal/panel), `public/css/messages.css` (preview styling)

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

## Screenshot-to-code
**Priority:** High
**Effort:** Medium

Paste or upload a screenshot, Claude analyzes it and generates code, live preview shows the result materializing.

**Why:** Magical demo. Combines vision + code generation + live preview. "I want this" → watch it appear.

**Approach:**
- Extend existing file upload to handle paste events (Cmd+V with image)
- Upload image as attachment (existing infrastructure)
- Prompt template: "Recreate this UI in HTML/CSS. Match the layout, colors, and typography as closely as possible."
- Stream response into live preview pane (builds on live preview TODO)
- Side-by-side: original screenshot | live rendered result

**Enhancements:**
- "Make it responsive" follow-up button
- "Use Tailwind" / "Use vanilla CSS" toggle
- Iterate: "Make the button bigger" with image context retained

**Files:** `public/js/ui.js` (paste handler, screenshot mode UI), `public/js/render.js` (side-by-side preview), existing upload infrastructure

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

## Context visualization + auto-compression
**Priority:** High
**Effort:** High

Show accurate context window usage with breakdown, and automatically compress conversations when nearing the limit.

**Why:** Users don't know if Claude "remembers" old messages. Hitting context limits causes errors. Transparency + automatic handling = magic.

### Part 1: Accurate Context Tracking

**Current state:**
- Context bar shows `inputTokens + outputTokens` from last response
- `inputTokens` from Claude API = full context sent that turn (system + history + message)
- So last turn's input tokens ≈ current context usage (already close!)

**Improvements needed:**
- Show breakdown: system prompt, memories, conversation, files read
- Track files read per turn (from `tool_start` events for Read/Glob/Grep)
- Estimate system prompt size (base + memories text length * ~1.3 tokens/word)
- Show "oldest message in context" indicator

**UI:**
```
┌─────────────────────────────────────────────────┐
│ Context: 127,000 / 200,000 tokens               │
│ ██████████████████░░░░░░░░░░░░░░░░░░░░░░ 64%   │
├─────────────────────────────────────────────────┤
│ 📄 System prompt        12,400 tokens           │
│ 🧠 Memories (7 active)   1,200 tokens           │
│ 💬 Conversation          98,000 tokens          │
│    └─ 142 messages (oldest: 3 days ago)         │
│ 📁 Files read this turn  15,400 tokens          │
│    ├─ server.js (4,200)                         │
│    ├─ routes.js (8,100)                         │
│    └─ data.js (3,100)                           │
├─────────────────────────────────────────────────┤
│ [Compress conversation]                         │
└─────────────────────────────────────────────────┘
```

- Click context bar to expand breakdown panel
- File list extracted from tool calls in current turn
- Token estimates for files: `fileSize * 0.25` (rough chars-to-tokens)

### Part 2: Auto-Compression

**Problem:** Claude CLI's `--resume` loads full session history. We can't modify its internal context. Headless mode doesn't auto-compact.

**Solution:** "Soft fork" — same conversation, new Claude session with compressed history.

**Trigger:** At 80% context usage, show warning. At 90%, prompt to compress.

**Compression flow:**
1. User clicks "Compress" (or auto-triggered at threshold)
2. Backend calls Claude with compression prompt:
   ```
   Summarize this conversation history in ~2000 tokens, preserving:
   - Key decisions made
   - Important code/files discussed
   - Current task state
   - Any commitments or action items

   History:
   [first 50% of messages]
   ```
3. Create new Claude session (no --resume)
4. First message to new session:
   ```
   [CONTEXT SUMMARY - This conversation was compressed]

   {summary}

   [RECENT MESSAGES - Full detail follows]

   {last 50% of messages, formatted as history}
   ```
5. Update conversation: `claudeSessionId = newSessionId`
6. Frontend shows "Conversation compressed" toast with before/after token counts

**Data model changes:**
- Add `compressions: [{ timestamp, oldSessionId, messagesSummarized, tokensSaved }]` to conversation
- Add `summarized: true` flag to messages that were compressed
- Keep original messages in storage (for history), but mark them

**Backend changes:**
- New endpoint: `POST /api/conversations/:id/compress`
- New function in `lib/claude.js`: `compressSession(conversationId, threshold)`
- Compression prompt template in `lib/compression-prompt.txt`

**Frontend changes:**
- Expand context bar on click to show breakdown
- "Compress now" button in expanded view
- Auto-prompt modal at 90% threshold
- "Compressed" indicator on old messages (collapsed by default)
- Settings: auto-compress threshold (off / 80% / 90%)

**Challenges:**
- Compression quality: summary must preserve critical context
- Session continuity: Claude loses some nuance from old messages
- Multiple compressions: conversation could be compressed multiple times
- Cost: compression requires a Claude call (~$0.05-0.10)

**Nice to have:**
- "Expand compressed messages" to see original history
- Compression preview: show what will be summarized before confirming
- Selective compression: choose which messages to keep in full

**Files:**
- `lib/claude.js` — compression logic, session management
- `lib/routes.js` — `/api/conversations/:id/compress` endpoint
- `lib/compression-prompt.txt` — new file, prompt template
- `server.js` — WebSocket event for compression status
- `public/js/ui.js` — expanded context panel, compression UI
- `public/js/render.js` — compressed message indicators
- `public/css/components.css` — context breakdown styling

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
