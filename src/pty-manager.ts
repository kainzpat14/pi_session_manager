import { readFileSync } from "fs";
import * as pty from "node-pty";
import type { WebSocket } from "ws";
import { findSessionNameByCwd } from "./session-store";

export interface PiInstance {
  id: string;
  pty: pty.IPty;
  shell: pty.IPty;
  cwd: string;
  wsClients: Set<WebSocket>;
  shellClients: Set<WebSocket>;
  createdAt: number;
  replayBuffer: string;
  shellReplayBuffer: string;
  sessionPath?: string;
  name?: string;
}

const instances = new Map<string, PiInstance>();
const REPLAY_BUFFER_SIZE = 64 * 1024; // 64KB cap

function generateId(): string {
  return Math.random().toString(36).slice(2, 10);
}

function createPiInstance(
  piProc: pty.IPty,
  shellProc: pty.IPty,
  cwd: string,
): PiInstance {
  const id = generateId();

  const instance: PiInstance = {
    id,
    pty: piProc,
    shell: shellProc,
    cwd,
    wsClients: new Set(),
    shellClients: new Set(),
    createdAt: Date.now(),
    replayBuffer: "",
    shellReplayBuffer: "",
  };

  // Pi PTY data → pi clients + replay buffer
  piProc.onData((data: string) => {
    instance.replayBuffer += data;
    if (instance.replayBuffer.length > REPLAY_BUFFER_SIZE) {
      instance.replayBuffer = instance.replayBuffer.slice(-REPLAY_BUFFER_SIZE);
    }
    for (const ws of instance.wsClients) {
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({ type: "data", instanceId: id, data }));
      }
    }
  });

  // Shell PTY data → shell clients + replay buffer
  shellProc.onData((data: string) => {
    instance.shellReplayBuffer += data;
    if (instance.shellReplayBuffer.length > REPLAY_BUFFER_SIZE) {
      instance.shellReplayBuffer = instance.shellReplayBuffer.slice(-REPLAY_BUFFER_SIZE);
    }
    for (const ws of instance.shellClients) {
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({ type: "data", instanceId: id, data }));
      }
    }
  });

  // Either PTY exit → kill the other, broadcast exit, cleanup
  const onExit = (target: "pi" | "shell") => ({ exitCode, signal }: { exitCode: number; signal?: number }) => {
    // Notify both client sets
    for (const ws of instance.wsClients) {
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({ type: "exit", instanceId: id, exitCode, signal }));
      }
    }
    for (const ws of instance.shellClients) {
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({ type: "exit", instanceId: id, exitCode, signal }));
      }
    }
    // Kill the other PTY if still alive
    try { instance.pty.kill(); } catch {}
    try { instance.shell.kill(); } catch {}
    instances.delete(id);
  };

  piProc.onExit(onExit("pi"));
  shellProc.onExit(onExit("shell"));

  instances.set(id, instance);
  return instance;
}

function spawnShell(cwd: string): pty.IPty {
  const shellPath = process.env.SHELL || "/bin/bash";
  return pty.spawn(shellPath, [], {
    name: "xterm-256color",
    cols: 120,
    rows: 30,
    cwd,
    env: process.env as { [key: string]: string },
  });
}

export function spawnPi(cwd: string): PiInstance {
  const piPath = process.env.PI_PATH || "pi";
  const proc = pty.spawn(piPath, [], {
    name: "xterm-256color",
    cols: 120,
    rows: 30,
    cwd,
    env: process.env as { [key: string]: string },
  });
  const shell = spawnShell(cwd);
  return createPiInstance(proc, shell, cwd);
}

export function spawnPiWithSession(sessionPath: string, cwd?: string): PiInstance {
  const piPath = process.env.PI_PATH || "pi";
  const resolvedCwd = cwd || process.env.HOME || "/home/dev";
  const proc = pty.spawn(piPath, ["--session", sessionPath], {
    name: "xterm-256color",
    cols: 120,
    rows: 30,
    cwd: resolvedCwd,
    env: process.env as { [key: string]: string },
  });
  const shell = spawnShell(resolvedCwd);
  const inst = createPiInstance(proc, shell, resolvedCwd);
  inst.sessionPath = sessionPath;

  // Read session name from the JSONL file (session_info record)
  try {
    const content = readFileSync(sessionPath, "utf-8");
    for (const line of content.split("\n")) {
      if (!line.trim()) continue;
      try {
        const record = JSON.parse(line);
        if (record.type === "session_info" && record.name) {
          inst.name = record.name;
          break;
        }
      } catch {
        // ignore malformed line
      }
    }
  } catch {
    // ignore malformed or missing file
  }

  return inst;
}

export function getInstance(id: string): PiInstance | undefined {
  return instances.get(id);
}

export function listInstances(): Array<{
  id: string;
  cwd: string;
  pid: number;
  shellPid: number;
  createdAt: number;
  name?: string;
}> {
  return Array.from(instances.values()).map((i) => {
    const name = i.name ?? findSessionNameByCwd(i.cwd);
    return {
      id: i.id,
      cwd: i.cwd,
      pid: i.pty.pid,
      shellPid: i.shell.pid,
      createdAt: i.createdAt,
      name,
    };
  });
}

export function killInstance(id: string): boolean {
  const instance = instances.get(id);
  if (!instance) return false;
  try { instance.pty.kill(); } catch {}
  try { instance.shell.kill(); } catch {}
  instances.delete(id);
  return true;
}

export function sendInput(id: string, data: string, target: "pi" | "shell" = "pi"): boolean {
  const instance = instances.get(id);
  if (!instance) return false;
  if (target === "pi") {
    instance.pty.write(data);
  } else {
    instance.shell.write(data);
  }
  return true;
}

export function resizeInstance(id: string, cols: number, rows: number, target: "pi" | "shell" = "pi"): boolean {
  const instance = instances.get(id);
  if (!instance) return false;
  if (target === "pi") {
    instance.pty.resize(cols, rows);
  } else {
    instance.shell.resize(cols, rows);
  }
  return true;
}

export function redrawInstance(id: string): boolean {
  const instance = instances.get(id);
  if (!instance) return false;
  try {
    // SIGWINCH triggers pi's TUI to redraw
    process.kill(instance.pty.pid, "SIGWINCH");
    return true;
  } catch {
    return false;
  }
}

export function attachWebSocket(id: string, ws: WebSocket, target: "pi" | "shell" = "pi"): boolean {
  const instance = instances.get(id);
  if (!instance) return false;
  if (target === "pi") {
    instance.wsClients.add(ws);
  } else {
    instance.shellClients.add(ws);
  }
  return true;
}

export function detachWebSocket(id: string, ws: WebSocket, target: "pi" | "shell" = "pi"): void {
  const instance = instances.get(id);
  if (instance) {
    if (target === "pi") {
      instance.wsClients.delete(ws);
    } else {
      instance.shellClients.delete(ws);
    }
  }
}

export function getActiveSessionPaths(): string[] {
  return Array.from(instances.values())
    .map((i) => i.sessionPath)
    .filter((p): p is string => !!p);
}

export function getAllPids(): number[] {
  return Array.from(instances.values()).map((i) => i.pty.pid);
}

export function getAllShellPids(): number[] {
  return Array.from(instances.values()).map((i) => i.shell.pid);
}
