import { readdirSync, statSync, readFileSync, unlinkSync, existsSync } from "fs";
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
  // pi encodes cwd as URL-safe-ish path segments
  // e.g. "--home-dev--" -> "/home/dev"
  // Let's try a simple decode: replace "--" with "/" and remove leading "/"
  let decoded = dirName.replace(/--/g, "/");
  if (decoded.startsWith("/")) decoded = decoded.slice(1);
  return decoded || dirName;
}

export function listSessions(): SessionEntry[] {
  if (!existsSync(SESSIONS_DIR)) return [];

  const entries: SessionEntry[] = [];

  for (const dirName of readdirSync(SESSIONS_DIR)) {
    const dirPath = join(SESSIONS_DIR, dirName);
    const stat = statSync(dirPath);
    if (!stat.isDirectory()) continue;

    const cwd = decodeCwd(dirName);

    for (const fileName of readdirSync(dirPath)) {
      if (!fileName.endsWith(".jsonl")) continue;
      const filePath = join(dirPath, fileName);
      const fileStat = statSync(filePath);

      let header: any = {};
      try {
        const firstLine = readFileSync(filePath, "utf-8").split("\n")[0];
        if (firstLine) header = JSON.parse(firstLine);
      } catch {
        // ignore malformed
      }

      // Count lines for message count approximation
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

  // Sort newest first
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
