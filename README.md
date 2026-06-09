# pi Session Manager

A web frontend for [pi](https://github.com/earendil-works/pi-coding-agent) that brings full session management to the browser — while keeping every native pi feature intact.

## Why

pi is a powerful AI coding assistant with a rich TUI. This project lets you run pi from any browser or phone, without losing a single feature. You get the full TUI via xterm.js, plus session history, tabs, and a mobile-friendly interface.

## What It Does

- **Full pi TUI in the browser** — xterm.js renders pi exactly as it appears in the terminal
- **Session management** — create, switch, resume, and delete sessions
- **Persistent history** — past sessions are stored on disk and can be resumed with one click
- **Dual-pane tabs** — each session has a "pi" tab (the TUI) and a "Terminal" tab (a bash shell in the same working directory)
- **Mobile-friendly** — collapsible sidebar, touch-optimized buttons, and responsive layout
- **Session names** — automatically picks up names from the `pi-autoname` extension so you can see "Session name display" instead of just a directory path
- **Never loses data** — pi runs in a real PTY; disconnects and reconnects are seamless

## Quick Start

```bash
cd ~/projects/pi-web
npm install
npm run build
npm start
```

The server prints a token on first startup. Open `http://localhost:3456`, enter the token, and you're in. The token is stored in `~/.pi/agent/web-config.json`.

## Usage

- **New session** — click `+` in the sidebar, pick a directory, or type a path
- **Switch** — click any active instance in the sidebar
- **Resume** — find a past session in the History section and click ▶
- **Delete** — click 🗑 on a past session (confirmation required)
- **Terminal tab** — click "Terminal" to open a bash shell in the session's working directory
- **Kill** — click `×` on a sidebar item to kill the pi process
- **Mobile** — tap ☰ to open the sidebar, tap outside or select an instance to close it

## Architecture

```
Browser ←──WS──→ node-pty (pi + shell)   one pair per session
        ←──HTTP──→ Express API            list / kill / resize / resume
```

Each session is a dual-PTY instance:
- **pi PTY** — the AI assistant TUI streamed via WebSocket
- **shell PTY** — a plain bash shell for file operations

Both support seamless reconnect via a 64KB replay buffer, and pi gets a SIGWINCH nudge on reconnect to force a TUI redraw.

## Session Naming

If you have `pi-autoname` installed, session names appear automatically in both the Active list and History. The manager reads names from `session_info` records in the session JSONL files.

## Development

```bash
npm run dev   # build + start
```

## License

MIT
