import { useEffect, useRef } from "preact/hooks";
// xterm 5.x ships UMD (module.exports = { Terminal }); grab via default interop.
import XtermMod from "@xterm/xterm";
import FitMod from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { type AgentMeta, detectAgent } from "./agentDetect.ts";

// deno-lint-ignore no-explicit-any
const XTerm = (XtermMod as any).Terminal;
// deno-lint-ignore no-explicit-any
const FitAddon = (FitMod as any).FitAddon;

export interface SessionMeta extends AgentMeta {
  /** Title set by the program via OSC 0/2 (usually "user@host: cwd"). */
  oscTitle: string;
}

interface Props {
  /** tmux session name — stable key; reconnects re-attach the same session. */
  name: string;
  /** Whether this terminal's workspace is visible (drives fit + repaint). */
  visible: boolean;
  /** Whether this is the focused pane (drives keyboard focus). */
  focused: boolean;
  /** Reports live agent state / title back to the dashboard. */
  onMeta?: (m: SessionMeta) => void;
}

// Reads xterm's parsed on-screen text (visible region, like `tmux capture-pane`).
// deno-lint-ignore no-explicit-any
function readScreen(term: any): string {
  const buf = term.buffer.active;
  let out = "";
  for (let y = buf.baseY; y < buf.baseY + term.rows; y++) {
    const line = buf.getLine(y);
    if (line) out += line.translateToString(true) + "\n";
  }
  return out;
}

// A single live terminal: xterm.js wired to a tmux session over a WebSocket.
// Auto-reconnects (re-attaches the tmux session) if the socket drops.
export default function Terminal({ name, visible, focused, onMeta }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<XTerm | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const onMetaRef = useRef(onMeta);
  onMetaRef.current = onMeta;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const term = new XTerm({
      fontFamily: '"SF Mono", Menlo, Monaco, "Cascadia Code", monospace',
      fontSize: 13,
      cursorBlink: true,
      allowProposedApi: true,
      theme: {
        background: "#1e1f22",
        foreground: "#e5e5e5",
        cursor: "#e5e5e5",
        selectionBackground: "#ffffff26",
      },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host);
    fit.fit();
    termRef.current = term;
    fitRef.current = fit;

    let disposed = false;
    let retry: number | undefined;

    const sendSize = () => {
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ t: "size", cols: term.cols, rows: term.rows }));
      }
    };

    const connect = () => {
      if (disposed) return;
      const proto = location.protocol === "https:" ? "wss" : "ws";
      const ws = new WebSocket(
        `${proto}://${location.host}/api/pty?name=${encodeURIComponent(name)}`,
      );
      wsRef.current = ws;
      ws.onopen = () => sendSize();
      ws.onmessage = (ev) => term.write(ev.data);
      ws.onclose = () => {
        if (disposed) return;
        // tmux session is still alive server-side — re-attach shortly.
        retry = setTimeout(connect, 800);
      };
    };
    connect();

    term.onData((d: string) => {
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ t: "in", d }));
      }
    });
    term.onResize(() => sendSize());

    // OSC title (shell/agent set it on each prompt — gives us cwd + name).
    let oscTitle = "";
    term.onTitleChange((t: string) => {
      oscTitle = t;
    });

    // Sample the screen for agent state on a slow tick.
    const poll = setInterval(() => {
      const cb = onMetaRef.current;
      if (!cb) return;
      try {
        const { agent, state, action } = detectAgent(readScreen(term));
        cb({ agent, state, action, oscTitle });
      } catch { /* ignore transient buffer reads */ }
    }, 1200);

    const ro = new ResizeObserver(() => {
      try {
        fit.fit();
      } catch { /* host hidden */ }
    });
    ro.observe(host);

    return () => {
      disposed = true;
      clearTimeout(retry);
      clearInterval(poll);
      ro.disconnect();
      wsRef.current?.close();
      term.dispose();
    };
  }, [name]);

  // Re-fit + repaint when the workspace becomes visible (its size may have
  // been unmeasurable while hidden / behind the opacity-0 layer).
  useEffect(() => {
    if (!visible) return;
    const id = requestAnimationFrame(() => {
      try {
        fitRef.current?.fit();
      } catch { /* ignore */ }
      const term = termRef.current;
      if (term) term.refresh(0, term.rows - 1);
    });
    return () => cancelAnimationFrame(id);
  }, [visible]);

  // Grab keyboard focus when this becomes the focused pane.
  useEffect(() => {
    if (visible && focused) {
      const id = requestAnimationFrame(() => termRef.current?.focus());
      return () => cancelAnimationFrame(id);
    }
  }, [visible, focused]);

  return <div ref={hostRef} class="w-full h-full" />;
}
