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
| `server.ts` | HTTP server + WebSocket upgrade. Serves static files and routes API |
| `pty-manager.ts` | Spawns pi in PTY, tracks instances, routes I/O to WS clients |
| `session-api.ts` | Express router: list/kill/resize instances; list/resume/delete session history |
| `session-store.ts` | Scans `~/.pi/agent/sessions/` for `.jsonl` files, reads headers |
| `config.ts` | Loads/saves token, port, agentDir from `~/.pi/agent/web-config.json` |

### Frontend (public/)

| File | Role |
|------|------|
| `index.html` | Layout: sidebar, tabs, terminal panes, login overlay |
| `app.js` | All frontend logic: auth, API, WS, xterm.js, tabs, mobile sidebar, history |
| `style.css` | Dark theme, responsive mobile sidebar, terminal panes |

## Data Flow

### New Instance
1. Frontend `POST /api/instances {cwd}`
2. `pty-manager.spawnPi()` → node-pty → pi starts
3. Frontend receives `{id}` → `attachInstance(id)`
4. WebSocket connects with `?instance=<id>&token=<token>`
5. PTY `onData` → broadcast to all WS clients for that instance
6. xterm.js writes data to screen

### Reconnect to Existing Instance
1. Page refresh → `instances` Map is empty
2. User clicks sidebar item
3. `instances.has(id)` is false → `attachInstance(id)` re-establishes WS
4. PTY was never killed → stream resumes

### Resume Past Session
1. Frontend `POST /api/sessions/:id/resume`
2. `pty-manager.spawnPiWithSession(path)` → pi `--session <path>`
3. Same attach flow as new instance

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

1. Read first line → JSON parse header
2. Count non-empty lines → message count approximation
3. Sort by timestamp descending
4. Return: `{id, timestamp, cwd, path, size, lines}`

## Error Handling
- PTY exit → broadcast to WS clients, clean up instance
- WS disconnect → remove client from instance, PTY keeps running
- Invalid token → 401 on HTTP, WS close(1008)
- Missing instance → WS close(1008)
- API errors → JSON `{error: string}` with appropriate status code
