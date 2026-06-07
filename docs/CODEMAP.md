# Code Map

## Directory Layout

```
pi-web/
├── package.json           # deps: express, node-pty, ws; dev: typescript types
├── tsconfig.json          # ES2022, CommonJS, strict, outDir=dist
├── README.md              # quick start and usage
├── .gitignore             # node_modules, dist, logs
├── src/                   # TypeScript backend
│   ├── server.ts          # entry point: Express + WebSocketServer + replay on connect
│   ├── pty-manager.ts     # PiInstance lifecycle: spawn, kill, attach, resize, replay buffer, SIGWINCH
│   ├── session-api.ts     # Express router for /api/* endpoints
│   ├── session-store.ts   # Scan sessions/, read headers, filter external pi processes via /proc
│   └── config.ts          # JSON config persistence (token, port, agentDir)
├── public/                # Static frontend files
│   ├── index.html         # Layout: sidebar, tabs, terminals, login
│   ├── app.js             # All frontend logic: auth, API, WS, xterm.js, tabs, mobile sidebar, history, iOS re-render
│   └── style.css          # Dark theme, responsive sidebar, terminal panes
├── docs/                  # Documentation
│   ├── REQUIREMENTS.md    # Functional & non-functional requirements
│   ├── DESIGN.md          # Architecture, data flows, protocols
│   └── CODEMAP.md         # This file
└── dist/                  # Compiled JS (tsc output, not committed)
```

## Key Functions

### Backend

| Function | File | Purpose |
|----------|------|---------|
| `loadConfig()` | `config.ts` | Read or create `~/.pi/agent/web-config.json` |
| `spawnPi(cwd)` | `pty-manager.ts` | Spawn pi in PTY, return PiInstance with replay buffer |
| `spawnPiWithSession(path, cwd?)` | `pty-manager.ts` | Spawn pi with `--session <path>` and optional cwd |
| `redrawInstance(id)` | `pty-manager.ts` | Send SIGWINCH to pi process to force TUI redraw |
| `getActiveSessionPaths()` | `pty-manager.ts` | Return `sessionPath` values of active instances |
| `getAllPids()` | `pty-manager.ts` | Return pids of all pi-web managed pi processes |
| `attachWebSocket(id, ws)` | `pty-manager.ts` | Subscribe WS to PTY output (buffer auto-replayed by server) |
| `listInstances()` | `pty-manager.ts` | Return active {id, cwd, pid, createdAt} |
| `listSessions(excludePaths?, piWebPids?)` | `session-store.ts` | Scan disk, parse headers, filter externally active sessions |
| `getExternallyActiveSessionDirs(piWebPids)` | `session-store.ts` | Scan `/proc/<pid>/cwd` for external pi processes |
| `deleteSession(id)` | `session-store.ts` | Unlink `.jsonl` file |
| `findSessionPath(id)` | `session-store.ts` | Resolve id to file path |
| `requireToken` | `session-api.ts` | Express middleware: 401 if token mismatch |

### Frontend

| Function | File | Purpose |
|----------|------|---------|
| `api(method, path, body)` | `app.js` | Fetch wrapper with X-Pi-Token |
| `initApp()` | `app.js` | Start polling loops for instances + history |
| `createInstance(cwd)` | `app.js` | POST /instances then attachInstance |
| `attachInstance(id, cwd)` | `app.js` | Create WS, xterm.js, pane, tab; server auto-replays + SIGWINCH |
| `removeInstance(id)` | `app.js` | Dispose term, close WS, remove pane/tab |
| `switchToInstance(id)` | `app.js` | Toggle active pane + tab + sidebar highlight |
| `resumeSession(id)` | `app.js` | POST /sessions/:id/resume then attach |
| `refreshHistory()` | `app.js` | GET /sessions, render history list |
| `openSidebar()` / `closeSidebar()` | `app.js` | Mobile sidebar toggle |
| `loadFs(path)` | `app.js` | Fetch directory listing and render explorer |
| `renderFs(data)` | `app.js` | Build DOM: breadcrumb, create button, dir/file entries |
| `toggleSidebar()` | `app.js` | Inline onclick + event listener for hamburger menu |

## Data Structures

```typescript
// Backend
interface PiInstance {
  id: string;
  pty: IPty;
  cwd: string;
  wsClients: Set<WebSocket>;
  createdAt: number;
  replayBuffer: string;   // rolling 64KB of recent PTY output
  sessionPath?: string;   // set for resumed sessions
}

interface SessionEntry {
  id: string;
  timestamp: string;
  cwd: string;
  path: string;
  size: number;
  lines: number;
}

// Frontend (Map)
instances: Map<string, {
  ws: WebSocket;
  term: Terminal;
  fitAddon: FitAddon;
  cwd: string;
  pane: HTMLDivElement;
}>
```

## API Endpoints

| Method | Path | Auth | Body | Response |
|--------|------|------|------|----------|
| GET | `/api/instances` | token | — | `[{id, cwd, pid, createdAt}]` |
| POST | `/api/instances` | token | `{cwd}` | `{id, cwd, pid}` |
| POST | `/api/instances/:id/kill` | token | — | `{ok}` |
| POST | `/api/instances/:id/resize` | token | `{cols, rows}` | `{ok}` |
| POST | `/api/instances/:id/redraw` | token | — | `{ok}` |
| GET | `/api/sessions` | token | — | `[SessionEntry[]]` |
| DELETE | `/api/sessions/:id` | token | — | `{ok}` |
| POST | `/api/sessions/:id/resume` | token | — | `{id, cwd, pid}` |
| GET | `/api/fs` | token | `?path=<absPath>` | `{path, parent, entries[]}` |
| GET | `/config-info` | — | — | `{port, agentDir, configPath}` |
| WS | `/ws?instance=<id>&token=<t>` | token query | — | bidirectional JSON |

## WebSocket Protocol

```typescript
// Server → Client (on connect, replayBuffer is sent first, then live data)
{ type: "data", instanceId: string, data: string }
{ type: "exit", instanceId: string, exitCode?: number, signal?: number }

// Client → Server
{ type: "input", data: string }
{ type: "resize", cols: number, rows: number }
```

## Config File

`~/.pi/agent/web-config.json`:
```json
{
  "port": 3456,
  "token": "<32-char random>",
  "agentDir": "/home/dev/.pi/agent"
}
```
