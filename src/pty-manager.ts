import * as pty from "node-pty";
import { spawn } from "child_process";
import type { Server as WebSocketServer, WebSocket } from "ws";

export interface PiInstance {
  id: string;
  pty: pty.IPty;
  cwd: string;
  wsClients: Set<WebSocket>;
  createdAt: number;
  replayBuffer: string;
}

const instances = new Map<string, PiInstance>();
const REPLAY_BUFFER_SIZE = 64 * 1024; // 64KB cap

function generateId(): string {
  return Math.random().toString(36).slice(2, 10);
}

function createPiInstance(
  proc: pty.IPty,
  cwd: string,
): PiInstance {
  const id = generateId();

  const instance: PiInstance = {
    id,
    pty: proc,
    cwd,
    wsClients: new Set(),
    createdAt: Date.now(),
    replayBuffer: "",
  };

  proc.onData((data: string) => {
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

  proc.onExit(({ exitCode, signal }) => {
    for (const ws of instance.wsClients) {
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({ type: "exit", instanceId: id, exitCode, signal }));
      }
    }
    instances.delete(id);
  });

  instances.set(id, instance);
  return instance;
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
  return createPiInstance(proc, cwd);
}

export function spawnPiWithSession(sessionPath: string): PiInstance {
  const piPath = process.env.PI_PATH || "pi";
  const cwd = process.env.HOME || "/home/dev";
  const proc = pty.spawn(piPath, ["--session", sessionPath], {
    name: "xterm-256color",
    cols: 120,
    rows: 30,
    cwd,
    env: process.env as { [key: string]: string },
  });
  return createPiInstance(proc, cwd);
}

export function getInstance(id: string): PiInstance | undefined {
  return instances.get(id);
}

export function listInstances(): Array<{
  id: string;
  cwd: string;
  pid: number;
  createdAt: number;
}> {
  return Array.from(instances.values()).map((i) => ({
    id: i.id,
    cwd: i.cwd,
    pid: i.pty.pid,
    createdAt: i.createdAt,
  }));
}

export function killInstance(id: string): boolean {
  const instance = instances.get(id);
  if (!instance) return false;
  instance.pty.kill();
  instances.delete(id);
  return true;
}

export function sendInput(id: string, data: string): boolean {
  const instance = instances.get(id);
  if (!instance) return false;
  instance.pty.write(data);
  return true;
}

export function resizeInstance(id: string, cols: number, rows: number): boolean {
  const instance = instances.get(id);
  if (!instance) return false;
  instance.pty.resize(cols, rows);
  return true;
}

export function redrawInstance(id: string): boolean {
  const instance = instances.get(id);
  if (!instance) return false;
  try {
    // SIGWINCH triggers pi's TUI to redraw (ProcessTerminal.start handles it)
    process.kill(instance.pty.pid, "SIGWINCH");
    return true;
  } catch {
    return false;
  }
}

export function attachWebSocket(id: string, ws: WebSocket): boolean {
  const instance = instances.get(id);
  if (!instance) return false;
  instance.wsClients.add(ws);
  return true;
}

export function detachWebSocket(id: string, ws: WebSocket): void {
  const instance = instances.get(id);
  if (instance) {
    instance.wsClients.delete(ws);
  }
}
