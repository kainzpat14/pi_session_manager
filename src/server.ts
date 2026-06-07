import express from "express";
import { createServer } from "http";
import { WebSocketServer } from "ws";
import { join } from "path";
import { loadConfig, getConfigPath } from "./config";
import * as PtyManager from "./pty-manager";
import sessionApi from "./session-api";

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });

app.use(express.json());
app.use("/api", sessionApi);
app.use(express.static(join(__dirname, "../public")));

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

  const instance = PtyManager.getInstance(instanceId);
  if (!instance) {
    ws.close(1008, "Instance not found");
    return;
  }

  PtyManager.attachWebSocket(instanceId, ws);

  // Replay recent PTY output so new clients see current TUI state
  if (instance.replayBuffer) {
    ws.send(JSON.stringify({ type: "data", instanceId: instanceId, data: instance.replayBuffer }));
  }

  // Nudge pi to redraw its TUI (SIGWINCH may be lost during suspend)
  PtyManager.redrawInstance(instanceId);

  ws.on("message", (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.type === "input") {
        PtyManager.sendInput(instanceId, msg.data);
      } else if (msg.type === "resize") {
        PtyManager.resizeInstance(instanceId, msg.cols, msg.rows);
      }
    } catch {
      // ignore malformed messages
    }
  });

  ws.on("close", () => {
    PtyManager.detachWebSocket(instanceId, ws);
  });
});

const config = loadConfig();
server.listen(config.port, () => {
  console.log(`pi-web listening on http://localhost:${config.port}`);
  console.log(`Config: ${getConfigPath()}`);
  console.log(`Token: ${config.token}`);
});
