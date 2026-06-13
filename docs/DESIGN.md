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
| `server.ts` | HTTPS server + WebSocket upgrade. Serves static files with no-cache headers and routes API. Replays buffer + SIGWINCH on new WS connection |
| `pty-manager.ts` | Spawns pi in PTY, tracks instances with replay buffer, routes I/O to WS clients. Exposes pids for /proc scanning |
| `session-api.ts` | Express router: list/kill/resize instances; list/resume/delete session history |
| `session-store.ts` | Scans `~/.pi/agent/sessions/` for `.jsonl` files, reads headers, filters externally active sessions via `/proc` |
| `config.ts` | Loads/saves token, port, agentDir from `~/.pi/agent/web-config.json` |

### Frontend (public/)

| File | Role |
|------|------|
| `index.html` | Layout: sidebar, tabs, terminal panes, login overlay |
| `app.js` | All frontend logic: auth, API, WS, xterm.js, tabs, mobile sidebar, history, iOS re-render, paste button, window resize auto-fit |
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
4. Frontend calls `term.reset()` to clear stale xterm.js parser state
5. Server sends replay buffer on WS open so the new client sees the current screen state
6. Server sends SIGWINCH to pi → TUI redraws → fresh output
7. PTY was never killed → stream resumes

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
2. Scan remaining lines for `session_info` records to extract the session `name`
3. Sort by timestamp descending
4. Return: `{id, timestamp, cwd, path, size, lines, name?}`

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

### Reconnect State Recovery

The replay buffer captures the most recent 64KB of output. On a fresh WebSocket connection the server sends the entire replay buffer immediately, followed by a SIGWINCH to force pi to redraw its TUI. The frontend calls `term.reset()` before attaching, which clears any stale xterm.js parser state. Together, the replay buffer + `term.reset()` + SIGWINCH provide a clean, up-to-date screen state without needing to prepend historical init sequences.

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

## Session Tab Model (New Design)

### Overview

The tab bar contains:
- **One static "pi" tab** that always renders the currently selected pi session's TUI
- **One shared "Terminal" tab** that renders the bash shell of the currently selected instance
- Sessions are listed only in the sidebar; tabs are not used for session switching
- Each backend instance still owns a 1:1 pi PTY + shell PTY pair, but the frontend exposes only a single shell tab that switches panes based on `selectedInstanceId`

### Backend Changes

#### Data Model: Dual-PTY PiInstance

```typescript
interface PiInstance {
  id: string;
  pty: pty.IPty;               // pi process
  shell: pty.IPty;             // bash shell
  cwd: string;
  wsClients: Set<WebSocket>;   // pi WS clients
  shellClients: Set<WebSocket>; // shell WS clients
  createdAt: number;
  replayBuffer: string;        // pi replay buffer (64KB)
  shellReplayBuffer: string;   // shell replay buffer (64KB)
  sessionPath?: string;
  name?: string;               // from session JSONL header if available
}
```

#### PTY Manager (`pty-manager.ts`)

1. **Spawning**: `createPiInstance()` spawns both `pi` and `bash` (or `SHELL` env) in the same `cwd`, with identical initial size (120×30).
2. **Data routing**: Each PTY has its own `onData` handler that writes to its own replay buffer and broadcasts to its own client set.
3. **Exit handling**: When either PTY exits, kill the other PTY and broadcast exit to both client sets, then remove from `instances` Map.
4. **WebSocket routing**: `attachWebSocket(id, ws, target)` where `target` is `"pi"` or `"shell"`. Same for `detachWebSocket`.
5. **Input/Resize**: `sendInput(id, data, target)` and `resizeInstance(id, cols, rows, target)` route to the correct PTY.
6. **Redraw**: `redrawInstance()` only applies to the pi PTY (SIGWINCH).
7. **Kill**: `killInstance()` kills both PTYs unconditionally.
8. **List**: `listInstances()` returns `{id, cwd, pid, shellPid, createdAt, name?}`. For resumed sessions, the name is read from the `session_info` record in the session JSONL file. For fresh sessions, the name is resolved by scanning the most recent session file in the instance's cwd.

#### WebSocket Server (`server.ts`)

- Read `?target=pi|shell` query parameter (default `"pi"` for backward compatibility).
- `attachWebSocket(instanceId, ws, target)`.
- On connect: send the appropriate replay buffer (`replayBuffer` for pi, `shellReplayBuffer` for shell).
- For pi: send SIGWINCH after replay to force a TUI redraw.
- For shell: no SIGWINCH needed.
- On `msg.type === "input"` or `"resize"`: route to the correct PTY via `target`.
- SIGWINCH sent only for pi target.

#### Session API (`session-api.ts`)

- No changes to HTTP endpoints needed. `POST /api/instances` and `POST /api/sessions/:id/resume` still return `{id, cwd, pid}`. The shell is spawned internally.
- `listInstances` may include `shellPid` and `name` in the response for completeness.

### Frontend Changes

#### State Model (`app.js`)

```javascript
// Sidebar selection: which instance's pi TUI is shown in the "pi" tab
let selectedInstanceId = null;

// Active tab: "pi" or "shell"
let activeTab = "pi";

// Instance registry: each entry has both pi and shell subsystems
const instances = new Map(); // id -> {
//   cwd: string,
//   pi: { ws, term, fitAddon, pane, firstData: boolean },
//   shell: { ws, term, fitAddon, pane, firstData: boolean }
// }
```

#### Tab Bar

- **Static "pi" tab**: Always first, no close button. Clicking it sets `activeTab = "pi"`.
- **Shared "Terminal" tab**: A single tab added when the first instance is attached. Label is exactly `"Terminal"`. No close button. Clicking it sets `activeTab = "shell"`. The shell pane of the currently `selectedInstanceId` is shown.
- **Tab removal**: When the last instance is removed, the Terminal tab is also removed.

#### Pane Visibility

The `#terminals` container holds both pi panes and shell panes. All are `position: absolute; inset: 0; display: none;`.

`updateVisibility()`:
1. Hide all panes (both pi and shell).
2. If `activeTab === "pi"` and `selectedInstanceId` exists and `instances.has(selectedInstanceId)`: show `instances.get(selectedInstanceId).pi.pane`.
3. If `activeTab === "shell"` and `selectedInstanceId` exists and `instances.has(selectedInstanceId)`: show `instances.get(selectedInstanceId).shell.pane`.
4. Call `fitAddon.fit()` and `term.focus()` on the newly visible terminal.

#### Sidebar Interaction

- Clicking a sidebar instance item:
  1. Sets `selectedInstanceId = id`.
  2. If the instance is not yet in the registry, calls `attachInstance(id, cwd)`.
  3. Sets `activeTab = "pi"`.
  4. Calls `updateVisibility()`.
  5. Closes mobile sidebar.
- The sidebar's × (kill) button calls `removeInstance(id)` which kills both PTYs and removes the Terminal tab.

#### `attachInstance(id, cwd)`

1. If already in `instances`, return.
2. Create **pi** subsystem: WS with `?target=pi`, xterm.js, fitAddon, `.terminal-pane` appended to `#terminals`.
3. Create **shell** subsystem: WS with `?target=shell`, xterm.js, fitAddon, `.shell-pane` appended to `#terminals`.
4. Both WS handlers call `term.reset()` on open, handle `data`/`exit`/`close` messages, and send `input`/`resize` from xterm.js.
5. Ensure the shared "Terminal" tab exists (adds it if this is the first instance).
6. Register in `instances` Map.
7. Set `selectedInstanceId = id` and `activeTab = "pi"`.
8. Call `updateVisibility()`.

#### `removeInstance(id)`

1. Close both WS connections.
2. Dispose both xterm.js terminals.
3. Remove both DOM panes.
4. Remove the Terminal tab if no instances remain.
5. Delete from `instances` Map.
6. If `selectedInstanceId === id`, set `selectedInstanceId` to the next remaining instance (or null).
7. If `activeTab === "shell"`, fall back to `"pi"`.
8. Call `updateVisibility()`.

#### iOS Re-render

- The visibilitychange handler checks `activeTab` and `selectedInstanceId` to determine which terminal to re-render.

### CSS Changes (`style.css`)

- `.pi-tab`: styling for the static "pi" tab (similar to `.tab`, but always present, no close button).
- `.tab` continues to style Terminal tabs.
- `.terminal-pane` continues to style pi panes.
- `.shell-pane` styles shell panes (same absolute positioning as `.terminal-pane`).
- The `#tabs` container can hold both `.pi-tab` and `.tab` elements.
- Terminal tabs have no `.tab-close` element.

### Lifecycle Diagram

```
User clicks "+" or "+ New session here"
  │
  ↓
POST /api/instances {cwd}
  │
  ↓
pty-manager.spawnPi(cwd)
  ├── spawns pi PTY
  └── spawns bash PTY in same cwd
  │
  ↓
Frontend attachInstance(id, cwd)
  ├── creates pi WS (?target=pi) + xterm.js + .terminal-pane
  ├── creates shell WS (?target=shell) + xterm.js + .shell-pane
  ├── adds "Terminal" tab
  └── sets activeTab = "pi", selectedInstanceId = id
  │
  ↓
User clicks sidebar instance X
  ├── selectedInstanceId = X
  ├── activeTab = "pi"
  └── shows X's pi pane
  │
  ↓
User clicks "Terminal" tab
  ├── activeTab = "shell"
  └── shows shell pane of the currently selected instance
  │
  ↓
User clicks sidebar × for instance X
  ├── backend kills both pi and shell PTYs
  ├── frontend removes both panes
  ├── removes Terminal tab for X
  └── if selectedInstanceId was X, pick next instance
```

### Reconnect Flow

Both pi and shell support reconnect via their own replay buffers:
- **Pi WS**: Server sends `replayBuffer`. SIGWINCH sent to force redraw.
- **Shell WS**: Server sends `shellReplayBuffer`. No SIGWINCH.
- Frontend `term.reset()` on open for both.

### Error Handling
- Pi PTY exit → kills shell PTY, broadcasts exit to both client sets, cleans up instance.
- Shell PTY exit → kills pi PTY, same cleanup.
- WS disconnect → remove client from the appropriate client set (pi or shell), PTY keeps running.
- Invalid token → WS close(1008).
- Missing instance or target → WS close(1008).

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

## Minor Frontend Features

- **Paste button** — Fixed `#paste-btn` (📋) reads from `navigator.clipboard` and pastes into the active terminal (pi or shell). Shown only on mobile (`<768px`).
- **Window resize auto-fit** — On `window.resize`, all visible terminals are re-fitted via `fitAddon.fit()`.
- **First-data scroll-to-bottom** — The frontend tracks `firstData` for both pi and shell terminals and explicitly calls `scrollToBottom()` on the first WebSocket data chunk so the cursor starts at the bottom.
- **Cache-busting query params** — `style.css` and `app.js` are loaded with `?v=N` cache-busting query strings in `index.html`.
- **Debug log overlay** — A hidden `#debug-log` overlay exists in the DOM for development; it is currently disabled in code.
- **Static `Cache-Control` headers** — Express static middleware adds `no-store, no-cache, must-revalidate, proxy-revalidate, Pragma, Expires` headers.

## Error Handling
- PTY exit → broadcast to WS clients, clean up instance
- WS disconnect → remove client from instance, PTY keeps running
- Invalid token → 401 on HTTP, WS close(1008)
- Missing instance → WS close(1008)
- API errors → JSON `{error: string}` with appropriate status code
