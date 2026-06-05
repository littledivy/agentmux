import { useEffect, useRef, useState } from "preact/hooks";
import Workspace from "../components/Workspace.tsx";
import { type SessionMeta } from "../components/Terminal.tsx";
import { type AgentKind, type AgentState } from "../components/agentDetect.ts";
import {
  ensureNotifyPermission,
  notify,
  setBadge,
} from "../components/native.ts";
import {
  type Dir,
  firstLeaf,
  leaves,
  type Node,
  removeLeaf,
  setRatio,
  splitLeaf,
  termLeaf,
} from "../components/layout.ts";

// Model: sidebar = workspaces; each workspace has tabs; each tab is a split
// tree of terminal panes. A tab's panes are tmux sessions named
// `<ws>-t<k>` (first pane) and `<ws>-t<k>-p<n>` (splits). The workspace name
// `agentmux-<n>` is just a UI group.

interface Ws {
  name: string;
}

const AGENT_LABEL: Record<AgentKind, string> = {
  claude: "Claude",
  codex: "Codex",
  shell: "Shell",
};

const DOT: Record<AgentState, string> = {
  working: "bg-emerald-400",
  waiting: "bg-amber-400",
  idle: "bg-neutral-500",
  shell: "bg-sky-400",
};

const STATE_ORDER: Record<AgentState, number> = {
  working: 3,
  waiting: 2,
  idle: 1,
  shell: 0,
};

const wsOfTab = (tabId: string) => tabId.replace(/-t\d+$/, "");

function nextWsName(workspaces: Ws[]): string {
  let max = 0;
  for (const w of workspaces) {
    const m = w.name.match(/^agentmux-(\d+)$/);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `agentmux-${max + 1}`;
}

function nextTabNum(tabIds: string[]): number {
  let max = 0;
  for (const id of tabIds) {
    const m = id.match(/-t(\d+)$/);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return max + 1;
}

// Last path segment of a ~-relative dir, keeping "~" for home.
function lastSeg(p: string): string {
  if (!p) return "";
  if (p === "~") return "~";
  return p.replace(/\/+$/, "").split("/").filter(Boolean).pop() || p;
}

export default function Dashboard({ transparentTitlebar = false }: {
  transparentTitlebar?: boolean;
}) {
  const [workspaces, setWorkspaces] = useState<Ws[]>([]);
  const [activeWs, setActiveWs] = useState("");
  const [tabsByWs, setTabsByWs] = useState<Record<string, string[]>>({});
  const [activeTab, setActiveTab] = useState<Record<string, string>>({});
  const [layouts, setLayouts] = useState<Record<string, Node>>({});
  const [focusedPane, setFocusedPane] = useState<Record<string, string>>({});
  const [metas, setMetas] = useState<Record<string, SessionMeta>>({});
  const [attention, setAttention] = useState<Record<string, boolean>>({}); // by tabId
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [toast, setToast] = useState<{ title: string; body: string } | null>(null);
  // Custom names (rename) keyed by workspace / tab / pane id, persisted so they
  // survive restarts alongside the tmux sessions.
  const [names, setNames] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<string | null>(null);
  const [editVal, setEditVal] = useState("");
  // tmux session name -> current dir (home shown as ~), polled from the server.
  const [cwds, setCwds] = useState<Record<string, string>>({});
  // null = checking, true = installed, false = missing.
  const [tmuxOk, setTmuxOk] = useState<boolean | null>(null);

  useEffect(() => {
    fetch("/api/health")
      .then((r) => r.json())
      .then((j) => setTmuxOk(!!j.tmux))
      .catch(() => setTmuxOk(false));
  }, []);

  useEffect(() => {
    try {
      const r = localStorage.getItem("agentmux:names");
      if (r) setNames(JSON.parse(r));
    } catch { /* ignore */ }
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem("agentmux:names", JSON.stringify(names));
    } catch { /* ignore */ }
  }, [names]);

  const prevMeta = useRef<Record<string, SessionMeta>>({});
  const toastTimer = useRef<number | undefined>(undefined);
  const activeWsRef = useRef(activeWs);
  activeWsRef.current = activeWs;
  const activeTabRef = useRef(activeTab);
  activeTabRef.current = activeTab;
  const layoutsRef = useRef(layouts);
  layoutsRef.current = layouts;

  // Aggregate the most-interesting agent state over a set of tmux term names.
  function aggMeta(terms: string[]): SessionMeta | undefined {
    const ms = terms.map((t) => metas[t]).filter(Boolean) as SessionMeta[];
    if (ms.length === 0) return undefined;
    return ms.reduce((best, m) =>
      STATE_ORDER[m.state] > STATE_ORDER[best.state] ? m : best
    );
  }
  function tabTerms(tabId: string): string[] {
    const l = layouts[tabId];
    return l ? leaves(l).map((x) => x.term) : [];
  }
  function tabMeta(tabId: string) {
    return aggMeta(tabTerms(tabId));
  }
  function wsMeta(ws: string) {
    return aggMeta((tabsByWs[ws] ?? []).flatMap(tabTerms));
  }
  const wsHasAttention = (ws: string) =>
    (tabsByWs[ws] ?? []).some((t) => attention[t]);

  // Names derive from the cwd (home shown as ~); a custom rename wins.
  const termOfTab = (tabId: string) => {
    const l = layouts[tabId];
    return l ? firstLeaf(l).term : tabId;
  };
  // Name priority: custom rename > detected agent (Claude/Codex) > cwd. New
  // sessions start at $HOME, so default to "~" (never flash the internal id).
  function tabLabel(tabId: string): string {
    const custom = names[tabId]?.trim();
    if (custom) return custom;
    const m = tabMeta(tabId);
    if (m && m.agent !== "shell") return AGENT_LABEL[m.agent];
    return lastSeg(cwds[termOfTab(tabId)]) || "~";
  }
  function wsLabel(ws: string): string {
    const at = activeTab[ws];
    return names[ws]?.trim() || (at && tabLabel(at)) || "~";
  }
  function tabSub(tabId: string): string {
    const m = tabMeta(tabId);
    if (m?.state === "working") return m.action || "working…";
    if (m?.state === "waiting") return "needs input";
    return cwds[termOfTab(tabId)] || "~";
  }
  const wsSub = (ws: string) => {
    const at = activeTab[ws];
    return at ? tabSub(at) : "~";
  };

  function startEdit(key: string, current: string) {
    setEditing(key);
    setEditVal(current);
  }
  function commitEdit() {
    if (editing !== null) {
      const v = editVal.trim();
      setNames((n) => {
        const m = { ...n };
        if (v) m[editing] = v;
        else delete m[editing];
        return m;
      });
    }
    setEditing(null);
  }
  function nameEditor(extra = "") {
    return (
      <input
        value={editVal}
        // deno-lint-ignore no-explicit-any
        ref={(el: any) => el?.focus()}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
        onInput={(e) => setEditVal((e.target as HTMLInputElement).value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") commitEdit();
          else if (e.key === "Escape") setEditing(null);
        }}
        onBlur={commitEdit}
        class={`bg-black/40 rounded px-1 outline-none text-white ${extra}`}
      />
    );
  }

  // Find which tab owns a tmux term (for routing background notifications).
  function tabOfTerm(term: string): string | undefined {
    for (const [tabId, l] of Object.entries(layoutsRef.current)) {
      if (leaves(l).some((x) => x.term === term)) return tabId;
    }
    return undefined;
  }

  // Restore workspaces/tabs from surviving tmux sessions; seed one if none.
  useEffect(() => {
    ensureNotifyPermission();
    (async () => {
      let names: string[] = [];
      try {
        const r = await fetch("/api/sessions");
        const j = await r.json();
        names = j.sessions ?? [];
        if (j.paths) setCwds(j.paths);
      } catch { /* none */ }

      const tabRe = /^(agentmux-\d+)-t\d+$/;
      const groups: Record<string, string[]> = {};
      for (const n of names) {
        const m = n.match(tabRe);
        if (m) (groups[m[1]] ??= []).push(n);
        else {
          // split-pane orphans / legacy names — clean up.
          fetch(`/api/sessions?name=${encodeURIComponent(n)}`, { method: "DELETE" })
            .catch(() => {});
        }
      }

      const wsList = Object.keys(groups);
      const lay: Record<string, Node> = {};
      const foc: Record<string, string> = {};
      const tabs: Record<string, string[]> = {};
      const atab: Record<string, string> = {};

      if (wsList.length === 0) {
        const ws = "agentmux-1";
        const tabId = `${ws}-t1`;
        const leaf = termLeaf(tabId);
        lay[tabId] = leaf;
        foc[tabId] = leaf.id;
        tabs[ws] = [tabId];
        atab[ws] = tabId;
        setWorkspaces([{ name: ws }]);
      } else {
        for (const ws of wsList) {
          const ids = groups[ws].sort();
          tabs[ws] = ids;
          atab[ws] = ids[0];
          for (const tabId of ids) {
            const leaf = termLeaf(tabId);
            lay[tabId] = leaf;
            foc[tabId] = leaf.id;
          }
        }
        setWorkspaces(wsList.map((name) => ({ name })));
      }
      setLayouts(lay);
      setFocusedPane(foc);
      setTabsByWs(tabs);
      setActiveTab(atab);
      setActiveWs((wsList[0] ?? "agentmux-1"));
    })();
  }, []);

  // Poll tmux for each session's cwd so names track `cd` live.
  useEffect(() => {
    const tick = async () => {
      try {
        const r = await fetch("/api/sessions");
        const j = await r.json();
        if (j.paths) setCwds(j.paths);
      } catch { /* ignore */ }
    };
    const id = setInterval(tick, 2000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const tabId = activeTab[activeWs];
    const t = tabId ? tabLabel(tabId) : "";
    document.title = t ? `${t} — agentmux` : "agentmux";
  }, [cwds, names, metas, activeWs, activeTab, layouts]);

  useEffect(() => {
    const n = Object.keys(attention).length;
    setBadge(n ? String(n) : "");
  }, [attention]);

  function showToast(t: string, body: string) {
    setToast({ title: t, body });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 4000);
  }
  // Fire native notification; fall back to an in-app toast only if the OS
  // didn't show one (permission denied / not the desktop runtime).
  async function ping(t: string, body: string) {
    const shown = await notify(t, body);
    if (!shown) showToast(t, body);
  }

  async function testNotify() {
    const p = await ensureNotifyPermission();
    if (p === "granted") {
      await notify("agentmux", "Notifications enabled — you'll be pinged when a background agent finishes.");
    } else {
      showToast("Notifications off", `OS permission: ${p} · using in-app + dock instead`);
    }
  }

  function updateMeta(term: string, m: SessionMeta) {
    const prev = prevMeta.current[term];
    prevMeta.current[term] = m;
    setMetas((cur) => ({ ...cur, [term]: m }));
    if (!prev) return;

    const tabId = tabOfTerm(term);
    if (!tabId) return;
    const ws = wsOfTab(tabId);
    const foreground = ws === activeWsRef.current &&
      tabId === activeTabRef.current[ws];
    if (foreground) return;

    const label = AGENT_LABEL[m.agent];
    if (prev.state === "working" && m.state === "idle" && m.agent !== "shell") {
      ping(`${label} finished`, prev.action || m.action || "");
      setAttention((a) => ({ ...a, [tabId]: true }));
    }
    if (m.state === "waiting" && prev.state !== "waiting") {
      ping(`${label} needs input`, m.action || "");
      setAttention((a) => ({ ...a, [tabId]: true }));
    }
  }

  function clearAttn(tabId: string) {
    setAttention((a) => {
      if (!a[tabId]) return a;
      const n = { ...a };
      delete n[tabId];
      return n;
    });
  }

  function selectWs(name: string) {
    setActiveWs(name);
    const tabId = activeTab[name];
    if (tabId) clearAttn(tabId);
  }

  function selectTab(ws: string, tabId: string) {
    setActiveTab((a) => ({ ...a, [ws]: tabId }));
    clearAttn(tabId);
  }

  function newWorkspace() {
    setWorkspaces((prev) => {
      const name = nextWsName(prev);
      const tabId = `${name}-t1`;
      const leaf = termLeaf(tabId);
      setLayouts((l) => ({ ...l, [tabId]: leaf }));
      setFocusedPane((f) => ({ ...f, [tabId]: leaf.id }));
      setTabsByWs((t) => ({ ...t, [name]: [tabId] }));
      setActiveTab((a) => ({ ...a, [name]: tabId }));
      queueMicrotask(() => setActiveWs(name));
      return [...prev, { name }];
    });
  }

  function newTab(ws: string) {
    setTabsByWs((prev) => {
      const ids = prev[ws] ?? [];
      const tabId = `${ws}-t${nextTabNum(ids)}`;
      const leaf = termLeaf(tabId);
      setLayouts((l) => ({ ...l, [tabId]: leaf }));
      setFocusedPane((f) => ({ ...f, [tabId]: leaf.id }));
      setActiveTab((a) => ({ ...a, [ws]: tabId }));
      return { ...prev, [ws]: [...ids, tabId] };
    });
  }

  function killTabSessions(tabId: string) {
    const l = layouts[tabId];
    if (!l) return;
    for (const leaf of leaves(l)) {
      fetch(`/api/sessions?name=${encodeURIComponent(leaf.term)}`, {
        method: "DELETE",
      }).catch(() => {});
    }
  }

  function closeTab(ws: string, tabId: string) {
    killTabSessions(tabId);
    prevMeta.current = { ...prevMeta.current };
    setLayouts((l) => {
      const n = { ...l };
      delete n[tabId];
      return n;
    });
    setFocusedPane((f) => {
      const n = { ...f };
      delete n[tabId];
      return n;
    });
    clearAttn(tabId);
    setTabsByWs((prev) => {
      const ids = (prev[ws] ?? []).filter((id) => id !== tabId);
      if (ids.length === 0) {
        queueMicrotask(() => closeWorkspace(ws));
        return prev;
      }
      setActiveTab((a) =>
        a[ws] === tabId ? { ...a, [ws]: ids[ids.length - 1] } : a
      );
      return { ...prev, [ws]: ids };
    });
  }

  function closeWorkspace(ws: string) {
    for (const tabId of tabsByWs[ws] ?? []) killTabSessions(tabId);
    setWorkspaces((prev) => {
      const next = prev.filter((w) => w.name !== ws);
      if (next.length === 0) {
        const name = "agentmux-1";
        const tabId = `${name}-t1`;
        const leaf = termLeaf(tabId);
        setLayouts({ [tabId]: leaf });
        setFocusedPane({ [tabId]: leaf.id });
        setTabsByWs({ [name]: [tabId] });
        setActiveTab({ [name]: tabId });
        setActiveWs(name);
        return [{ name }];
      }
      if (ws === activeWsRef.current) setActiveWs(next[next.length - 1].name);
      return next;
    });
    setTabsByWs((t) => {
      const n = { ...t };
      delete n[ws];
      return n;
    });
  }

  // Unique tmux name for an extra terminal pane within a tab.
  function newPaneTerm(tabId: string): string {
    const used = new Set(
      leaves(layouts[tabId] ?? termLeaf(tabId)).map((l) => l.term).filter(Boolean),
    );
    let k = 2;
    while (used.has(`${tabId}-p${k}`)) k++;
    return `${tabId}-p${k}`;
  }

  function splitActive(dir: Dir) {
    const tabId = activeTab[activeWs];
    const layout = layouts[tabId];
    const focus = focusedPane[tabId];
    if (!layout || !focus) return;
    const add = termLeaf(newPaneTerm(tabId));
    setLayouts((l) => ({ ...l, [tabId]: splitLeaf(layout, focus, dir, add) }));
    setFocusedPane((f) => ({ ...f, [tabId]: add.id }));
  }

  const tabs = tabsByWs[activeWs] ?? [];

  return (
    <div class="relative h-screen w-screen flex bg-[#1c1c1e]">
      <div class="w-full h-full overflow-hidden flex flex-col bg-[#1c1c1e]">
        {/* title bar: window controls over the sidebar, workspace breadcrumb
            + split toolbar over the terminal column. Empty areas drag. */}
        <div class="app-drag h-9 flex items-stretch bg-[#2b2b2d] border-b border-black/40 select-none">
          <div
            class={`app-no-drag flex items-center gap-2.5 px-3 ${
              transparentTitlebar ? "pl-20" : ""
            } ${sidebarOpen ? "w-56 shrink-0 border-r border-black/40" : ""}`}
          >
            <button
              type="button"
              onClick={() => setSidebarOpen((v) => !v)}
              class="text-neutral-400 hover:text-neutral-100 transition"
              title="Toggle sidebar"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="3" y="4" width="18" height="16" rx="2" />
                <line x1="9" y1="4" x2="9" y2="20" />
              </svg>
            </button>
            <button
              type="button"
              onClick={testNotify}
              class="text-neutral-400 hover:text-neutral-100 transition"
              title="Enable / test notifications"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
                <path d="M13.7 21a2 2 0 0 1-3.4 0" />
              </svg>
            </button>
            <button
              type="button"
              onClick={newWorkspace}
              class="text-neutral-400 hover:text-neutral-100 transition"
              title="New workspace"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
            </button>
          </div>

          <div class="flex-1 flex items-center gap-2 px-3 min-w-0">
            <svg class="shrink-0 text-neutral-400" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
              <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
            </svg>
            {activeWs && (editing === activeWs
              ? nameEditor("app-no-drag text-sm font-medium")
              : (
                <span
                  onDblClick={(e) => {
                    e.stopPropagation();
                    startEdit(activeWs, wsLabel(activeWs));
                  }}
                  class="app-no-drag text-sm font-medium text-neutral-200 truncate"
                >
                  {wsLabel(activeWs)}
                </span>
              ))}
            <div class="flex-1" />
            <div class="app-no-drag flex items-center gap-0.5 text-neutral-400">
              <button
                type="button"
                onClick={() => splitActive("row")}
                class="p-1 rounded hover:bg-white/10 hover:text-neutral-100 transition"
                title="Split right"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
                  <rect x="3" y="4" width="18" height="16" rx="2" />
                  <line x1="12" y1="4" x2="12" y2="20" />
                </svg>
              </button>
              <button
                type="button"
                onClick={() => splitActive("col")}
                class="p-1 rounded hover:bg-white/10 hover:text-neutral-100 transition"
                title="Split down"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
                  <rect x="3" y="4" width="18" height="16" rx="2" />
                  <line x1="3" y1="12" x2="21" y2="12" />
                </svg>
              </button>
            </div>
          </div>
        </div>

        {/* tmux missing — terminals can't start without it */}
        {tmuxOk === false && (
          <div class="shrink-0 flex items-center gap-2 px-4 py-2 bg-amber-500/15 border-b border-amber-500/30 text-amber-200 text-xs">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="shrink-0">
              <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
            <span>
              <strong>tmux not found</strong> — terminals won't start. Install it:{" "}
              <code class="bg-black/30 rounded px-1">brew install tmux</code>, then reopen agentmux.
            </span>
          </div>
        )}

        {/* body */}
        <div class="flex-1 flex min-h-0">
          {/* sidebar = workspaces */}
          {sidebarOpen && (
            <div class="w-56 shrink-0 bg-[#1a1a1c] border-r border-black/40 p-2 flex flex-col gap-1 overflow-y-auto">
              {workspaces.map((w) => {
                const isActive = w.name === activeWs;
                const meta = wsMeta(w.name);
                const state = meta?.state ?? "shell";
                const count = (tabsByWs[w.name] ?? []).length;
                return (
                  <button
                    type="button"
                    key={w.name}
                    onClick={() => selectWs(w.name)}
                    class={`text-left rounded-lg px-3 py-2 leading-tight transition flex items-center gap-2.5 ${
                      isActive
                        ? "bg-[#2f6ee6] text-white shadow"
                        : "text-neutral-300 hover:bg-white/5"
                    }`}
                  >
                    <span
                      class={`w-2 h-2 rounded-full shrink-0 ${DOT[state]} ${
                        state === "working" ? "animate-pulse" : ""
                      }`}
                    />
                    <span class="min-w-0 flex-1">
                      <span class="flex items-center gap-1.5">
                        {editing === w.name
                          ? nameEditor("text-sm font-medium w-full")
                          : (
                            <span
                              onDblClick={(e) => {
                                e.stopPropagation();
                                startEdit(w.name, wsLabel(w.name));
                              }}
                              class="text-sm font-medium truncate"
                            >
                              {wsLabel(w.name)}
                            </span>
                          )}
                        {wsHasAttention(w.name) && !isActive && (
                          <span class="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />
                        )}
                      </span>
                      <span
                        class={`block text-xs truncate ${
                          isActive ? "text-blue-100" : "text-neutral-500"
                        }`}
                      >
                        {count > 1 ? `${count} tabs · ` : ""}{wsSub(w.name)}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {/* terminal column */}
          <div class="flex-1 flex flex-col min-w-0 bg-[#1e1f22]">
            {/* tab bar — empty areas draggable, controls opt out */}
            <div class="app-drag h-9 flex items-stretch bg-[#252629] border-b border-black/40">
              <div class="app-no-drag flex items-stretch overflow-x-auto">
                {tabs.map((tabId) => {
                  const isActive = tabId === activeTab[activeWs];
                  const meta = tabMeta(tabId);
                  const state = meta?.state ?? "shell";
                  return (
                    <div
                      key={tabId}
                      onMouseDown={() => selectTab(activeWs, tabId)}
                      class={`group flex items-center gap-2 px-3 border-r border-black/40 text-xs cursor-default ${
                        isActive
                          ? "bg-[#1e1f22] text-neutral-200"
                          : "text-neutral-500 hover:text-neutral-300"
                      }`}
                    >
                      <span
                        class={`w-1.5 h-1.5 rounded-full shrink-0 ${DOT[state]} ${
                          state === "working" ? "animate-pulse" : ""
                        }`}
                      />
                      {editing === tabId
                        ? nameEditor("max-w-32 text-xs")
                        : (
                          <span
                            onDblClick={(e) => {
                              e.stopPropagation();
                              startEdit(tabId, tabLabel(tabId));
                            }}
                            class="max-w-32 truncate"
                          >
                            {tabLabel(tabId)}
                          </span>
                        )}
                      {attention[tabId] && !isActive && (
                        <span class="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />
                      )}
                      <button
                        type="button"
                        onMouseDown={(e) => {
                          e.stopPropagation();
                          closeTab(activeWs, tabId);
                        }}
                        class="text-neutral-600 hover:text-neutral-100 opacity-0 group-hover:opacity-100 transition"
                        title="Close tab"
                      >
                        ✕
                      </button>
                    </div>
                  );
                })}
                {/* new tab */}
                <button
                  type="button"
                  onClick={() => newTab(activeWs)}
                  class="px-2.5 text-neutral-500 hover:text-neutral-100 hover:bg-white/5 transition"
                  title="New tab"
                >
                  +
                </button>
              </div>

              <div class="flex-1" />
            </div>

            {/* every tab's layout mounted (background detection), active visible */}
            <div class="flex-1 relative min-h-0">
              {workspaces.flatMap((w) =>
                (tabsByWs[w.name] ?? []).map((tabId) => {
                  const layout = layouts[tabId];
                  if (!layout) return null;
                  const visible = w.name === activeWs && tabId === activeTab[w.name];
                  return (
                    <div
                      key={tabId}
                      class={`absolute inset-0 ${
                        visible ? "z-10 opacity-100" : "z-0 opacity-0 pointer-events-none"
                      }`}
                    >
                      <Workspace
                        node={layout}
                        visible={visible}
                        showFocus={false}
                        focusedId={focusedPane[tabId] ?? ""}
                        onFocus={(id) =>
                          setFocusedPane((f) => ({ ...f, [tabId]: id }))}
                        onResize={(splitId, ratio) =>
                          setLayouts((l) => ({
                            ...l,
                            [tabId]: setRatio(l[tabId], splitId, ratio),
                          }))}
                        onMeta={updateMeta}
                      />
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </div>

      {/* in-app toast (fallback when OS notifications are denied) */}
      {toast && (
        <div class="absolute bottom-4 right-4 z-50 w-72 rounded-xl bg-[#2b2b2d] border border-white/10 shadow-2xl px-4 py-3">
          <div class="text-sm font-semibold text-neutral-100">{toast.title}</div>
          {toast.body && (
            <div class="text-xs text-neutral-400 mt-0.5 line-clamp-3">{toast.body}</div>
          )}
        </div>
      )}
    </div>
  );
}
