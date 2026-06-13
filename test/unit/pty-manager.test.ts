import type { WebSocket } from "ws";

jest.mock("node-pty", () => ({ spawn: jest.fn() }));
jest.mock("../../src/session-store", () => ({
  findSessionNameByCwd: jest.fn(),
}));

import * as pty from "node-pty";
const mockSpawn = jest.mocked(pty.spawn);

import * as PtyManager from "../../src/pty-manager";
import * as SessionStore from "../../src/session-store";

const mockFindSessionNameByCwd = jest.mocked(SessionStore.findSessionNameByCwd);

// Helper to create a mock pty object with internal callback storage
function createMockPty(pid: number) {
  let onDataCb: ((data: string) => void) | null = null;
  let onExitCb: ((e: { exitCode: number; signal?: number }) => void) | null = null;
  return {
    pid,
    onData: jest.fn((cb: (data: string) => void) => {
      onDataCb = cb;
    }),
    onExit: jest.fn((cb: (e: { exitCode: number; signal?: number }) => void) => {
      onExitCb = cb;
    }),
    write: jest.fn(),
    resize: jest.fn(),
    kill: jest.fn(),
    _emitData: (data: string) => onDataCb?.(data),
    _emitExit: (exitCode: number, signal?: number) => onExitCb?.({ exitCode, signal }),
  };
}

describe("pty-manager", () => {
  const mockCwd = "/home/dev/project";

  beforeEach(() => {
    jest.clearAllMocks();
    mockFindSessionNameByCwd.mockReturnValue(undefined);
  });

  afterEach(() => {
    // Clean up any lingering instances
    for (const inst of PtyManager.listInstances()) {
      PtyManager.killInstance(inst.id);
    }
  });

  describe("spawnPi", () => {
    it("creates a new instance with both pi and shell ptys", () => {
      const piPty = createMockPty(1001);
      const shellPty = createMockPty(1002);
      mockSpawn.mockReturnValueOnce(piPty as any).mockReturnValueOnce(shellPty as any);

      const instance = PtyManager.spawnPi(mockCwd);

      expect(instance).toBeDefined();
      expect(instance.id).toHaveLength(8); // random base36
      expect(instance.cwd).toBe(mockCwd);
      expect(instance.pty.pid).toBe(1001);
      expect(instance.shell.pid).toBe(1002);
      expect(instance.wsClients.size).toBe(0);
      expect(instance.shellClients.size).toBe(0);
      expect(instance.replayBuffer).toBe("");
      expect(instance.shellReplayBuffer).toBe("");
    });

    it("uses PI_PATH env var when spawning pi", () => {
      const original = process.env.PI_PATH;
      process.env.PI_PATH = "/custom/pi";
      const piPty = createMockPty(1001);
      const shellPty = createMockPty(1002);
      mockSpawn.mockReturnValueOnce(piPty as any).mockReturnValueOnce(shellPty as any);

      PtyManager.spawnPi(mockCwd);

      expect(mockSpawn).toHaveBeenCalledWith(
        "/custom/pi",
        [],
        expect.objectContaining({ cwd: mockCwd })
      );
      process.env.PI_PATH = original;
    });
  });

  describe("data flow", () => {
    it("pi pty data updates replayBuffer and broadcasts to ws clients", () => {
      const piPty = createMockPty(1001);
      const shellPty = createMockPty(1002);
      mockSpawn.mockReturnValueOnce(piPty as any).mockReturnValueOnce(shellPty as any);

      const instance = PtyManager.spawnPi(mockCwd);
      const ws = { readyState: 1, OPEN: 1, send: jest.fn() } as unknown as WebSocket;
      PtyManager.attachWebSocket(instance.id, ws, "pi");

      piPty._emitData("hello world");

      expect(instance.replayBuffer).toBe("hello world");
      expect(ws.send).toHaveBeenCalledWith(
        JSON.stringify({ type: "data", instanceId: instance.id, data: "hello world" })
      );
    });

    it("shell pty data updates shellReplayBuffer and broadcasts to shell clients", () => {
      const piPty = createMockPty(1001);
      const shellPty = createMockPty(1002);
      mockSpawn.mockReturnValueOnce(piPty as any).mockReturnValueOnce(shellPty as any);

      const instance = PtyManager.spawnPi(mockCwd);
      const ws = { readyState: 1, OPEN: 1, send: jest.fn() } as unknown as WebSocket;
      PtyManager.attachWebSocket(instance.id, ws, "shell");

      shellPty._emitData("bash prompt");

      expect(instance.shellReplayBuffer).toBe("bash prompt");
      expect(ws.send).toHaveBeenCalledWith(
        JSON.stringify({ type: "data", instanceId: instance.id, data: "bash prompt" })
      );
    });

    it("does not broadcast to ws clients that are not open", () => {
      const piPty = createMockPty(1001);
      const shellPty = createMockPty(1002);
      mockSpawn.mockReturnValueOnce(piPty as any).mockReturnValueOnce(shellPty as any);

      const instance = PtyManager.spawnPi(mockCwd);
      const ws = { readyState: 0, OPEN: 1, send: jest.fn() } as unknown as WebSocket;
      PtyManager.attachWebSocket(instance.id, ws, "pi");

      piPty._emitData("data");

      expect(ws.send).not.toHaveBeenCalled();
    });

    it("caps replay buffer at 64KB", () => {
      const piPty = createMockPty(1001);
      const shellPty = createMockPty(1002);
      mockSpawn.mockReturnValueOnce(piPty as any).mockReturnValueOnce(shellPty as any);

      const instance = PtyManager.spawnPi(mockCwd);
      const bigData = "x".repeat(70 * 1024);
      piPty._emitData(bigData);

      expect(instance.replayBuffer.length).toBeLessThanOrEqual(64 * 1024);
    });
  });

  describe("pty exit", () => {
    it("pi pty exit kills shell and cleans up instance", () => {
      const piPty = createMockPty(1001);
      const shellPty = createMockPty(1002);
      mockSpawn.mockReturnValueOnce(piPty as any).mockReturnValueOnce(shellPty as any);

      const instance = PtyManager.spawnPi(mockCwd);
      const ws = { readyState: 1, OPEN: 1, send: jest.fn() } as unknown as WebSocket;
      PtyManager.attachWebSocket(instance.id, ws, "pi");

      piPty._emitExit(0);

      expect(piPty.kill).toHaveBeenCalled();
      expect(shellPty.kill).toHaveBeenCalled();
      expect(PtyManager.getInstance(instance.id)).toBeUndefined();
      expect(ws.send).toHaveBeenCalledWith(
        expect.stringContaining("\"type\":\"exit\"")
      );
    });

    it("shell pty exit kills pi and cleans up instance", () => {
      const piPty = createMockPty(1001);
      const shellPty = createMockPty(1002);
      mockSpawn.mockReturnValueOnce(piPty as any).mockReturnValueOnce(shellPty as any);

      const instance = PtyManager.spawnPi(mockCwd);
      const ws = { readyState: 1, OPEN: 1, send: jest.fn() } as unknown as WebSocket;
      PtyManager.attachWebSocket(instance.id, ws, "shell");

      shellPty._emitExit(1, 9);

      expect(piPty.kill).toHaveBeenCalled();
      expect(shellPty.kill).toHaveBeenCalled();
      expect(PtyManager.getInstance(instance.id)).toBeUndefined();
    });
  });

  describe("getInstance / listInstances", () => {
    it("returns instance by id", () => {
      const piPty = createMockPty(1001);
      const shellPty = createMockPty(1002);
      mockSpawn.mockReturnValueOnce(piPty as any).mockReturnValueOnce(shellPty as any);

      const instance = PtyManager.spawnPi(mockCwd);
      expect(PtyManager.getInstance(instance.id)).toBe(instance);
      expect(PtyManager.getInstance("nonexistent")).toBeUndefined();
    });

    it("lists all instances with metadata", () => {
      const piPty = createMockPty(1001);
      const shellPty = createMockPty(1002);
      mockSpawn.mockReturnValueOnce(piPty as any).mockReturnValueOnce(shellPty as any);

      const instance = PtyManager.spawnPi(mockCwd);
      const list = PtyManager.listInstances();
      expect(list).toHaveLength(1);
      expect(list[0].id).toBe(instance.id);
      expect(list[0].cwd).toBe(mockCwd);
      expect(list[0].pid).toBe(1001);
      expect(list[0].shellPid).toBe(1002);
      expect(list[0].createdAt).toBeGreaterThan(0);
    });

    it("includes session name from findSessionNameByCwd", () => {
      mockFindSessionNameByCwd.mockReturnValue("My Session");
      const piPty = createMockPty(1001);
      const shellPty = createMockPty(1002);
      mockSpawn.mockReturnValueOnce(piPty as any).mockReturnValueOnce(shellPty as any);

      const instance = PtyManager.spawnPi(mockCwd);
      const list = PtyManager.listInstances();
      expect(list[0].name).toBe("My Session");
    });
  });

  describe("killInstance", () => {
    it("kills both ptys and removes instance", () => {
      const piPty = createMockPty(1001);
      const shellPty = createMockPty(1002);
      mockSpawn.mockReturnValueOnce(piPty as any).mockReturnValueOnce(shellPty as any);

      const instance = PtyManager.spawnPi(mockCwd);
      expect(PtyManager.killInstance(instance.id)).toBe(true);
      expect(piPty.kill).toHaveBeenCalled();
      expect(shellPty.kill).toHaveBeenCalled();
      expect(PtyManager.getInstance(instance.id)).toBeUndefined();
    });

    it("returns false for nonexistent instance", () => {
      expect(PtyManager.killInstance("nope")).toBe(false);
    });
  });

  describe("sendInput", () => {
    it("writes to pi pty by default", () => {
      const piPty = createMockPty(1001);
      const shellPty = createMockPty(1002);
      mockSpawn.mockReturnValueOnce(piPty as any).mockReturnValueOnce(shellPty as any);

      const instance = PtyManager.spawnPi(mockCwd);
      PtyManager.sendInput(instance.id, "hello");
      expect(piPty.write).toHaveBeenCalledWith("hello");
      expect(shellPty.write).not.toHaveBeenCalled();
    });

    it("writes to shell pty when target is shell", () => {
      const piPty = createMockPty(1001);
      const shellPty = createMockPty(1002);
      mockSpawn.mockReturnValueOnce(piPty as any).mockReturnValueOnce(shellPty as any);

      const instance = PtyManager.spawnPi(mockCwd);
      PtyManager.sendInput(instance.id, "ls", "shell");
      expect(shellPty.write).toHaveBeenCalledWith("ls");
    });

    it("returns false for nonexistent instance", () => {
      expect(PtyManager.sendInput("nope", "x")).toBe(false);
    });
  });

  describe("resizeInstance", () => {
    it("resizes pi pty by default", () => {
      const piPty = createMockPty(1001);
      const shellPty = createMockPty(1002);
      mockSpawn.mockReturnValueOnce(piPty as any).mockReturnValueOnce(shellPty as any);

      const instance = PtyManager.spawnPi(mockCwd);
      PtyManager.resizeInstance(instance.id, 80, 24);
      expect(piPty.resize).toHaveBeenCalledWith(80, 24);
      expect(shellPty.resize).not.toHaveBeenCalled();
    });

    it("resizes shell pty when target is shell", () => {
      const piPty = createMockPty(1001);
      const shellPty = createMockPty(1002);
      mockSpawn.mockReturnValueOnce(piPty as any).mockReturnValueOnce(shellPty as any);

      const instance = PtyManager.spawnPi(mockCwd);
      PtyManager.resizeInstance(instance.id, 100, 40, "shell");
      expect(shellPty.resize).toHaveBeenCalledWith(100, 40);
    });

    it("returns false for nonexistent instance", () => {
      expect(PtyManager.resizeInstance("nope", 80, 24)).toBe(false);
    });
  });

  describe("redrawInstance", () => {
    it("sends SIGWINCH to pi pid", () => {
      const piPty = createMockPty(1001);
      const shellPty = createMockPty(1002);
      mockSpawn.mockReturnValueOnce(piPty as any).mockReturnValueOnce(shellPty as any);

      const instance = PtyManager.spawnPi(mockCwd);
      const mockKill = jest.spyOn(process, "kill").mockImplementation(() => true as any);

      expect(PtyManager.redrawInstance(instance.id)).toBe(true);
      expect(mockKill).toHaveBeenCalledWith(1001, "SIGWINCH");

      mockKill.mockRestore();
    });

    it("returns false for nonexistent instance", () => {
      expect(PtyManager.redrawInstance("nope")).toBe(false);
    });

    it("returns false when process.kill throws", () => {
      const piPty = createMockPty(1001);
      const shellPty = createMockPty(1002);
      mockSpawn.mockReturnValueOnce(piPty as any).mockReturnValueOnce(shellPty as any);

      const instance = PtyManager.spawnPi(mockCwd);
      const mockKill = jest.spyOn(process, "kill").mockImplementation(() => {
        throw new Error("dead");
      });

      expect(PtyManager.redrawInstance(instance.id)).toBe(false);
      mockKill.mockRestore();
    });
  });

  describe("attachWebSocket / detachWebSocket", () => {
    it("adds ws to pi client set by default", () => {
      const piPty = createMockPty(1001);
      const shellPty = createMockPty(1002);
      mockSpawn.mockReturnValueOnce(piPty as any).mockReturnValueOnce(shellPty as any);

      const instance = PtyManager.spawnPi(mockCwd);
      const ws = { readyState: 1, OPEN: 1 } as unknown as WebSocket;
      expect(PtyManager.attachWebSocket(instance.id, ws, "pi")).toBe(true);
      expect(instance.wsClients.has(ws)).toBe(true);
    });

    it("adds ws to shell client set", () => {
      const piPty = createMockPty(1001);
      const shellPty = createMockPty(1002);
      mockSpawn.mockReturnValueOnce(piPty as any).mockReturnValueOnce(shellPty as any);

      const instance = PtyManager.spawnPi(mockCwd);
      const ws = { readyState: 1, OPEN: 1 } as unknown as WebSocket;
      expect(PtyManager.attachWebSocket(instance.id, ws, "shell")).toBe(true);
      expect(instance.shellClients.has(ws)).toBe(true);
    });

    it("returns false for nonexistent instance", () => {
      const ws = {} as WebSocket;
      expect(PtyManager.attachWebSocket("nope", ws)).toBe(false);
    });

    it("removes ws from client set", () => {
      const piPty = createMockPty(1001);
      const shellPty = createMockPty(1002);
      mockSpawn.mockReturnValueOnce(piPty as any).mockReturnValueOnce(shellPty as any);

      const instance = PtyManager.spawnPi(mockCwd);
      const ws = { readyState: 1, OPEN: 1 } as unknown as WebSocket;
      PtyManager.attachWebSocket(instance.id, ws, "pi");
      PtyManager.detachWebSocket(instance.id, ws, "pi");
      expect(instance.wsClients.has(ws)).toBe(false);
    });
  });

  describe("spawnPiWithSession", () => {
    it("spawns pi with --session flag and reads session name", () => {
      const piPty = createMockPty(1001);
      const shellPty = createMockPty(1002);
      mockSpawn.mockReturnValueOnce(piPty as any).mockReturnValueOnce(shellPty as any);

      const instance = PtyManager.spawnPiWithSession("/path/to/session.jsonl", "/home/dev");

      expect(mockSpawn).toHaveBeenCalledWith(
        expect.any(String),
        ["--session", "/path/to/session.jsonl"],
        expect.objectContaining({ cwd: "/home/dev" })
      );
      expect(instance.sessionPath).toBe("/path/to/session.jsonl");
    });
  });

  describe("getActiveSessionPaths", () => {
    it("returns session paths for instances with sessions", () => {
      const piPty1 = createMockPty(1001);
      const shellPty1 = createMockPty(1002);
      mockSpawn.mockReturnValueOnce(piPty1 as any).mockReturnValueOnce(shellPty1 as any);
      const inst1 = PtyManager.spawnPiWithSession("/path/s1.jsonl", mockCwd);

      const piPty2 = createMockPty(1003);
      const shellPty2 = createMockPty(1004);
      mockSpawn.mockReturnValueOnce(piPty2 as any).mockReturnValueOnce(shellPty2 as any);
      const inst2 = PtyManager.spawnPi(mockCwd);

      const paths = PtyManager.getActiveSessionPaths();
      expect(paths).toEqual(["/path/s1.jsonl"]);
    });
  });

  describe("getAllPids / getAllShellPids", () => {
    it("returns all pi and shell pids", () => {
      const piPty1 = createMockPty(1001);
      const shellPty1 = createMockPty(1002);
      mockSpawn.mockReturnValueOnce(piPty1 as any).mockReturnValueOnce(shellPty1 as any);
      const inst1 = PtyManager.spawnPi(mockCwd);

      const piPty2 = createMockPty(1003);
      const shellPty2 = createMockPty(1004);
      mockSpawn.mockReturnValueOnce(piPty2 as any).mockReturnValueOnce(shellPty2 as any);
      const inst2 = PtyManager.spawnPi(mockCwd);

      expect(PtyManager.getAllPids()).toEqual([1001, 1003]);
      expect(PtyManager.getAllShellPids()).toEqual([1002, 1004]);
    });
  });
});
