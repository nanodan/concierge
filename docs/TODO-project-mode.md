# Project Mode - TODO

## Completed

- [x] File browser (navigate conversation's working directory)
- [x] Git status view (staged/unstaged/untracked files)
- [x] Diff viewer (view changes with syntax highlighting)
- [x] Stage/unstage files (individual and "Stage All")
- [x] Commit with message
- [x] Branch switching
- [x] Create new branch
- [x] Discard changes
- [x] Desktop resize (drag to resize panel width)
- [x] Mobile-friendly UI (tabs, bottom sheet, consolidated menus)

---

## High Priority (Core Workflow)

### Push/Pull
- [x] Push commits to remote
- [x] Pull latest changes from remote
- [x] Show ahead/behind count in branch selector
- [x] Handle push failures (non-fast-forward, auth errors)

### Commit History
- [x] View recent commits (hash, message, author, date)
- [x] Click commit to view its diff
- [x] Show commit count since last push

### File Search
- [x] Search/grep across project files
- [x] Show results with file path and line number
- [x] Click result to open file at that line

---

## Medium Priority (Nice to Have)

### Stash
- [x] Stash uncommitted changes
- [x] View stash list
- [x] Pop/apply stash
- [x] Drop stash

### Revert/Reset
- [ ] Revert a specific commit
- [ ] Reset to a previous commit (soft/mixed/hard)
- [ ] Undo last commit (keep changes staged)

### Conflict Resolution
- [ ] Detect merge conflicts
- [ ] Visual conflict editor (ours/theirs/both)
- [ ] Mark conflicts as resolved

---

## Lower Priority (Advanced)

### Git Blame
- [ ] Show blame annotations in file viewer
- [ ] See who changed each line and when

### Tags
- [ ] View existing tags
- [ ] Create new tag
- [ ] Push tags to remote

### Cherry-pick
- [ ] Apply specific commits to current branch
- [ ] Handle cherry-pick conflicts

---

## Ideas / Future

- [ ] PR creation (integrate with GitHub CLI)
- [ ] Issue viewer (show linked issues)
- [ ] Branch comparison (diff between branches)
- [ ] Submodule support
- [ ] Git hooks status
- [ ] Worktree support
