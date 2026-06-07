import * as pty from "node-pty";
import { spawn } from "child_process";
import type { Server as WebSocketServer, WebSocket } from "ws";

export interface PiInstance {
  id: string;
  pty: pty.IPty;
  cwd: string;
  wsClients: Set<WebSocket>;
  createdAt: number;
}

const instances = new Map<string, PiInstance>();

function generateId(): string {
  return Math.random().toString(36).slice(2, 10);
}

export function spawnPi(cwd: string): PiInstance {
  const id = generateId();
  const piPath = process.env.PI_PATH || "pi";

  const proc = pty.spawn(piPath, [], {
    name: "xterm-256color",
    cols: 120,
    rows: 30,
    cwd,
    env: process.env as { [key: string]: string },
  });

  const instance: PiInstance = {
    id,
    pty: proc,
    cwd,
    wsClients: new Set(),
    createdAt: Date.now(),
  };

  proc.onData((data: string) => {
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
