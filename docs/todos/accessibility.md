# Accessibility TODOs

## Add ARIA labels and roles
**Priority:** Medium
**Effort:** Medium

Semantic HTML is used in places, but ARIA attributes are largely missing.

**Approach:**
- Add `role="list"` / `role="listitem"` to conversation list
- Add `aria-label` to icon-only buttons (settings, new chat, back, voice, etc.)
- Add `aria-live="polite"` to the message container for streaming updates
- Add `aria-expanded` to collapsible scope headers
- Mark modal dialogs with `role="dialog"` and `aria-modal="true"`
- Add `aria-busy="true"` during streaming responses

**Files:** `public/index.html` (static elements), `public/app.js` (dynamic elements)

---

## Keyboard focus management
**Priority:** Medium
**Effort:** Medium

Focus isn't trapped in modals, doesn't return to trigger elements on close, and there's no visible focus ring on many interactive elements.

**Approach:**
- Trap focus within modals when open (Tab cycles through modal elements)
- Return focus to the triggering element when modal/menu closes
- Add visible focus indicators (`:focus-visible` styles) for all interactive elements
- Ensure all custom controls (swipe actions, long-press menus) have keyboard equivalents

**Files:** `public/style.css` (focus styles), `public/app.js` (modal open/close, menu handling)

---

## Screen reader announcements
**Priority:** Low
**Effort:** Low

Status changes (connecting, thinking, response complete) aren't announced to screen readers.

**Approach:**
- Add a visually-hidden live region for status announcements
- Announce: "Connecting...", "Claude is thinking...", "Response complete", "Error: ..."
- Announce toast messages via the live region instead of only visually

**Files:** `public/index.html` (live region element), `public/app.js` (status changes)

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

**Files:** `public/style.css`
