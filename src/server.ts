import express from "express";
import { createServer } from "https";
import { readFileSync } from "fs";
import { WebSocketServer } from "ws";
import { join } from "path";
import { loadConfig, getConfigPath } from "./config";
import * as PtyManager from "./pty-manager";
import sessionApi from "./session-api";

const app = express();
const server = createServer({
  key: readFileSync(join(__dirname, "../certs/key.pem")),
  cert: readFileSync(join(__dirname, "../certs/cert.pem")),
}, app);
const wss = new WebSocketServer({ server, path: "/ws" });

app.use(express.json());
app.use("/api", sessionApi);
app.use(express.static(join(__dirname, "../public"), {
  setHeaders: (res) => {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
  },
}));

app.get("/config-info", (_req, res) => {
  const config = loadConfig();
  res.json({
    port: config.port,
    agentDir: config.agentDir,
    configPath: getConfigPath(),
    // Never expose the token in the API response
  });
});

wss.on("connection", (ws, req) => {
  const url = new URL(req.url || "", `http://localhost`);
  const instanceId = url.searchParams.get("instance");
  const token = url.searchParams.get("token");
  const config = loadConfig();

  if (token !== config.token) {
    ws.close(1008, "Invalid token");
    return;
  }

  if (!instanceId) {
    ws.close(1008, "Missing instance");
    return;
  }

  const target = (url.searchParams.get("target") as "pi" | "shell") || "pi";
  if (target !== "pi" && target !== "shell") {
    ws.close(1008, "Invalid target");
    return;
  }

  const instance = PtyManager.getInstance(instanceId);
  if (!instance) {
    ws.close(1008, "Instance not found");
    return;
  }

  PtyManager.attachWebSocket(instanceId, ws, target);

  // Replay recent PTY output so new clients see current TUI state.
  const buffer = target === "pi" ? instance.replayBuffer : instance.shellReplayBuffer;
  if (buffer) {
    ws.send(JSON.stringify({ type: "data", instanceId: instanceId, data: buffer }));
  }

  // Nudge pi to redraw its TUI (SIGWINCH may be lost during suspend)
  if (target === "pi") {
    PtyManager.redrawInstance(instanceId);
  }

  ws.on("message", (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.type === "input") {
        PtyManager.sendInput(instanceId, msg.data, target);
      } else if (msg.type === "resize") {
        PtyManager.resizeInstance(instanceId, msg.cols, msg.rows, target);
      }
    } catch {
      // ignore malformed messages
    }
  });

  ws.on("close", () => {
    PtyManager.detachWebSocket(instanceId, ws, target);
  });
});

const config = loadConfig();
server.listen(config.port, () => {
  console.log(`pi-web listening on https://localhost:${config.port}`);
  console.log(`Config: ${getConfigPath()}`);
  console.log(`Token: ${config.token}`);
});
