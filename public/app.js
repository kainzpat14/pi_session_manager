/** pi-web frontend */

const API_BASE = "";

/* ---------- DOM element refs ---------- */
const debugLog = document.getElementById("debug-log");
const loginOverlay = document.getElementById("login-overlay");
const tokenInput = document.getElementById("token-input");
const loginBtn = document.getElementById("login-btn");
const sessionList = document.getElementById("session-list");
const statusText = document.getElementById("status-text");
const fsList = document.getElementById("fs-list");
const fsBreadcrumb = document.getElementById("fs-breadcrumb");
const menuToggle = document.getElementById("menu-toggle");
const sidebarOverlay = document.getElementById("sidebar-overlay");
const tabsEl = document.getElementById("tabs");
const piTab = document.getElementById("pi-tab");
const newSessionBtn = document.getElementById("new-session-btn");
const newCwdBtn = document.getElementById("new-cwd-btn");
const newCwdInput = document.getElementById("new-cwd-input");
const pasteBtn = document.getElementById("paste-btn");
const scrollLockBtn = document.getElementById("scroll-lock-btn");
const kbToggle = document.getElementById("kb-toggle");
const kbButtons = document.getElementById("kb-buttons");

/* ---------- State ---------- */
let token = localStorage.getItem("pi-web-token") || "";
let selectedInstanceId = null;   // sidebar selection
let activeTab = "pi";            // "pi" or "shell"
const instances = new Map();     // id -> { cwd, pi: {...}, shell: {...} }
let activeInstances = [];        // from API /instances
let historySessions = [];        // from API /sessions
let fsCurrentPath = "/home/dev";
let scrollLockActive = true;
let folderExpandedState = new Map(); // cwd -> boolean
let folderShowAllHistory = new Map(); // cwd -> boolean

/* ---------- Visible debug logger ---------- */
function logDebug(msg) {
  return; // debug logging disabled
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

/* ---------- Session grouping ---------- */

function getFolderName(cwd) {
  const parts = cwd.replace(/\/$/, "").split("/");
  return parts[parts.length - 1] || cwd;
}

function formatDate(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  return d.toLocaleDateString() + " " + d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

async function refreshInstanceList() {
  try {
    const list = await api("GET", "/instances");
    activeInstances = list;
    if (statusText) statusText.textContent = `${list.length} active`;
    renderSessionGroups();
  } catch (e) {
    if (statusText) statusText.textContent = "Error";
  }
}

async function refreshHistory() {
  try {
    const sessions = await api("GET", "/sessions");
    historySessions = sessions;
    renderSessionGroups();
  } catch (e) {
    if (sessionList) {
      // keep existing rendering, just note the error in status
    }
  }
}

function renderSessionGroups() {
  if (!sessionList) return;
  sessionList.innerHTML = "";

  // Group by cwd
  const folderMap = new Map();

  for (const inst of activeInstances) {
    if (!folderMap.has(inst.cwd)) {
      folderMap.set(inst.cwd, { active: [], history: [] });
    }
    folderMap.get(inst.cwd).active.push(inst);
  }

  for (const s of historySessions) {
    if (!folderMap.has(s.cwd)) {
      folderMap.set(s.cwd, { active: [], history: [] });
    }
    folderMap.get(s.cwd).history.push(s);
  }

  if (folderMap.size === 0) {
    sessionList.innerHTML = "<li class='folder-empty'>No sessions</li>";
    return;
  }

  // Sort folders: active first, then by most recent date
  const folders = Array.from(folderMap.entries()).map(([cwd, data]) => {
    const historySorted = data.history.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    const hasActive = data.active.length > 0;
    const lastActiveDate = data.active.length > 0
      ? Math.max(...data.active.map(i => i.createdAt || 0))
      : 0;
    const lastHistoryDate = historySorted.length > 0
      ? new Date(historySorted[0].timestamp).getTime()
      : 0;
    const lastDate = Math.max(lastActiveDate, lastHistoryDate);
    return { cwd, active: data.active, history: historySorted, hasActive, lastDate };
  });

  folders.sort((a, b) => {
    if (a.hasActive !== b.hasActive) return b.hasActive ? 1 : -1;
    return b.lastDate - a.lastDate;
  });

  for (const folder of folders) {
    const folderEl = document.createElement("li");
    folderEl.className = "session-folder";

    const isExpanded = folderExpandedState.get(folder.cwd) ?? false;
    const showAll = folderShowAllHistory.get(folder.cwd) ?? false;

    const header = document.createElement("div");
    header.className = "folder-header" + (isExpanded ? " expanded" : "");
    if (folder.hasActive) header.classList.add("active-folder");

    const chevron = document.createElement("span");
    chevron.className = "folder-chevron";
    chevron.textContent = "▶";
    header.appendChild(chevron);

    const name = document.createElement("span");
    name.className = "folder-name";
    name.textContent = getFolderName(folder.cwd);
    name.title = folder.cwd;
    header.appendChild(name);

    const badge = document.createElement("span");
    badge.className = "folder-badge";
    const parts = [];
    if (folder.active.length > 0) parts.push(`${folder.active.length} active`);
    const histCount = folder.history.length;
    if (histCount > 0) parts.push(`${histCount} history`);
    badge.textContent = parts.join(", ");
    header.appendChild(badge);

    const plusBtn = document.createElement("span");
    plusBtn.className = "folder-plus-btn";
    plusBtn.textContent = "+";
    plusBtn.title = "New session here";
    plusBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      createInstance(folder.cwd);
    });
    header.appendChild(plusBtn);

    header.addEventListener("click", () => {
      folderExpandedState.set(folder.cwd, !isExpanded);
      renderSessionGroups();
    });

    folderEl.appendChild(header);

    const content = document.createElement("div");
    content.className = "folder-content" + (isExpanded ? "" : " collapsed");

    // Active instances
    for (const item of folder.active) {
      const li = document.createElement("div");
      li.className = "session-instance";
      if (item.id === selectedInstanceId) li.classList.add("active");

      const info = document.createElement("div");
      info.className = "instance-info";

      if (item.name) {
        const nameSpan = document.createElement("span");
        nameSpan.className = "instance-name";
        nameSpan.textContent = item.name;
        nameSpan.title = item.cwd;
        info.appendChild(nameSpan);
      }

      const cwdSpan = document.createElement("span");
      cwdSpan.className = "instance-cwd";
      cwdSpan.textContent = item.cwd;
      cwdSpan.title = item.cwd;
      info.appendChild(cwdSpan);
      li.appendChild(info);

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

      content.appendChild(li);
    }

    // History sessions
    const lastHistory = folder.history[0];
    const olderHistory = folder.history.slice(1);

    if (lastHistory) {
      content.appendChild(renderHistoryItem(lastHistory));
    }

    if (olderHistory.length > 0 && !showAll) {
      const showMore = document.createElement("button");
      showMore.className = "show-more-btn";
      showMore.textContent = `... ${olderHistory.length} more`;
      showMore.addEventListener("click", (e) => {
        e.stopPropagation();
        folderShowAllHistory.set(folder.cwd, true);
        renderSessionGroups();
      });
      content.appendChild(showMore);
    }

    if (showAll) {
      for (const s of olderHistory) {
        content.appendChild(renderHistoryItem(s));
      }
    }

    folderEl.appendChild(content);
    sessionList.appendChild(folderEl);
  }
}

function renderHistoryItem(s) {
  const li = document.createElement("div");
  li.className = "session-history";
  li.dataset.id = s.id;

  const meta = document.createElement("div");
  meta.className = "history-meta";
  meta.innerHTML = `<span class="history-date">${formatDate(s.timestamp)}</span>`;
  li.appendChild(meta);

  if (s.name) {
    const name = document.createElement("div");
    name.className = "history-name";
    name.textContent = s.name;
    name.title = s.cwd;
    li.appendChild(name);
  }

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
  return li;
}

/* ---------- Create instance ---------- */

async function createInstance(cwd) {
  const { id } = await api("POST", "/instances", { cwd });
  folderExpandedState.set(cwd, true);
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
    `wss://${location.host}/ws?instance=${id}&token=${encodeURIComponent(token)}&target=pi`
  );
  const piTerm = new Terminal({
    fontSize: 14,
    fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
    cursorBlink: true,
    allowProposedApi: true,
  });
  const piFit = new FitAddon.FitAddon();
  const piWebLinks = new WebLinksAddon.WebLinksAddon();
  piTerm.loadAddon(piFit);
  piTerm.loadAddon(piWebLinks);
  const piPane = document.createElement("div");
  piPane.className = "terminal-pane";
  document.getElementById("terminals").appendChild(piPane);
  piTerm.open(piPane);
  piTerm.reset();

  entry.pi = { ws: piWs, term: piTerm, fitAddon: piFit, pane: piPane, firstData: true };

  piWs.addEventListener("open", () => {
    if (piPane.classList.contains("active")) {
      piTerm.focus();
    }
    const { cols, rows } = piTerm;
    piWs.send(JSON.stringify({ type: "resize", cols, rows }));
  });

  piWs.addEventListener("message", (event) => {
    try {
      const msg = JSON.parse(event.data);
      if (msg.type === "data") {
        if (entry.pi.firstData) {
          piTerm.write(msg.data, () => piTerm.scrollToBottom());
          entry.pi.firstData = false;
        } else {
          if (scrollLockActive) {
            piTerm.write(msg.data, () => piTerm.scrollToBottom());
          } else {
            piTerm.write(msg.data);
          }
        }
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
    logDebug(`[pi resize id=${id}] ${cols}x${rows}`);
    if (piWs.readyState === piWs.OPEN) {
      piWs.send(JSON.stringify({ type: "resize", cols, rows }));
    }
  });

  // Create shell subsystem
  const shellWs = new WebSocket(
    `wss://${location.host}/ws?instance=${id}&token=${encodeURIComponent(token)}&target=shell`
  );
  const shellTerm = new Terminal({
    fontSize: 14,
    fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
    cursorBlink: true,
    allowProposedApi: true,
  });
  const shellFit = new FitAddon.FitAddon();
  const shellWebLinks = new WebLinksAddon.WebLinksAddon();
  shellTerm.loadAddon(shellFit);
  shellTerm.loadAddon(shellWebLinks);
  const shellPane = document.createElement("div");
  shellPane.className = "shell-pane";
  document.getElementById("terminals").appendChild(shellPane);
  shellTerm.open(shellPane);
  shellTerm.reset();

  entry.shell = { ws: shellWs, term: shellTerm, fitAddon: shellFit, pane: shellPane, firstData: true };

  shellWs.addEventListener("open", () => {
    if (shellPane.classList.contains("active")) {
      shellTerm.focus();
    }
    const { cols, rows } = shellTerm;
    shellWs.send(JSON.stringify({ type: "resize", cols, rows }));
  });

  shellWs.addEventListener("message", (event) => {
    try {
      const msg = JSON.parse(event.data);
      if (msg.type === "data") {
        if (entry.shell.firstData) {
          shellTerm.write(msg.data, () => shellTerm.scrollToBottom());
          entry.shell.firstData = false;
        } else {
          if (scrollLockActive) {
            shellTerm.write(msg.data, () => shellTerm.scrollToBottom());
          } else {
            shellTerm.write(msg.data);
          }
        }
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
    logDebug(`[shell resize id=${id}] ${cols}x${rows}`);
    if (shellWs.readyState === shellWs.OPEN) {
      shellWs.send(JSON.stringify({ type: "resize", cols, rows }));
    }
  });

  instances.set(id, entry);

  // Ensure shared Terminal tab exists
  addTerminalTab();

  selectedInstanceId = id;
  activeTab = "pi";
  updateVisibility();

  if (!window._piWebResizeListener) {
    window._piWebResizeListener = true;
    window.addEventListener("resize", () => {
      logDebug("[window resize]");
      for (const [_, v] of instances) {
        if (v.pi.pane.classList.contains("active")) {
          const dims = v.pi.fitAddon.proposeDimensions();
          logDebug(`[window.resize pi fit] ${dims ? dims.cols + 'x' + dims.rows : 'no dims'}`);
          v.pi.fitAddon.fit();
        }
        if (v.shell.pane.classList.contains("active")) {
          const dims = v.shell.fitAddon.proposeDimensions();
          logDebug(`[window.resize shell fit] ${dims ? dims.cols + 'x' + dims.rows : 'no dims'}`);
          v.shell.fitAddon.fit();
        }
      }
    });
  }

  // iOS Safari may blank the canvas on background/return
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      const entry = instances.get(selectedInstanceId);
      if (!entry) return;
      setTimeout(() => {
        if (activeTab === "pi" && entry.pi.pane.classList.contains("active")) {
          const t = entry.pi.term;
          const f = entry.pi.fitAddon;
          const cols = t.cols;
          const rows = t.rows;
          t.resize(cols - 1, rows);
          t.resize(cols, rows);
          f.fit();
          if (entry.pi.ws.readyState === entry.pi.ws.OPEN) {
            entry.pi.ws.send(JSON.stringify({ type: "resize", cols: t.cols, rows: t.rows }));
          }
          t.refresh(0, rows - 1);
        } else if (activeTab === "shell" && entry.shell.pane.classList.contains("active")) {
          const t = entry.shell.term;
          const f = entry.shell.fitAddon;
          const cols = t.cols;
          const rows = t.rows;
          t.resize(cols - 1, rows);
          t.resize(cols, rows);
          f.fit();
          if (entry.shell.ws.readyState === entry.shell.ws.OPEN) {
            entry.shell.ws.send(JSON.stringify({ type: "resize", cols: t.cols, rows: t.rows }));
          }
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

  if (selectedInstanceId === id) {
    const remaining = Array.from(instances.keys());
    selectedInstanceId = remaining.length > 0 ? remaining[0] : null;
  }
  if (activeTab === "shell") {
    activeTab = "pi";
  }
  if (instances.size === 0) {
    removeTerminalTab();
  }
  updateVisibility();
}

/* ---------- Tabs ---------- */

function addTerminalTab() {
  if (!tabsEl) return;
  // Remove any stale per-instance tabs from old code
  for (const old of document.querySelectorAll('.tab[data-shell-id]')) {
    old.remove();
  }
  if (document.querySelector(".tab.shell-tab")) return;
  const tab = document.createElement("div");
  tab.className = "tab shell-tab";
  tab.textContent = "Terminal";
  tab.addEventListener("click", () => {
    activeTab = "shell";
    updateVisibility();
  });
  const tabGroup = tabsEl.querySelector(".tab-group");
  if (tabGroup) {
    tabGroup.appendChild(tab);
  } else {
    tabsEl.appendChild(tab);
  }
}

function removeTerminalTab() {
  const tab = document.querySelector(".tab.shell-tab");
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
      if (!entry.pi.pane.classList.contains("active")) return;
      const dims = entry.pi.fitAddon.proposeDimensions();
      logDebug(`[updateVisibility pi fit id=${selectedInstanceId}] ${dims ? dims.cols + 'x' + dims.rows : 'no dims'}`);
      entry.pi.fitAddon.fit();
      const { cols, rows } = entry.pi.term;
      if (entry.pi.ws.readyState === entry.pi.ws.OPEN) {
        entry.pi.ws.send(JSON.stringify({ type: "resize", cols, rows }));
      }
      entry.pi.term.focus();
      if (scrollLockActive) entry.pi.term.scrollToBottom();
    }, 0);
  } else if (activeTab === "shell" && selectedInstanceId && instances.has(selectedInstanceId)) {
    const entry = instances.get(selectedInstanceId);
    entry.shell.pane.classList.add("active");
    setTimeout(() => {
      if (!entry.shell.pane.classList.contains("active")) return;
      const dims = entry.shell.fitAddon.proposeDimensions();
      logDebug(`[updateVisibility shell fit id=${selectedInstanceId}] ${dims ? dims.cols + 'x' + dims.rows : 'no dims'}`);
      entry.shell.fitAddon.fit();
      const { cols, rows } = entry.shell.term;
      if (entry.shell.ws.readyState === entry.shell.ws.OPEN) {
        entry.shell.ws.send(JSON.stringify({ type: "resize", cols, rows }));
      }
      entry.shell.term.focus();
      if (scrollLockActive) entry.shell.term.scrollToBottom();
    }, 0);
  }

  // Update tab styling
  if (piTab) {
    piTab.classList.toggle("active", activeTab === "pi");
  }
  const shellTab = document.querySelector(".tab.shell-tab");
  if (shellTab) {
    shellTab.classList.toggle("active", activeTab === "shell");
  }
}

async function resumeSession(sessionId) {
  const { id, cwd } = await api("POST", `/sessions/${sessionId}/resume`);
  folderExpandedState.set(cwd, true);
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

/* ---------- Test hooks ---------- */

if (typeof window !== "undefined") {
  window._piWeb = {
    get instances() { return instances; },
    get selectedInstanceId() { return selectedInstanceId; },
    get activeTab() { return activeTab; },
    getTerminalText(target = "pi") {
      const entry = instances.get(selectedInstanceId);
      if (!entry) return "";
      const term = target === "pi" ? entry.pi.term : entry.shell.term;
      const lines = [];
      for (let i = 0; i < term.rows; i++) {
        const line = term.buffer.active.getLine(i);
        lines.push(line ? line.translateToString() : "");
      }
      return lines.join("\n");
    },
  };
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

if (scrollLockBtn) {
  scrollLockBtn.addEventListener("click", () => {
    scrollLockActive = !scrollLockActive;
    scrollLockBtn.classList.toggle("active", scrollLockActive);
    scrollLockBtn.textContent = scrollLockActive ? "🔒" : "🔓";
    scrollLockBtn.title = scrollLockActive ? "Scroll lock (on)" : "Scroll lock (off)";
    if (scrollLockActive) {
      const entry = instances.get(selectedInstanceId);
      if (entry) {
        const term = activeTab === "pi" ? entry.pi.term : entry.shell.term;
        term.scrollToBottom();
      }
    }
  });
  scrollLockBtn.addEventListener("touchstart", (e) => {
    e.preventDefault();
    scrollLockBtn.click();
  }, { passive: false });
}

if (pasteBtn) {
  pasteBtn.addEventListener("click", async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (!text) return;
      const entry = instances.get(selectedInstanceId);
      if (!entry) return;
      const target = activeTab === "pi" ? entry.pi : entry.shell;
      if (target.ws.readyState === target.ws.OPEN) {
        target.ws.send(JSON.stringify({ type: "input", data: text }));
      }
    } catch (err) {
      console.error("Paste failed:", err);
    }
  });
  pasteBtn.addEventListener("touchstart", (e) => {
    e.preventDefault();
    pasteBtn.click();
  }, { passive: false });
}

/* ---------- Mobile keyboard menu ---------- */

if (kbToggle) {
  kbToggle.addEventListener("click", () => {
    kbButtons.classList.toggle("open");
    kbToggle.classList.toggle("active", kbButtons.classList.contains("open"));
  });
  kbToggle.addEventListener("touchstart", (e) => {
    e.preventDefault();
    kbToggle.click();
  }, { passive: false });
}

if (kbButtons) {
  kbButtons.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-key]");
    if (!btn) return;
    const key = btn.dataset.key;
    const entry = instances.get(selectedInstanceId);
    if (!entry) return;
    const target = activeTab === "pi" ? entry.pi : entry.shell;

    let seq = "";
    switch (key) {
      case "esc": seq = "\x1b"; break;
      case "up": seq = "\x1b[A"; break;
      case "down": seq = "\x1b[B"; break;
      case "enter": seq = "\r"; break;
    }

    if (seq && target.ws.readyState === target.ws.OPEN) {
      target.ws.send(JSON.stringify({ type: "input", data: seq }));
    }
  });
  kbButtons.addEventListener("touchstart", (e) => {
    const btn = e.target.closest("[data-key]");
    if (!btn) return;
    e.preventDefault();
    btn.click();
  }, { passive: false });
}
