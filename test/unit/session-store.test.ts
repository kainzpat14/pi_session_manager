import {
  readdirSync,
  statSync,
  readFileSync,
  unlinkSync,
  existsSync,
  readlinkSync,
} from "fs";
import { join } from "path";
import { homedir } from "os";

jest.mock("fs");
jest.mock("os", () => ({ homedir: jest.fn(() => "/test/home") }));

const mockedReaddirSync = jest.mocked(readdirSync);
const mockedStatSync = jest.mocked(statSync);
const mockedReadFileSync = jest.mocked(readFileSync);
const mockedUnlinkSync = jest.mocked(unlinkSync);
const mockedExistsSync = jest.mocked(existsSync);
const mockedReadlinkSync = jest.mocked(readlinkSync);
const mockedHomedir = jest.mocked(homedir);

const {
  listSessions,
  deleteSession,
  findSessionPath,
  findSessionNameByCwd,
} = jest.requireActual<typeof import("../../src/session-store")>("../../src/session-store");

describe("session-store", () => {
  const TEST_HOME = "/test/home";
  const SESSIONS_DIR = join(TEST_HOME, ".pi", "agent", "sessions");

  beforeEach(() => {
    jest.clearAllMocks();
    mockedHomedir.mockReturnValue(TEST_HOME);
  });

  describe("listSessions", () => {
    it("returns empty array when sessions dir does not exist", () => {
      mockedExistsSync.mockReturnValue(false);
      expect(listSessions()).toEqual([]);
    });

    it("returns empty array when sessions dir exists but is empty", () => {
      mockedExistsSync.mockReturnValue(true);
      mockedReaddirSync.mockReturnValue([]);

      expect(listSessions()).toEqual([]);
    });

    it("returns sessions from valid JSONL files", () => {
      const encodedDir = "--home-dev--";
      const dirPath = join(SESSIONS_DIR, encodedDir);
      const fileName = "20240101_120000_abc123.jsonl";
      const filePath = join(dirPath, fileName);

      mockedExistsSync.mockReturnValue(true);
      mockedReaddirSync.mockImplementation((p: any) => {
        if (p === SESSIONS_DIR) return [encodedDir] as any;
        if (p === dirPath) return [fileName] as any;
        return [] as any;
      });
      mockedStatSync.mockReturnValue({
        isDirectory: () => true,
        size: 100,
      } as any);
      mockedReadFileSync.mockReturnValue(
        `{"type":"header","id":"abc123","timestamp":"20240101_120000","cwd":"/home/dev"}\n` +
          `{"type":"session_info","name":"Test Session"}\n`
      );

      const sessions = listSessions();
      expect(sessions).toHaveLength(1);
      expect(sessions[0]).toMatchObject({
        id: "abc123",
        timestamp: "20240101_120000",
        cwd: "/home/dev",
        path: filePath,
        size: 100,
        lines: 2,
        name: "Test Session",
      });
    });

    it("sorts sessions by timestamp descending", () => {
      const dirPath = join(SESSIONS_DIR, "--home-dev--");
      const files = [
        "20240101_100000_old.jsonl",
        "20240101_120000_new.jsonl",
      ];

      mockedExistsSync.mockReturnValue(true);
      mockedReaddirSync.mockImplementation((p: any) => {
        if (p === SESSIONS_DIR) return ["--home-dev--"] as any;
        if (p === dirPath) return files as any;
        return [] as any;
      });
      mockedStatSync.mockReturnValue({
        isDirectory: () => true,
        size: 50,
      } as any);
      mockedReadFileSync.mockImplementation((p: any) => {
        const fileName = (p as string).split("/").pop();
        const timestamp = fileName?.split("_")[0] ?? "";
        const time = fileName?.split("_")[1] ?? "";
        return `{"type":"header","timestamp":"${timestamp}_${time}"}\n`;
      });

      const sessions = listSessions();
      expect(sessions[0].timestamp).toBe("20240101_120000");
      expect(sessions[1].timestamp).toBe("20240101_100000");
    });

    it("excludes active paths when provided", () => {
      const dirPath = join(SESSIONS_DIR, "--home-dev--");
      const fileName = "20240101_120000_abc123.jsonl";
      const filePath = join(dirPath, fileName);

      mockedExistsSync.mockReturnValue(true);
      mockedReaddirSync.mockImplementation((p: any) => {
        if (p === SESSIONS_DIR) return ["--home-dev--"] as any;
        if (p === dirPath) return [fileName] as any;
        return [] as any;
      });
      mockedStatSync.mockReturnValue({
        isDirectory: () => true,
        size: 50,
      } as any);
      mockedReadFileSync.mockReturnValue(
        `{"type":"header","id":"abc123","timestamp":"20240101_120000"}\n`
      );

      const activePaths = new Set([filePath]);
      const sessions = listSessions(activePaths);
      expect(sessions).toHaveLength(0);
    });

    it("extracts session name from session_info record", () => {
      const dirPath = join(SESSIONS_DIR, "--home-dev--");
      const fileName = "20240101_120000_abc123.jsonl";

      mockedExistsSync.mockReturnValue(true);
      mockedReaddirSync.mockImplementation((p: any) => {
        if (p === SESSIONS_DIR) return ["--home-dev--"] as any;
        if (p === dirPath) return [fileName] as any;
        return [] as any;
      });
      mockedStatSync.mockReturnValue({
        isDirectory: () => true,
        size: 50,
      } as any);
      mockedReadFileSync.mockReturnValue(
        `{"type":"header","id":"abc123","timestamp":"20240101_120000"}\n` +
          `{"type":"other","data":"x"}\n` +
          `{"type":"session_info","name":"Named Session"}\n`
      );

      const sessions = listSessions();
      expect(sessions[0].name).toBe("Named Session");
    });
  });

  describe("deleteSession", () => {
    it("deletes session file by id", () => {
      const dirPath = join(SESSIONS_DIR, "--home-dev--");
      const fileName = "20240101_120000_abc123.jsonl";
      const filePath = join(dirPath, fileName);

      mockedExistsSync.mockReturnValue(true);
      mockedReaddirSync.mockImplementation((p: any) => {
        if (p === SESSIONS_DIR) return ["--home-dev--"] as any;
        if (p === dirPath) return [fileName] as any;
        return [] as any;
      });
      mockedStatSync.mockReturnValue({
        isDirectory: () => true,
        size: 50,
      } as any);
      mockedReadFileSync.mockReturnValue(
        `{"type":"header","id":"abc123","timestamp":"20240101_120000"}\n`
      );
      mockedUnlinkSync.mockReturnValue(undefined);

      expect(deleteSession("abc123")).toBe(true);
      expect(mockedUnlinkSync).toHaveBeenCalledWith(filePath);
    });

    it("returns false when session not found", () => {
      mockedExistsSync.mockReturnValue(false);
      expect(deleteSession("nonexistent")).toBe(false);
    });
  });

  describe("findSessionPath", () => {
    it("finds path by session id", () => {
      const dirPath = join(SESSIONS_DIR, "--home-dev--");
      const fileName = "20240101_120000_abc123.jsonl";
      const filePath = join(dirPath, fileName);

      mockedExistsSync.mockReturnValue(true);
      mockedReaddirSync.mockImplementation((p: any) => {
        if (p === SESSIONS_DIR) return ["--home-dev--"] as any;
        if (p === dirPath) return [fileName] as any;
        return [] as any;
      });
      mockedStatSync.mockReturnValue({
        isDirectory: () => true,
        size: 50,
      } as any);
      mockedReadFileSync.mockReturnValue(
        `{"type":"header","id":"abc123","timestamp":"20240101_120000"}\n`
      );

      expect(findSessionPath("abc123")).toBe(filePath);
    });

    it("returns undefined when session not found", () => {
      mockedExistsSync.mockReturnValue(false);
      expect(findSessionPath("nonexistent")).toBeUndefined();
    });
  });

  describe("findSessionNameByCwd", () => {
    it("returns undefined when no session directory exists", () => {
      mockedExistsSync.mockReturnValue(false);
      expect(findSessionNameByCwd("/home/dev")).toBeUndefined();
    });

    it("returns name from latest JSONL file in cwd", () => {
      const dirPath = join(SESSIONS_DIR, "--home-dev--");
      const files = [
        "20240101_100000_old.jsonl",
        "20240101_120000_new.jsonl",
      ];

      mockedExistsSync.mockReturnValue(true);
      mockedReaddirSync.mockReturnValue(files as any);
      mockedStatSync.mockImplementation((p: any) => {
        const fileName = (p as string).split("/").pop() ?? "";
        return {
          mtimeMs: fileName.includes("new") ? 2000 : 1000,
        } as any;
      });
      mockedReadFileSync.mockImplementation((p: any) => {
        const fileName = (p as string).split("/").pop() ?? "";
        if (fileName.includes("new")) {
          return `{"type":"session_info","name":"Newest Session"}\n`;
        }
        return `{"type":"session_info","name":"Old Session"}\n`;
      });

      expect(findSessionNameByCwd("/home/dev")).toBe("Newest Session");
    });
  });

  describe("listSessions with external active dir filtering", () => {
    it("returns sessions even with external pi processes", () => {
      const encodedDir = "--home-dev--";
      const dirPath = join(SESSIONS_DIR, encodedDir);
      const fileName = "20240101_120000_abc123.jsonl";

      mockedExistsSync.mockImplementation((p: any) => {
        if (p === SESSIONS_DIR) return true;
        return true;
      });
      mockedReaddirSync.mockImplementation((p: any) => {
        if (p === SESSIONS_DIR) return [encodedDir] as any;
        if (p === dirPath) return [fileName] as any;
        return [] as any;
      });
      mockedStatSync.mockImplementation((p: any) => {
        if (typeof p === "string" && p === dirPath)
          return { isDirectory: () => true } as any;
        return { isDirectory: () => true } as any;
      });
      mockedReadFileSync.mockImplementation((p: any) => {
        return "{}\n";
      });

      // listSessions no longer skips directories with external pi processes
      const piWebPids = new Set<number>();
      const sessions = listSessions(undefined, piWebPids);
      expect(sessions).toHaveLength(1);
      expect(sessions[0].id).toBe("abc123");
    });
  });
});
