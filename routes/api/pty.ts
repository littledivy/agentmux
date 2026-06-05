import { define } from "../../utils.ts";
import { Pty } from "@sigma/pty-ffi";
import { SOCKET, tmuxBin, tmuxEnv } from "../../components/tmux.ts";

// Each WebSocket attaches a PTY to a tmux session on a dedicated socket
// (`tmux -L agentmux`). `new-session -A` attaches if the session exists, else
// creates it — so a dropped/reconnected socket re-attaches the SAME live
// session (scrollback + running processes intact, server-side in tmux).
// Closing the PTY detaches the client; the tmux session keeps running and is
// attachable from any terminal: `tmux -L agentmux attach -t <name>`.
//
// Client protocol (JSON): {t:"in", d} keystrokes, {t:"size", cols, rows}
// resize, {t:"kill"} kill the tmux session.
export const handler = define.handlers({
  GET(ctx) {
    const upgrade = ctx.req.headers.get("upgrade") ?? "";
    if (upgrade.toLowerCase() !== "websocket") {
      return new Response("expected websocket", { status: 426 });
    }

    const url = new URL(ctx.req.url);
    const name = url.searchParams.get("name") ?? "";
    if (!/^[A-Za-z0-9_-]{1,40}$/.test(name)) {
      return new Response("bad session name", { status: 400 });
    }

    const { socket, response } = Deno.upgradeWebSocket(ctx.req);
    const { home, env } = tmuxEnv();
    const tmux = tmuxBin();

    let pty: Pty | null = null;
    let reader: ReadableStreamDefaultReader<string> | null = null;
    let closed = false;

    const cleanup = () => {
      if (closed) return;
      closed = true;
      try {
        reader?.cancel();
      } catch { /* ignore */ }
      try {
        pty?.close(); // detach the tmux client; session survives
      } catch { /* ignore */ }
      pty = null;
    };

    socket.onopen = () => {
      try {
        pty = new Pty(tmux, {
          // -A: attach-or-create. -c: start dir for a freshly created session.
          args: ["-L", SOCKET, "new-session", "-A", "-s", name, "-c", home],
          cwd: home,
          env,
        });
        pty.setPollingInterval(10);

        reader = pty.readable.getReader();
        (async () => {
          try {
            while (!closed) {
              const { value, done } = await reader!.read();
              if (done) break;
              if (value && socket.readyState === WebSocket.OPEN) {
                socket.send(value);
              }
            }
          } catch { /* stream torn down */ } finally {
            if (socket.readyState === WebSocket.OPEN) socket.close();
            cleanup();
          }
        })();
      } catch (e) {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(`\r\n\x1b[31mfailed to start tmux: ${e}\x1b[0m\r\n`);
          socket.close();
        }
      }
    };

    socket.onmessage = async (ev) => {
      if (closed) return;
      try {
        const msg = JSON.parse(ev.data);
        if (msg.t === "in" && pty) {
          pty.write(msg.d);
        } else if (msg.t === "size" && pty) {
          pty.resize({ rows: msg.rows, cols: msg.cols });
        } else if (msg.t === "kill") {
          await new Deno.Command(tmux, {
            args: ["-L", SOCKET, "kill-session", "-t", name],
            env,
          }).output().catch(() => {});
        }
      } catch { /* ignore malformed frame */ }
    };

    socket.onclose = cleanup;
    socket.onerror = cleanup;

    return response;
  },
});
