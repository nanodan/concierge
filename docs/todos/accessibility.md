# Accessibility TODOs

## Add ARIA labels and roles — PARTIAL ✅
**Priority:** Medium
**Effort:** Medium

~~Semantic HTML is used in places, but ARIA attributes are largely missing.~~

**Done:**
- `aria-label` added to all icon-only buttons (20+ buttons have labels)

**Remaining:**
- Add `role="list"` / `role="listitem"` to conversation list
- Add `aria-live="polite"` to the message container for streaming updates
- Add `aria-expanded` to collapsible scope headers
- Mark modal dialogs with `role="dialog"` and `aria-modal="true"`
- Add `aria-busy="true"` during streaming responses

**Files:** `public/index.html` (static elements), `public/js/*.js` (dynamic elements)

---

## Keyboard focus management — PARTIAL ✅
**Priority:** Medium
**Effort:** Medium

~~Focus isn't trapped in modals, doesn't return to trigger elements on close, and there's no visible focus ring on many interactive elements.~~

**Done:**
- `:focus-visible` styles added to 15+ interactive elements (buttons, cards, toggles)
- Accent-colored focus rings with offset

**Remaining:**
- Trap focus within modals when open (Tab cycles through modal elements)
- Return focus to the triggering element when modal/menu closes
- Ensure all custom controls (swipe actions, long-press menus) have keyboard equivalents

**Files:** `public/css/*.css` (focus styles), `public/js/*.js` (modal open/close, menu handling)

---

## Screen reader announcements
**Priority:** Low
**Effort:** Low

Status changes (connecting, thinking, response complete) aren't announced to screen readers.

**Approach:**
- Add a visually-hidden live region for status announcements
- Announce: "Connecting...", "Claude is thinking...", "Response complete", "Error: ..."
- Announce toast messages via the live region instead of only visually

**Files:** `public/index.html` (live region element), `public/js/websocket.js` (status changes)

---

## Color contrast and theme accessibility
**Priority:** Low
**Effort:** Low

Some UI elements may not meet WCAG AA contrast ratios, especially in light theme.

**Approach:**
- Audit all text/background combinations against WCAG AA (4.5:1 for normal text)
- Pay special attention to: muted text colors, placeholder text, disabled states
- Ensure the accent color (`#7c6cf0`) has sufficient contrast on both dark and light backgrounds
- Add a high-contrast theme option

**Files:** `public/css/base.css`, `public/css/themes/*.css`
