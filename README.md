# pi-web

Web frontend for [pi](https://github.com/earendil-works/pi-coding-agent). Runs pi in a PTY and renders it via xterm.js in the browser, plus session management.

## Features

- Spawn multiple pi instances in different directories
- Each instance runs in its own PTY — pi stays alive even if browser disconnects
- Reconnect to running instances
- Sidebar with active instance list
- Token-based authentication

## Quick Start

```bash
cd ~/projects/pi-web
npm install
npm run build
npm start
```

The server prints a token on first startup. Open `http://localhost:3456`, enter the token, and you're in.

The token is stored in `~/.pi/agent/web-config.json` — you can change it there.

## Usage

- **New session**: Click `+` or enter a directory path and click "Go"
- **Switch**: Click an instance in the sidebar
- **Close**: Click `×` on a tab or sidebar item (kills the pi process)
- **Disconnect/reconnect**: Pi keeps running; just refresh the page and reconnect

## Architecture

```
Browser ←──WS──→ node-pty(pi)   (one per instance)
        ←──HTTP──→ Express API  (list/kill/resize)
```

## Development

```bash
npm run dev   # build + start
```

## License

MIT
