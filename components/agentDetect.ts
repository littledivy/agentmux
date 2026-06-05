// Heuristics for reading coding-agent state out of a terminal screen.
// Ported from orchid's tmux-pane scraping (internal/orch/orch.go): same
// marker strings, adapted to read xterm.js's already-parsed screen text
// instead of `tmux capture-pane`.

export type AgentKind = "claude" | "codex" | "shell";
export type AgentState = "working" | "waiting" | "idle" | "shell";

export interface AgentMeta {
  agent: AgentKind;
  state: AgentState;
  /** One-line summary of what the agent is currently doing (best effort). */
  action: string;
}

// Both Claude Code and Codex print this footer while reasoning/acting.
const BUSY_MARKER = "esc to interrupt";
// Claude's permission footer — shown when sitting idle at the prompt.
const CLAUDE_MARKER = "bypass permissions";
// Codex shows its model id (e.g. "gpt-5-codex") in the composer.
const CODEX_MARKER = "gpt-";
// Markers that mean the agent is blocking on a human answer.
const PROMPT_MARKERS = [
  "do you want to proceed",
  "❯ 1.",
  "│ 1.",
  "approve this",
  "allow this",
  "(y/n)",
  "press enter to continue",
];

export function detectAgent(screen: string): AgentMeta {
  const low = screen.toLowerCase();

  let agent: AgentKind = "shell";
  if (low.includes(CODEX_MARKER)) agent = "codex";
  if (low.includes(CLAUDE_MARKER) || low.includes("⏵⏵")) agent = "claude";

  if (agent === "shell") {
    return { agent, state: "shell", action: "" };
  }

  const busy = low.includes(BUSY_MARKER);
  const prompted = !busy && PROMPT_MARKERS.some((m) => low.includes(m));

  let state: AgentState;
  if (busy) state = "working";
  else if (prompted) state = "waiting";
  else state = "idle";

  return { agent, state, action: extractAction(screen) };
}

// Picks the most recent meaningful line from the screen: the agent's current
// step ("• Exploring", "⏺ Edited x", "Working (12s…)"), skipping UI chrome —
// the input box, separator rules, and the permissions footer.
export function extractAction(screen: string): string {
  const lines = screen.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const s = lines[i].trim();
    if (s === "") continue;
    const low = s.toLowerCase();
    if (
      low.includes("bypass permissions") ||
      low.includes("shift+tab") ||
      low.includes("? for shortcuts") ||
      low.includes("esc to interrupt") ||
      low.includes("/clear to") ||
      low.startsWith("gpt-")
    ) continue;
    if (isSeparatorRule(s)) continue;

    // Strip a leading marker glyph to judge emptiness.
    const t = s.replace(/^[•◦●·⏺⎿└│✻✶✳✦➤>›❯⏵\s]+/u, "").trim();
    if (t === "") continue;
    // Bare input-box placeholders (just a › / ❯ caret + short hint) are chrome.
    if ((s.startsWith("›") || s.startsWith("❯")) && t.length < 4) continue;

    return t.length > 120 ? t.slice(0, 120) + "…" : t;
  }
  return "";
}

function isSeparatorRule(s: string): boolean {
  // Essentially all box-drawing / dashes / underscores.
  return /^[\s─━–—_=·.─-╿]+$/u.test(s) && s.length >= 3;
}
