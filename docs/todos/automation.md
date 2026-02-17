# Automation TODOs

## Trigger System
**Priority:** High
**Effort:** High

Automatically start Claude conversations when events occur. Turn the app into a CI/CD-style automation platform for Claude Code.

**Trigger types:**

| Type | Example | Implementation |
|------|---------|----------------|
| Git hook | "On push to main, review the diff" | Shell script in `.git/hooks/` calls server API |
| File watcher | "When tests fail, fix them" | `chokidar` or `fs.watch` on cwd |
| Schedule | "Every morning, check for outdated deps" | `node-cron` or system cron |
| Webhook | "When GitHub issue created, triage it" | REST endpoint triggers conversation |
| Manual queue | "Run these 5 prompts sequentially" | Task queue in UI |

**MVP Approach:**
1. Add `POST /api/trigger` endpoint that:
   - Accepts `{ conversationId?, prompt, cwd?, name? }`
   - Creates or reuses a conversation
   - Spawns Claude with the prompt
   - Returns immediately (agent runs in background)
2. Add trigger management UI:
   - List configured triggers
   - Create/edit/delete triggers
   - View trigger history (when fired, result)
3. Store trigger configs in `data/triggers.json`

**Later:**
- Conditional triggers ("only if tests fail")
- Chained triggers ("after A completes, run B")
- Trigger templates (pre-built common workflows)
- Dashboard showing all active/recent trigger runs

**Files:** `lib/routes.js` (trigger endpoint), `lib/triggers.js` (new module), `public/js/triggers.js` (UI), `data/triggers.json`

---

## ~~Parallel Conversations~~ ✅ DONE
**Priority:** Medium
**Effort:** Medium

~~Run multiple Claude conversations simultaneously.~~ **IMPLEMENTED**

- Multiple conversations can run Claude processes simultaneously
- Progress indicator on conversation cards when Claude is working
- Can switch between conversations while responses stream

---

## Task Queue
**Priority:** Medium
**Effort:** Medium

Queue multiple prompts to run sequentially in a conversation. "Do A, then B, then C" without manual intervention.

**Approach:**
- Queue UI in chat view (add prompts to queue)
- Server processes queue items sequentially
- Show queue status (pending, running, completed)
- Allow reordering, canceling queued items
- Option to stop on first error or continue

**Files:** `lib/queue.js` (new module), `server.js` (queue processing), `public/js/ui.js` (queue UI)

---
