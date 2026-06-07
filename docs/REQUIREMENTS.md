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

### Session Management
- [x] Create new session in any directory
- [x] List active running instances
- [x] Switch between instances via sidebar/tabs
- [x] Kill running instances
- [x] List past session history from disk (`~/.pi/agent/sessions/`)
- [x] Resume past sessions with `--session <path>`
- [x] Delete past session files permanently

### Mobile
- [x] Collapsible sidebar on mobile (< 768px)
- [x] Hamburger menu (☰) toggles sidebar
- [x] Dark overlay dismisses sidebar
- [x] Sidebar auto-closes on instance selection

### Coexistence
- [x] Telegram bridge continues working alongside web frontend
- [x] Independent auth, no interference

## Non-Functional Requirements
- [x] Port: 3456 (configurable)
- [x] Single-user, multi-process
- [x] Config in JSON file
- [x] Vanilla JS frontend (no framework)
- [x] Node.js backend (Express + ws)
