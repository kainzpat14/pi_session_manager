import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";

export interface WebConfig {
  port: number;
  token: string;
  agentDir: string;
}

const CONFIG_DIR = join(homedir(), ".pi", "agent");
const CONFIG_PATH = process.env.PI_WEB_CONFIG_PATH
  ? process.env.PI_WEB_CONFIG_PATH
  : join(CONFIG_DIR, "web-config.json");

function generateToken(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let token = "";
  for (let i = 0; i < 32; i++) {
    token += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return token;
}

export function loadConfig(): WebConfig {
  if (existsSync(CONFIG_PATH)) {
    try {
      const raw = readFileSync(CONFIG_PATH, "utf-8");
      const parsed = JSON.parse(raw) as Partial<WebConfig>;
      return {
        port: parsed.port ?? 3456,
        token: parsed.token ?? generateToken(),
        agentDir: parsed.agentDir ?? CONFIG_DIR,
      };
    } catch {
      // fall through to defaults
    }
  }
  const defaults: WebConfig = {
    port: 3456,
    token: generateToken(),
    agentDir: CONFIG_DIR,
  };
  saveConfig(defaults);
  return defaults;
}

export function saveConfig(config: WebConfig): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + "\n");
}

export function getConfigPath(): string {
  return CONFIG_PATH;
}
