/** pi-web frontend */

const API_BASE = "";

/* ---------- DOM element refs ---------- */
const debugLog = document.getElementById("debug-log");
const loginOverlay = document.getElementById("login-overlay");
const tokenInput = document.getElementById("token-input");
const loginBtn = document.getElementById("login-btn");
const instanceList = document.getElementById("instance-list");
const statusText = document.getElementById("status-text");
const historyList = document.getElementById("history-list");
const fsList = document.getElementById("fs-list");
const fsBreadcrumb = document.getElementById("fs-breadcrumb");
const menuToggle = document.getElementById("menu-toggle");
const sidebarOverlay = document.getElementById("sidebar-overlay");
const tabsEl = document.getElementById("tabs");
const piTab = document.getElementById("pi-tab");
const newSessionBtn = document.getElementById("new-session-btn");
const newCwdBtn = document.getElementById("new-cwd-btn");
const newCwdInput = document.getElementById("new-cwd-input");

/* ---------- State ---------- */
let token = localStorage.getItem("pi-web-token") || "";
let selectedInstanceId = null;   // sidebar selection
let activeTab = "pi";            // "pi" or "shell-<id>"
const instances = new Map();     // id -> { cwd, pi: {...}, shell: {...} }
let fsCurrentPath = "/home/dev";

/* ---------- Visible debug logger ---------- */
function logDebug(msg) {
  if (!debugLog) return;
  debugLog.style.display = "block";
  const line = document.createElement("div");
  line.textContent = "[" + new Date().toLocaleTimeString() + "] " + msg;
  debugLog.appendChild(line);
  debugLog.scrollTop = debugLog.scrollHeight;
}

window.onerror = (msg, src, line, col, err) => {
  logDebug("ERROR: " + msg + " @" + line + ":" + col);
};

window.addEventListener("unhandledrejection", (e) => {
  logDebug("PROMISE REJ: " + (e.reason || ""));
});

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

async function refreshInstanceList() {
  try {
    const list = await api("GET", "/instances");
    renderInstanceList(list);
    if (statusText) statusText.textContent = `${list.length} active`;
  } catch (e) {
    if (statusText) statusText.textContent = "Error";
  }
}

function renderInstanceList(list) {
  if (!instanceList) return;
  instanceList.innerHTML = "";
  for (const item of list) {
    const li = document.createElement("li");
    if (item.id === selectedInstanceId) li.classList.add("active");

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

    li.addEventListener("click", async () => {
      closeSidebar();
      selectedInstanceId = item.id;
      if (!instances.has(item.id)) {
        await attachInstance(item.id, item.cwd);
      } else {
        activeTab = "pi";
        updateVisibility();
      }
      refreshInstanceList();
    });
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

  const entry = {
    cwd,
    pi: {},
    shell: {},
  };

  // Create pi subsystem
  const piWs = new WebSocket(
    `ws://${location.host}/ws?instance=${id}&token=${encodeURIComponent(token)}&target=pi`
  );
  const piTerm = new Terminal({
    fontSize: 14,
    fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
    cursorBlink: true,
    allowProposedApi: true,
  });
  const piFit = new FitAddon.FitAddon();
  piTerm.loadAddon(piFit);
  const piPane = document.createElement("div");
  piPane.className = "terminal-pane";
  document.getElementById("terminals").appendChild(piPane);
  piTerm.open(piPane);
  piTerm.reset();
  piFit.fit();

  entry.pi = { ws: piWs, term: piTerm, fitAddon: piFit, pane: piPane };

  piWs.addEventListener("open", () => {
    piFit.fit();
    piTerm.focus();
  });

  piWs.addEventListener("message", (event) => {
    try {
      const msg = JSON.parse(event.data);
      if (msg.type === "data") {
        piTerm.write(msg.data);
      } else if (msg.type === "exit") {
        piTerm.writeln(`\r\n\x1b[31m[pi exited${msg.exitCode !== undefined ? " with code " + msg.exitCode : ""}]\x1b[0m`);
        removeInstance(id);
        refreshInstanceList();
      }
    } catch {
      // ignore
    }
  });

  piWs.addEventListener("close", () => {
    piTerm.writeln("\r\n\x1b[33m[Connection closed]\x1b[0m");
    removeInstance(id);
    refreshInstanceList();
  });

  piTerm.onData((data) => {
    if (piWs.readyState === piWs.OPEN) {
      piWs.send(JSON.stringify({ type: "input", data }));
    }
  });

  piTerm.onResize(({ cols, rows }) => {
    if (piWs.readyState === piWs.OPEN) {
      piWs.send(JSON.stringify({ type: "resize", cols, rows }));
    }
  });

  // Create shell subsystem
  const shellWs = new WebSocket(
    `ws://${location.host}/ws?instance=${id}&token=${encodeURIComponent(token)}&target=shell`
  );
  const shellTerm = new Terminal({
    fontSize: 14,
    fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
    cursorBlink: true,
    allowProposedApi: true,
  });
  const shellFit = new FitAddon.FitAddon();
  shellTerm.loadAddon(shellFit);
  const shellPane = document.createElement("div");
  shellPane.className = "shell-pane";
  document.getElementById("terminals").appendChild(shellPane);
  shellTerm.open(shellPane);
  shellTerm.reset();
  shellFit.fit();

  entry.shell = { ws: shellWs, term: shellTerm, fitAddon: shellFit, pane: shellPane };

  shellWs.addEventListener("open", () => {
    shellFit.fit();
  });

  shellWs.addEventListener("message", (event) => {
    try {
      const msg = JSON.parse(event.data);
      if (msg.type === "data") {
        shellTerm.write(msg.data);
      } else if (msg.type === "exit") {
        shellTerm.writeln(`\r\n\x1b[31m[shell exited${msg.exitCode !== undefined ? " with code " + msg.exitCode : ""}]\x1b[0m`);
        removeInstance(id);
        refreshInstanceList();
      }
    } catch {
      // ignore
    }
  });

  shellWs.addEventListener("close", () => {
    shellTerm.writeln("\r\n\x1b[33m[Connection closed]\x1b[0m");
    removeInstance(id);
    refreshInstanceList();
  });

  shellTerm.onData((data) => {
    if (shellWs.readyState === shellWs.OPEN) {
      shellWs.send(JSON.stringify({ type: "input", data }));
    }
  });

  shellTerm.onResize(({ cols, rows }) => {
    if (shellWs.readyState === shellWs.OPEN) {
      shellWs.send(JSON.stringify({ type: "resize", cols, rows }));
    }
  });

  instances.set(id, entry);

  // Add Terminal tab
  addTerminalTab(id);

  selectedInstanceId = id;
  activeTab = "pi";
  updateVisibility();

  window.addEventListener("resize", () => {
    for (const [_, v] of instances) {
      v.pi.fitAddon.fit();
      v.shell.fitAddon.fit();
    }
  });

  // iOS Safari may blank the canvas on background/return
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      const entry = instances.get(selectedInstanceId);
      if (!entry) return;
      setTimeout(() => {
        if (activeTab === "pi") {
          const t = entry.pi.term;
          const f = entry.pi.fitAddon;
          const cols = t.cols;
          const rows = t.rows;
          t.resize(cols - 1, rows);
          t.resize(cols, rows);
          f.fit();
          t.refresh(0, rows - 1);
        } else if (activeTab.startsWith("shell-")) {
          const t = entry.shell.term;
          const f = entry.shell.fitAddon;
          const cols = t.cols;
          const rows = t.rows;
          t.resize(cols - 1, rows);
          t.resize(cols, rows);
          f.fit();
          t.refresh(0, rows - 1);
        }
      }, 100);
    }
  });
}

function removeInstance(id) {
  const entry = instances.get(id);
  if (!entry) return;
  try { entry.pi.ws.close(); } catch {}
  try { entry.shell.ws.close(); } catch {}
  entry.pi.term.dispose();
  entry.shell.term.dispose();
  entry.pi.pane.remove();
  entry.shell.pane.remove();
  instances.delete(id);
  removeTerminalTab(id);

  if (selectedInstanceId === id) {
    const remaining = Array.from(instances.keys());
    selectedInstanceId = remaining.length > 0 ? remaining[0] : null;
  }
  if (activeTab === "shell-" + id) {
    activeTab = "pi";
  }
  updateVisibility();
}

/* ---------- Tabs ---------- */

function addTerminalTab(id) {
  if (!tabsEl) return;
  if (document.querySelector(`.tab[data-shell-id="${id}"]`)) return;
  const tab = document.createElement("div");
  tab.className = "tab";
  tab.dataset.shellId = id;
  tab.textContent = "Terminal";
  tab.addEventListener("click", () => {
    activeTab = "shell-" + id;
    updateVisibility();
  });
  tabsEl.appendChild(tab);
}

function removeTerminalTab(id) {
  const tab = document.querySelector(`.tab[data-shell-id="${id}"]`);
  if (tab) tab.remove();
}

function updateVisibility() {
  // Hide all panes
  for (const [_, v] of instances) {
    v.pi.pane.classList.remove("active");
    v.shell.pane.classList.remove("active");
  }

  // Show active pane
  if (activeTab === "pi" && selectedInstanceId && instances.has(selectedInstanceId)) {
    const entry = instances.get(selectedInstanceId);
    entry.pi.pane.classList.add("active");
    setTimeout(() => {
      entry.pi.fitAddon.fit();
      entry.pi.term.focus();
    }, 0);
  } else if (activeTab.startsWith("shell-")) {
    const id = activeTab.slice(6);
    if (instances.has(id)) {
      const entry = instances.get(id);
      entry.shell.pane.classList.add("active");
      setTimeout(() => {
        entry.shell.fitAddon.fit();
        entry.shell.term.focus();
      }, 0);
    }
  }

  // Update tab styling
  if (piTab) {
    piTab.classList.toggle("active", activeTab === "pi");
  }
  for (const tab of document.querySelectorAll(".tab")) {
    const tabId = tab.dataset.shellId;
    tab.classList.toggle("active", tabId && activeTab === "shell-" + tabId);
  }
}

/* ---------- Session history ---------- */

async function refreshHistory() {
  try {
    const sessions = await api("GET", "/sessions");
    renderHistory(sessions);
  } catch (e) {
    if (historyList) historyList.innerHTML = "<li class='history-empty'>Error loading</li>";
  }
}

function formatDate(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  return d.toLocaleDateString() + " " + d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function renderHistory(sessions) {
  if (!historyList) return;
  historyList.innerHTML = "";
  if (sessions.length === 0) {
    historyList.innerHTML = "<li class='history-empty'>No past sessions</li>";
    return;
  }
  for (const s of sessions) {
    const li = document.createElement("li");
    li.className = "history-item";
    li.dataset.id = s.id;

    const meta = document.createElement("div");
    meta.className = "history-meta";
    meta.innerHTML = `<span class="history-date">${formatDate(s.timestamp)}</span>`;
    li.appendChild(meta);

    const cwd = document.createElement("div");
    cwd.className = "history-cwd";
    cwd.textContent = s.cwd;
    cwd.title = s.cwd;
    li.appendChild(cwd);

    const actions = document.createElement("div");
    actions.className = "history-actions";

    const resumeBtn = document.createElement("button");
    resumeBtn.textContent = "▶";
    resumeBtn.title = "Resume session";
    resumeBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      closeSidebar();
      await resumeSession(s.id);
    });
    actions.appendChild(resumeBtn);

    const delBtn = document.createElement("button");
    delBtn.textContent = "🗑";
    delBtn.title = "Delete session";
    delBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (!confirm("Delete this session permanently?")) return;
      await api("DELETE", `/sessions/${s.id}`);
      refreshHistory();
    });
    actions.appendChild(delBtn);

    li.appendChild(actions);
    historyList.appendChild(li);
  }
}

async function resumeSession(sessionId) {
  const { id, cwd } = await api("POST", `/sessions/${sessionId}/resume`);
  await attachInstance(id, cwd);
  refreshInstanceList();
}

/* ---------- File explorer ---------- */

async function loadFs(path) {
  if (!fsList || !fsBreadcrumb) return;
  try {
    const data = await api("GET", `/fs?path=${encodeURIComponent(path)}`);
    fsCurrentPath = data.path;
    renderFs(data);
    if (newCwdInput) newCwdInput.value = data.path;
  } catch (e) {
    fsList.innerHTML = "<li class='fs-item file'><span class='fs-icon'>⚠</span><span class='fs-name'>Error loading</span></li>";
  }
}

function renderFs(data) {
  if (!fsList || !fsBreadcrumb) return;
  fsList.innerHTML = "";

  // Breadcrumb
  if (data.parent) {
    fsBreadcrumb.textContent = "↑ " + data.path;
    fsBreadcrumb.title = "Go up to " + data.parent;
    fsBreadcrumb.onclick = () => loadFs(data.parent);
  } else {
    fsBreadcrumb.textContent = data.path;
    fsBreadcrumb.title = data.path;
    fsBreadcrumb.onclick = null;
  }

  // Create session here button
  const createBtn = document.createElement("button");
  createBtn.className = "fs-create-btn";
  createBtn.textContent = "+ New session here";
  createBtn.addEventListener("click", async () => {
    closeSidebar();
    await createInstance(data.path);
  });
  fsList.appendChild(createBtn);

  for (const entry of data.entries) {
    const li = document.createElement("li");
    li.className = "fs-item " + entry.type;

    const icon = document.createElement("span");
    icon.className = "fs-icon";
    icon.textContent = entry.type === "dir" ? "📁" : "📄";
    li.appendChild(icon);

    const name = document.createElement("span");
    name.className = "fs-name";
    name.textContent = entry.name;
    li.appendChild(name);

    if (entry.type === "dir") {
      li.addEventListener("click", () => loadFs(entry.path));
    }

    fsList.appendChild(li);
  }
}

/* ---------- Mobile menu toggle ---------- */

function openSidebar() {
  const sidebar = document.getElementById("sidebar");
  if (sidebar) sidebar.classList.add("open");
  if (sidebarOverlay) sidebarOverlay.classList.add("open");
}

function closeSidebar() {
  const sidebar = document.getElementById("sidebar");
  if (sidebar) sidebar.classList.remove("open");
  if (sidebarOverlay) sidebarOverlay.classList.remove("open");
}

function toggleSidebar() {
  const sidebar = document.getElementById("sidebar");
  if (sidebar && sidebar.classList.contains("open")) {
    closeSidebar();
  } else {
    openSidebar();
  }
}

if (menuToggle) {
  menuToggle.addEventListener("click", toggleSidebar);
  menuToggle.addEventListener("touchstart", (e) => {
    e.preventDefault();
    toggleSidebar();
  }, { passive: false });
}

if (sidebarOverlay) {
  sidebarOverlay.addEventListener("click", closeSidebar);
}

/* ---------- App init ---------- */

function initApp() {
  refreshInstanceList();
  refreshHistory();
  loadFs(fsCurrentPath);
  setInterval(refreshInstanceList, 3000);
  setInterval(refreshHistory, 10000);
}

/* ---------- Event listeners ---------- */

if (token) {
  if (loginOverlay) loginOverlay.classList.add("hidden");
  initApp();
}

if (loginBtn) {
  loginBtn.addEventListener("click", () => {
    token = tokenInput.value.trim();
    if (!token) return;
    localStorage.setItem("pi-web-token", token);
    if (loginOverlay) loginOverlay.classList.add("hidden");
    initApp();
  });
}

if (piTab) {
  piTab.addEventListener("click", () => {
    activeTab = "pi";
    updateVisibility();
  });
}

if (newSessionBtn) {
  newSessionBtn.addEventListener("click", async () => {
    const cwd = fsCurrentPath || "/home/dev";
    closeSidebar();
    await createInstance(cwd);
  });
}

if (newCwdBtn) {
  newCwdBtn.addEventListener("click", async () => {
    if (!newCwdInput) return;
    const cwd = newCwdInput.value.trim();
    if (!cwd) return;
    closeSidebar();
    await createInstance(cwd);
  });
}

if (newCwdInput) {
  newCwdInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && newCwdBtn) newCwdBtn.click();
  });
}
