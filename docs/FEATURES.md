# Feature Catalog

This file is the canonical, user-facing feature inventory for Concierge.

For implementation details and API shape, see:
- `docs/ARCHITECTURE.md`
- `docs/REFERENCE.md`

## AI Chat and Providers

- Multi-provider chat: Claude CLI, OpenAI Codex CLI, and Ollama.
- Streaming responses over WebSocket (`delta`, `thinking`, `tool_start`, `tool_result`, `result`).
- Conversation-scoped provider/model selection.
- File attachments in prompts.
- Cancel active generation.
- Regenerate last assistant response.
- Edit and resend flows that auto-fork when not at the tip.

## Conversation Management

- Create, rename, archive, pin, and delete conversations.
- Bulk archive/delete from list selection mode.
- Undo for single-conversation delete.
- Keyword search and semantic search (local embeddings).
- Branch/fork tree visualization.
- Context compression for long threads.
- Conversation families grouped by working directory.

## Fork Workspaces and Worktrees

- Fork into the same working directory.
- Fork into a dedicated Git worktree to isolate file changes.
- Worktree-aware UI badges in list/chat/branches views.

## Files and Project Workspace

- Conversation-scoped file browser for project `cwd`.
- Standalone cwd-scoped files view (same explorer shell modules).
- File upload and download.
- Git-backed code search (`git grep`) in project files.
- File tree refresh control.
- Open-file refresh via Files refresh and map-specific refresh control.
- Prev/next navigation between viewable files.

## File Preview Types

- Text/code with language-aware highlighting.
- Markdown.
- JSON.
- CSV/TSV table preview.
- Parquet table preview.
- Jupyter notebooks (`.ipynb`) with outputs.
- Images (inline).
- GeoJSON-compatible map previews (GeoJSON, JSONL, NDJSON, and JSON containing GeoJSON payloads).

## Geospatial Map Viewer

- Map/Raw toggle.
- Basemap switcher.
- Thematic styling (color/size fields).
- Feature list with focus selection.
- Hover metadata popups.
- Fit-to-bounds control.
- Refresh button to reload map source from disk.

## Data Analysis (DuckDB + BigQuery)

- DuckDB file loading (`csv`, `tsv`, `json`, `parquet`) and query execution.
- DuckDB table list/drop and file profiling.
- DuckDB exports (`csv`, `json`, `parquet`).
- BigQuery ADC auth status/refresh.
- BigQuery project ID input (manual entry).
- BigQuery async query start/status/cancel.
- BigQuery query history dropdown.
- BigQuery preview pagination via page tokens (`Prev`/`Next`).
- BigQuery full-result exports to browser download or conversation project `cwd` save.
- BigQuery export formats: `csv`, `json`, `parquet`, `geojson` (when geo-compatible columns are detected).

## Git Workflows

- Status for staged/unstaged/untracked/ahead-behind.
- Stage/unstage/discard.
- Commit, push, pull.
- Branch create/switch/list.
- Stash list/create/pop/apply/drop.
- Commit history and single-commit diff.
- Revert commit, reset to commit, undo last commit.
- Granular hunk actions (accept/reject style operations).

## Memory and Context

- Global and project-scoped memory records.
- Enable/disable and edit memories.
- "Remember" from message context.
- Per-conversation memory usage toggle.

## Live Web Preview

- Start/stop preview server per conversation.
- Open preview in external tab.
- Inline iframe preview mode.
- Fit/actual sizing modes.
- Inline preview refresh control.
- Multi-file selector for HTML entry points.

## Workflow Coordination

- Conversation execution modes (`discuss`, `patch`, `autonomous`).
- Per-cwd writer lock acquire/heartbeat/release.
- Patch queue submit/list/apply/reject APIs.

## UX, Accessibility, and Platform

- Mobile gestures: swipe-to-reveal, swipe-back, long-press menus.
- Desktop keyboard shortcuts (`Cmd/Ctrl+K`, `Cmd/Ctrl+N`, `Cmd/Ctrl+E`, `Cmd/Ctrl+Shift+A`, `Escape`).
- Resizable file panel on desktop.
- Voice input (Web Speech API, HTTPS required for non-localhost).
- Text-to-speech playback for assistant messages.
- Theme system with multiple palettes and light/dark modes.
- PWA installability and offline shell caching.
- Offline message queue with reconnect flush.

## Security and Environment

- Sandboxed execution defaults for provider CLI flows.
- Optional unsandboxed/autonomous execution settings.
- HTTPS auto-enable when certs are present.
- Tailscale-friendly remote access pattern.

## Current Behavior Notes

- BigQuery result table previews are paginated and fetch up to 1,000 rows per page.
- BigQuery full-result exports are bounded by `BIGQUERY_EXPORT_MAX_ROWS` (0 disables the cap).
- TopoJSON files are detected but currently fall back to non-map preview paths.
- File changes on disk are not watched live; use refresh controls in Files/Map views.
