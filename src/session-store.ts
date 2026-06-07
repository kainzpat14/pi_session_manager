import { readdirSync, statSync, readFileSync, unlinkSync, existsSync, readlinkSync } from "fs";
import { join, basename } from "path";
import { homedir } from "os";

const SESSIONS_DIR = join(homedir(), ".pi", "agent", "sessions");

export interface SessionEntry {
  id: string;
  timestamp: string;
  cwd: string;
  path: string;
  size: number;
  lines: number;
}

function decodeCwd(dirName: string): string {
  const inner = dirName.replace(/^--/, "").replace(/--$/, "");
  return "/" + inner.replace(/-/g, "/");
}

function encodeCwd(cwd: string): string {
  return "--" + cwd.replace(/^\//, "").replace(/\//g, "-") + "--";
}

function isPiProcess(pid: number, piWebPids: Set<number>): boolean {
  if (piWebPids.has(pid)) return false;
  try {
    const exe = readlinkSync(`/proc/${pid}/exe`);
    const cmdline = readFileSync(`/proc/${pid}/cmdline`, "utf-8");
    const exeName = basename(exe);
    // "pi" binary, or node running pi
    return exeName === "pi" || (exeName === "node" && cmdline.includes("pi"));
  } catch {
    return false;
  }
}

function getExternallyActiveSessionDirs(piWebPids: Set<number>): Set<string> {
  const dirs = new Set<string>();
  try {
    for (const entry of readdirSync("/proc")) {
      const pid = parseInt(entry, 10);
      if (Number.isNaN(pid)) continue;
      if (!isPiProcess(pid, piWebPids)) continue;
      try {
        const cwd = readlinkSync(`/proc/${pid}/cwd`);
        dirs.add(encodeCwd(cwd));
      } catch {
        // process exited between check and read
      }
    }
  } catch {
    // /proc not available
  }
  return dirs;
}

export function listSessions(excludePaths?: Set<string>, piWebPids?: Set<number>): SessionEntry[] {
  if (!existsSync(SESSIONS_DIR)) return [];

  const externalDirs = getExternallyActiveSessionDirs(piWebPids ?? new Set());
  const entries: SessionEntry[] = [];

  for (const dirName of readdirSync(SESSIONS_DIR)) {
    const dirPath = join(SESSIONS_DIR, dirName);
    const stat = statSync(dirPath);
    if (!stat.isDirectory()) continue;

    const cwd = decodeCwd(dirName);

    // Skip entire directory if an external pi process is running there
    if (externalDirs.has(dirName)) continue;

    for (const fileName of readdirSync(dirPath)) {
      if (!fileName.endsWith(".jsonl")) continue;
      const filePath = join(dirPath, fileName);
      const fileStat = statSync(filePath);

      // Skip if actively managed by pi-web
      if (excludePaths?.has(filePath)) continue;

      let header: any = {};
      try {
        const firstLine = readFileSync(filePath, "utf-8").split("\n")[0];
        if (firstLine) header = JSON.parse(firstLine);
      } catch {
        // ignore malformed
      }

      let lines = 0;
      try {
        const content = readFileSync(filePath, "utf-8");
        lines = content.split("\n").filter(Boolean).length;
      } catch {
        // ignore
      }

      entries.push({
        id: header.id || basename(fileName, ".jsonl").split("_").pop() || fileName,
        timestamp: header.timestamp || fileName.split("_")[0] || "",
        cwd: header.cwd || cwd,
        path: filePath,
        size: fileStat.size,
        lines,
      });
    }
  }

  return entries.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}

export function deleteSession(id: string): boolean {
  for (const entry of listSessions()) {
    if (entry.id === id) {
      try {
        unlinkSync(entry.path);
        return true;
      } catch {
        return false;
      }
    }
  }
  return false;
}

export function findSessionPath(id: string): string | undefined {
  for (const entry of listSessions()) {
    if (entry.id === id) return entry.path;
  }
  return undefined;
}
