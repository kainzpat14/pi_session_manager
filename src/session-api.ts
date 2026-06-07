import { Router } from "express";
import * as PtyManager from "./pty-manager";
import { loadConfig } from "./config";
import { existsSync } from "fs";
import { resolve } from "path";

const router = Router();

function requireToken(req: any, res: any, next: any) {
  const config = loadConfig();
  const header = req.headers["x-pi-token"] || req.query.token;
  if (header !== config.token) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}

router.use(requireToken);

router.get("/instances", (_req, res) => {
  res.json(PtyManager.listInstances());
});

router.post("/instances", (req, res) => {
  const { cwd } = req.body as { cwd?: string };
  if (!cwd) {
    res.status(400).json({ error: "Missing cwd" });
    return;
  }
  const resolved = resolve(cwd);
  if (!existsSync(resolved)) {
    res.status(400).json({ error: "Directory does not exist" });
    return;
  }
  const instance = PtyManager.spawnPi(resolved);
  res.json({ id: instance.id, cwd: instance.cwd, pid: instance.pty.pid });
});

router.post("/instances/:id/kill", (req, res) => {
  const ok = PtyManager.killInstance(req.params.id);
  res.json({ ok });
});

router.post("/instances/:id/resize", (req, res) => {
  const { cols, rows } = req.body as { cols?: number; rows?: number };
  if (cols === undefined || rows === undefined) {
    res.status(400).json({ error: "Missing cols or rows" });
    return;
  }
  const ok = PtyManager.resizeInstance(req.params.id, cols, rows);
  res.json({ ok });
});

export default router;
