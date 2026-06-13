# Session Grouping by Folder - Design

## Goal
Replace the separate "Active" and "History" lists with a single grouped view that organizes all sessions by their working directory (folder).

## Requirements
1. **Group by folder** (cwd) — both active instances and past sessions in the same folder group
2. **Sort folders**: folders with active sessions first, then by most recent session date
3. **Collapsible folders**: default state is collapsed
4. **Progressive disclosure**: when expanded, show all active sessions + most recent history session. Click "..." to reveal remaining history sessions.
5. **Preserve existing interactions**: click to select active session, resume/delete history sessions

## Architecture

### Data Flow
- `refreshInstanceList()` and `refreshHistory()` continue polling independently
- Results are stored in module-level state (`activeInstances`, `historySessions`)
- Both refresh functions call `renderSessionGroups()` to rebuild the unified view

### Grouping Logic
```
for each cwd:
  active = instances.filter(i => i.cwd === cwd)
  history = sessions.filter(s => s.cwd === cwd).sort(timestamp desc)
  lastHistory = history[0]
  olderHistory = history.slice(1)
  hasActive = active.length > 0
  lastDate = max(active latest createdAt, history latest timestamp)

sort folders:
  1. hasActive desc (true first)
  2. lastDate desc (most recent first)
```

### UI Structure per Folder
```
<li class="session-folder">
  <div class="folder-header"> <!-- clickable -->
    <span class="folder-chevron">▶</span>
    <span class="folder-name">folder-name</span>
    <span class="folder-badge">2 active, 5 history</span>
  </div>
  <div class="folder-content collapsed">
    <!-- active instances (all shown) -->
    <!-- last history session -->
    <!-- "..." button if olderHistory.length > 0 -->
    <!-- older history sessions (hidden initially) -->
  </div>
</li>
```

### CSS Additions
- `.session-folder` — container with border-bottom
- `.folder-header` — flex row, hover highlight, cursor pointer
- `.folder-header.active-folder` — left border accent for folders with active sessions
- `.folder-content` — padding-left indent
- `.folder-content.collapsed` — display none
- `.folder-chevron` — rotates 90deg when expanded
- `.show-more-btn` — centered "..." button

## Files Changed
- `public/index.html` — combine sections into single "Sessions" list
- `public/style.css` — folder group styles
- `public/app.js` — grouping logic and rendering
