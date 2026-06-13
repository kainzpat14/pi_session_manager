# Requirements

## Overview
pi-web is a web frontend for the pi AI coding assistant. It renders the native TUI via xterm.js in a PTY and provides session management.

## Functional Requirements

### Authentication
- [x] URL token-based auth (configurable)
- [x] Token stored in `~/.pi/agent/web-config.json`
- [x] Token sent via `X-Pi-Token` header and `?token=` query param

### Terminal / PTY
- [x] Spawn pi in a real PTY using node-pty
- [x] Stream PTY I/O to browser via WebSocket
- [x] Render TUI in browser with xterm.js
- [x] Reconnect to running PTY without data loss
- [x] Pi continues running if browser disconnects
- [x] Resize terminal (cols/rows)
- [x] Multiple concurrent pi instances (tabs)

### Session Tab Model
- [x] The main tab area contains exactly one **"pi"** tab that renders the currently selected pi session's TUI
- [x] Sessions are visible only in the sidebar, not as separate tabs
- [x] One shared **"Terminal"** tab shows the bash shell of the currently selected instance
- [x] Each active pi session has its own shell PTY (1:1 backend relationship)
- [x] Shell is spawned automatically when the pi session is created
- [x] Shell shares the same lifecycle as the pi session: when the pi session ends, the shell is also killed/closed
- [x] Terminal tab is named **"Terminal"**
- [x] Resumed sessions also get a shell automatically

### Reconnect / Resume
- [x] Server maintains 64KB replay buffer per PTY instance
- [x] New WebSocket connection replays recent output immediately
- [x] Server sends SIGWINCH to pi on connect to force TUI redraw
- [x] Frontend calls `term.reset()` before attaching to clear stale xterm.js parser state
- [x] Replayed buffer + `term.reset()` + SIGWINCH provides a clean TUI state on reconnect
- [x] iOS Safari: aggressive xterm.js re-render on visibilitychange (resize ±1 col, fit, refresh)

### Session Management
- [x] Create new session in any directory
- [x] List active running instances
- [x] Switch between instances via sidebar/tabs
- [x] Kill running instances
- [x] List past session history from disk (`~/.pi/agent/sessions/`)
- [x] Resume past sessions with `--session <path>`
- [x] Resume preserves original cwd from session JSON header
- [x] Delete past session files permanently

### Session Naming
- [x] Read `name` field from `session_info` records in session JSONL files
- [x] Display session name in history list when available
- [x] Display session name in active instances list when available
- [x] For active instances, scan the most recent session file in the instance's cwd
- [x] Fall back to showing cwd when no name is present

### History Display
- [x] Show complete working directory path (not truncated to basename)
- [x] Show session name if available (above cwd)
- [x] Show session timestamp
- [x] Do not show message count or file size
- [x] Resume button: ▶ (play icon)
- [x] Delete button: 🗑 (trash icon)
- [x] Delete requires confirmation dialog

### History Filtering
- [x] Hide sessions whose directory has an externally-running pi process
- [x] Detection: scan `/proc/<pid>/cwd` of all pi processes, exclude pi-web's own pids
- [x] Do NOT use file modification time for activity detection
- [x] Filter must not affect pi-web spawned sessions that are truly idle

### Mobile
- [x] Collapsible sidebar on mobile (< 768px)
- [x] Hamburger menu (☰) toggles sidebar
- [x] Dark overlay dismisses sidebar
- [x] Sidebar auto-closes on instance selection
- [x] History action buttons: min 44px height, 48px width on mobile
- [x] History action buttons: larger touch targets (padding 8px 14px, font 1rem)

### File Explorer
- [x] Clickable folder navigation in sidebar ("New in folder" section)
- [x] Breadcrumb with "↑ parent" navigation
- [x] "+ New session here" button for current directory
- [x] Directories shown first, sorted alphabetically
- [x] Manual path input preserved alongside explorer
- [x] Mobile-friendly: min 44px touch targets, scrollable list

### Coexistence
- [x] Telegram bridge continues working alongside web frontend
- [x] Independent auth, no interference

## Non-Functional Requirements
- [x] Port: 3456 (configurable)
- [x] Single-user, multi-process
- [x] Config in JSON file
- [x] Vanilla JS frontend (no framework)
- [x] Node.js backend (Express + ws)
