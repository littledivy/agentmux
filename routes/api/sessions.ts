import { define } from "../../utils.ts";
import { SOCKET, tmuxBin, tmuxEnv } from "../../components/tmux.ts";

// Lists / removes tmux sessions on our socket. Returns each session's current
// directory (home shown as ~) so the dashboard can name tabs/workspaces from
// the cwd — reliable, unlike scraping the terminal title.

function tildify(path: string, home: string): string {
  if (!path) return "";
  if (path === home) return "~";
  if (home && path.startsWith(home + "/")) return "~" + path.slice(home.length);
  return path;
}

async function listSessions(): Promise<{
  names: string[];
  paths: Record<string, string>;
}> {
  const { home, env } = tmuxEnv();
  try {
    const out = await new Deno.Command(tmuxBin(), {
      args: [
        "-L",
        SOCKET,
        "list-sessions",
        "-F",
        "#{session_name}\t#{pane_current_path}",
      ],
      env,
      stderr: "null",
    }).output();
    if (!out.success) return { names: [], paths: {} };
    const names: string[] = [];
    const paths: Record<string, string> = {};
    for (const line of new TextDecoder().decode(out.stdout).split("\n")) {
      if (!line.trim()) continue;
      const [name, path = ""] = line.split("\t");
      names.push(name);
      paths[name] = tildify(path, home);
    }
    return { names, paths };
  } catch {
    return { names: [], paths: {} };
  }
}

export const handler = define.handlers({
  async GET() {
    const { names, paths } = await listSessions();
    return Response.json({ sessions: names, paths });
  },

  async DELETE(ctx) {
    const name = new URL(ctx.req.url).searchParams.get("name") ?? "";
    if (!/^[A-Za-z0-9_-]{1,40}$/.test(name)) {
      return new Response("bad session name", { status: 400 });
    }
    const { env } = tmuxEnv();
    await new Deno.Command(tmuxBin(), {
      args: ["-L", SOCKET, "kill-session", "-t", name],
      env,
      stderr: "null",
    }).output().catch(() => {});
    return Response.json({ ok: true });
  },
});
