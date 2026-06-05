// Shared tmux config for the server routes. We use a dedicated socket so our
// sessions never collide with the user's default tmux server, yet stay
// inspectable from any terminal: `tmux -L agentmux ls`.

export const SOCKET = "agentmux";

// Homebrew (Apple Silicon / Intel) isn't on the desktop runtime's PATH, so
// resolve an absolute tmux and prepend its dir to the spawned env's PATH.
const TMUX_CANDIDATES = [
  "/opt/homebrew/bin/tmux",
  "/usr/local/bin/tmux",
  "/usr/bin/tmux",
];

let cachedBin: string | null = null;

export function tmuxBin(): string {
  if (cachedBin) return cachedBin;
  for (const p of TMUX_CANDIDATES) {
    try {
      Deno.statSync(p);
      cachedBin = p;
      return p;
    } catch { /* not here */ }
  }
  cachedBin = "tmux"; // last resort: hope it's on PATH
  return cachedBin;
}

// Returns tmux's version string (e.g. "tmux 3.6b") or null if not installed.
export async function tmuxVersion(): Promise<string | null> {
  try {
    const out = await new Deno.Command(tmuxBin(), {
      args: ["-V"],
      env: tmuxEnv().env,
      stderr: "null",
    }).output();
    if (!out.success) return null;
    return new TextDecoder().decode(out.stdout).trim() || null;
  } catch {
    return null;
  }
}

export function tmuxEnv(): { home: string; env: Record<string, string> } {
  const home = Deno.env.get("HOME") || ".";
  const path = `/opt/homebrew/bin:/usr/local/bin:${Deno.env.get("PATH") || ""}`;
  return {
    home,
    env: {
      TERM: "xterm-256color",
      COLORTERM: "truecolor",
      LANG: Deno.env.get("LANG") || "en_US.UTF-8",
      HOME: home,
      PATH: path,
      USER: Deno.env.get("USER") || "",
      SHELL: Deno.env.get("SHELL") || "/bin/zsh",
    },
  };
}
