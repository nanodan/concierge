# Coverage Baseline

Last measured with:

```bash
npm run test:coverage
```

## Baseline Snapshot

- Date: 2026-02-28
- Line coverage: `41.79%`
- Branch coverage: `69.55%`
- Function coverage: `51.35%`

## Risk-First Milestones

### Milestone 1: Routes + Providers

Primary targets:

- `lib/routes/conversations.js`
- `lib/routes/files.js`
- `lib/routes/git.js`
- `lib/routes/preview.js`
- `lib/routes/workflow.js`
- `lib/providers/claude.js`
- `lib/providers/codex.js`
- `lib/providers/ollama.js`

Expected outcome:

- Substantially improved backend regression detection on API and provider lifecycle paths.

### Milestone 2: Frontend Core Unit Coverage

Primary targets:

- `public/js/conversations.js`
- `public/js/ui.js`
- `public/js/render.js`
- `public/js/websocket.js`
- `public/js/app.js` (targeted initialization paths)

Expected outcome:

- Core chat/file-panel UI behavior covered by deterministic Node-based unit tests.

## Coverage Commands

```bash
npm run test:coverage
npm run test:coverage -- --top=20
npm run test:coverage -- --line-min=45 --branch-min=65 --func-min=50
```

`test:coverage` exits non-zero if tests fail. Threshold flags are optional and can be used for CI gating.
