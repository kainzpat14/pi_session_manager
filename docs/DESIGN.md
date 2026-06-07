# Design

## Architecture

```
┌─────────────┐      WS       ┌─────────────┐      PTY       ┌────────┐
│   Browser   │ ←────────────→ │   Node.js   │ ←────────────→ │   pi   │
│  (xterm.js) │   JSON msgs    │   Server    │   raw bytes    │  (TTY) │
└─────────────┘                └─────────────┘                └────────┘
                                    │
                                    │ HTTP
                                    ↓
                              ┌─────────────┐
                              │  session    │
                              │   store     │
                              └─────────────┘
```

## Components

### Backend (src/)

| Module | Role |
|--------|------|
| `server.ts` | HTTP server + WebSocket upgrade. Serves static files and routes API. Replays buffer + SIGWINCH on new WS connection |
| `pty-manager.ts` | Spawns pi in PTY, tracks instances with replay buffer, routes I/O to WS clients. Exposes pids for /proc scanning |
| `session-api.ts` | Express router: list/kill/resize instances; list/resume/delete session history |
| `session-store.ts` | Scans `~/.pi/agent/sessions/` for `.jsonl` files, reads headers, filters externally active sessions via `/proc` |
| `config.ts` | Loads/saves token, port, agentDir from `~/.pi/agent/web-config.json` |

### Frontend (public/)

| File | Role |
|------|------|
| `index.html` | Layout: sidebar, tabs, terminal panes, login overlay |
| `app.js` | All frontend logic: auth, API, WS, xterm.js, tabs, mobile sidebar, history, iOS visibilitychange re-render |
| `style.css` | Dark theme, responsive mobile sidebar, terminal panes |

## Data Flow

### New Instance
1. Frontend `POST /api/instances {cwd}`
2. `pty-manager.spawnPi()` → node-pty → pi starts
3. Frontend receives `{id}` → `attachInstance(id)`
4. WebSocket connects with `?instance=<id>&token=<token>`
5. PTY `onData` → write to replay buffer (64KB cap) + broadcast to all WS clients
6. xterm.js writes data to screen

### Reconnect to Existing Instance
1. Page refresh → `instances` Map is empty
2. User clicks sidebar item
3. `instances.has(id)` is false → `attachInstance(id)` re-establishes WS
4. Server sends replay buffer on WS open → terminal has current screen state
5. Server sends SIGWINCH to pi → TUI redraws → fresh output
6. PTY was never killed → stream resumes

### Resume Past Session
1. Frontend `POST /api/sessions/:id/resume`
2. `session-store.ts` reads session JSON header for original `cwd`
3. `pty-manager.spawnPiWithSession(path, cwd)` → pi `--session <path>` with correct cwd
4. Same attach flow as new instance

### Delete Past Session
1. Frontend `DELETE /api/sessions/:id`
2. `session-store.deleteSession(id)` unlinks `.jsonl` file
3. Frontend refreshes history list

## Authentication

```
┌────────────┐
│   Token    │──→ web-config.json (server-side)
│   Input    │
└────────────┘
     │
     ↓ localStorage
┌────────────┐
│  Browser   │──→ X-Pi-Token header / ?token= query
└────────────┘
```

## Mobile Sidebar

```
Desktop (>768px): sidebar always visible
Mobile (<768px):  sidebar hidden, translateX(-100%)
                   ☰ toggles .open class
                   overlay click dismisses
                   item click auto-dismisses
```

## Session History Scanning

```
~/.pi/agent/sessions/
  └── <encoded-cwd>/
        └── <timestamp>_<id>.jsonl
```

1. Read first line → JSON parse header (contains `id`, `timestamp`, `cwd`)
2. Sort by timestamp descending
3. Return: `{id, timestamp, cwd, path, size, lines}`

### External Active Session Detection

To avoid showing sessions that are currently being used by pi in screen/SSH/elsewhere:

1. Scan `/proc/<pid>` for all processes where `exe` is `pi` or `node` with `cmdline` containing `pi`
2. Read `cwd` symlink for each matching pid
3. Convert cwd to encoded directory name (`/home/dev` → `--home-dev--`)
4. Skip ALL session files inside matching directories
5. pi-web's own pids are excluded so its own active sessions are still manageable via the Active list

**Why not mtime?** pi appends to the file on every turn, so mtime is always recent. This would incorrectly hide all recent sessions regardless of whether they are "active" elsewhere.

## Replay Buffer

Each `PiInstance` maintains a rolling `replayBuffer` (64KB cap):
- On PTY `onData`, append to buffer; trim if over cap
- On new WebSocket connection, send buffer immediately before live streaming
- This provides instant screen state without waiting for new pi output

## SIGWINCH Redraw

On new WebSocket connect to an existing PTY:
1. Server sends replay buffer (existing screen state)
2. Server calls `process.kill(pid, "SIGWINCH")`
3. pi's `ProcessTerminal` receives SIGWINCH and triggers full TUI redraw
4. Redraw output is captured in replay buffer and streamed to the new client

## iOS Canvas Recovery

When iOS Safari backgrounds a tab, the canvas may blank. On `visibilitychange` → `visible`:
1. `term.resize(cols-1, rows)` then `term.resize(cols, rows)` — forces xterm.js internal re-render
2. `fitAddon.fit()` — recalculate geometry
3. `term.refresh(0, rows-1)` — explicit paint call
4. 100ms delay to let iOS finish canvas wake-up

## File Explorer

### Data Flow

```
Sidebar "New in folder"
  │
  ├── GET /api/fs?path=/home/dev
  │     └── session-api.ts: reads directory via fs.readdir, stat
  │         returns { path, parent, entries: [{name, type, path}] }
  │
  ├── Frontend: renderFs(data)
  │     ├── Breadcrumb: "↑ /home/dev" (click → parent)
  │     ├── "+ New session here" button → createInstance(data.path)
  │     ├── Directories: clickable → loadFs(entry.path)
  │     └── Files: non-clickable, gray
  │
  └── Manual input row preserved below explorer
```

### Backend Endpoint

`GET /api/fs?path=<absPath>`
- Resolves path to absolute
- `fs.readdir` + `fs.stat` per entry
- Sorts: directories first, then files, both alphabetically
- Returns `{ path, parent, entries }` where `parent` is `null` at filesystem root

### Frontend

- `loadFs(path)` fetches and renders asynchronously
- `renderFs(data)` builds DOM: breadcrumb, create button, entry list
- `fsCurrentPath` tracks state; synced to manual input field
- Null-safe: all DOM refs checked before access
- Click handlers on directories call `loadFs()` recursively

## Error Handling
- PTY exit → broadcast to WS clients, clean up instance
- WS disconnect → remove client from instance, PTY keeps running
- Invalid token → 401 on HTTP, WS close(1008)
- Missing instance → WS close(1008)
- API errors → JSON `{error: string}` with appropriate status code
