/** pi-web frontend */

const API_BASE = "";
let token = localStorage.getItem("pi-web-token") || "";
let activeInstanceId = null;
const instances = new Map(); // id -> { ws, term, fitAddon, cwd }

/* ---------- Login ---------- */

const loginOverlay = document.getElementById("login-overlay");
const tokenInput = document.getElementById("token-input");
const loginBtn = document.getElementById("login-btn");

if (token) {
  loginOverlay.classList.add("hidden");
  initApp();
}

loginBtn.addEventListener("click", () => {
  token = tokenInput.value.trim();
  if (!token) return;
  localStorage.setItem("pi-web-token", token);
  loginOverlay.classList.add("hidden");
  initApp();
});

/* ---------- App init ---------- */

function initApp() {
  refreshInstanceList();
  setInterval(refreshInstanceList, 3000);
}

/* ---------- API helpers ---------- */

async function api(method, path, body) {
  const opts = {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-Pi-Token": token,
    },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(API_BASE + "/api" + path, opts);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

/* ---------- Instance list ---------- */

const instanceList = document.getElementById("instance-list");
const statusText = document.getElementById("status-text");

async function refreshInstanceList() {
  try {
    const list = await api("GET", "/instances");
    renderInstanceList(list);
    statusText.textContent = `${list.length} active`;
  } catch (e) {
    statusText.textContent = "Error";
  }
}

function renderInstanceList(list) {
  instanceList.innerHTML = "";
  for (const item of list) {
    const li = document.createElement("li");
    if (item.id === activeInstanceId) li.classList.add("active");

    const cwdSpan = document.createElement("span");
    cwdSpan.className = "instance-cwd";
    cwdSpan.textContent = item.cwd;
    cwdSpan.title = item.cwd;
    li.appendChild(cwdSpan);

    const close = document.createElement("span");
    close.className = "instance-close";
    close.textContent = "×";
    close.addEventListener("click", async (e) => {
      e.stopPropagation();
      await api("POST", `/instances/${item.id}/kill`);
      removeInstance(item.id);
      refreshInstanceList();
    });
    li.appendChild(close);

    li.addEventListener("click", () => switchToInstance(item.id));
    instanceList.appendChild(li);
  }
}

/* ---------- Create instance ---------- */

async function createInstance(cwd) {
  const { id } = await api("POST", "/instances", { cwd });
  await attachInstance(id, cwd);
  refreshInstanceList();
  return id;
}

async function attachInstance(id, cwd) {
  if (instances.has(id)) return;

  const ws = new WebSocket(
    `ws://${location.host}/ws?instance=${id}&token=${encodeURIComponent(token)}`
  );

  const term = new Terminal({
    fontSize: 14,
    fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
    cursorBlink: true,
    allowProposedApi: true,
  });

  const fitAddon = new FitAddon.FitAddon();
  term.loadAddon(fitAddon);

  const pane = document.createElement("div");
  pane.className = "terminal-pane";
  document.getElementById("terminals").appendChild(pane);
  term.open(pane);
  fitAddon.fit();

  instances.set(id, { ws, term, fitAddon, cwd, pane });

  ws.addEventListener("open", () => {
    fitAddon.fit();
    term.focus();
  });

  ws.addEventListener("message", (event) => {
    try {
      const msg = JSON.parse(event.data);
      if (msg.type === "data") {
        term.write(msg.data);
      } else if (msg.type === "exit") {
        term.writeln(`\r\n\x1b[31m[pi exited${msg.exitCode !== undefined ? " with code " + msg.exitCode : ""}]\x1b[0m`);
        removeInstance(id);
        refreshInstanceList();
      }
    } catch {
      // ignore
    }
  });

  ws.addEventListener("close", () => {
    term.writeln("\r\n\x1b[33m[Connection closed]\x1b[0m");
    removeInstance(id);
    refreshInstanceList();
  });

  term.onData((data) => {
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify({ type: "input", data }));
    }
  });

  term.onResize(({ cols, rows }) => {
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify({ type: "resize", cols, rows }));
    }
  });

  window.addEventListener("resize", () => fitAddon.fit());

  addTab(id, cwd);
  switchToInstance(id);
}

function removeInstance(id) {
  const inst = instances.get(id);
  if (!inst) return;
  try { inst.ws.close(); } catch {}
  inst.term.dispose();
  inst.pane.remove();
  instances.delete(id);
  removeTab(id);
  if (activeInstanceId === id) {
    activeInstanceId = null;
    const remaining = Array.from(instances.keys());
    if (remaining.length > 0) switchToInstance(remaining[0]);
  }
}

/* ---------- Tabs ---------- */

const tabsEl = document.getElementById("tabs");

function addTab(id, cwd) {
  if (document.querySelector(`.tab[data-id="${id}"]`)) return;
  const tab = document.createElement("div");
  tab.className = "tab";
  tab.dataset.id = id;
  tab.innerHTML = `<span class="tab-label">${basename(cwd)}</span><span class="tab-close">×</span>`;
  tab.querySelector(".tab-close").addEventListener("click", (e) => {
    e.stopPropagation();
    removeInstance(id);
    refreshInstanceList();
  });
  tab.addEventListener("click", () => switchToInstance(id));
  tabsEl.appendChild(tab);
}

function removeTab(id) {
  const tab = document.querySelector(`.tab[data-id="${id}"]`);
  if (tab) tab.remove();
}

function switchToInstance(id) {
  activeInstanceId = id;

  for (const el of document.querySelectorAll(".tab")) {
    el.classList.toggle("active", el.dataset.id === id);
  }
  for (const [k, v] of instances) {
    v.pane.classList.toggle("active", k === id);
    if (k === id) {
      setTimeout(() => {
        v.fitAddon.fit();
        v.term.focus();
      }, 0);
    }
  }
  for (const li of instanceList.querySelectorAll("li")) {
    // find which instance this li belongs to via click handler closure is hard,
    // so just re-render
  }
  refreshInstanceList();
}

function basename(p) {
  return p.replace(/\\/g, "/").split("/").filter(Boolean).pop() || p;
}

/* ---------- Sidebar buttons ---------- */

document.getElementById("new-session-btn").addEventListener("click", async () => {
  const cwd = document.getElementById("new-cwd-input").value.trim() || "/home/dev";
  await createInstance(cwd);
});

document.getElementById("new-cwd-btn").addEventListener("click", async () => {
  const cwd = document.getElementById("new-cwd-input").value.trim();
  if (!cwd) return;
  await createInstance(cwd);
});

document.getElementById("new-cwd-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter") document.getElementById("new-cwd-btn").click();
});
