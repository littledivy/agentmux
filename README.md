# agentmux

A terminal-sessions dashboard for coding agents — tmux-backed, runs as a
native macOS desktop app. A sidebar of workspaces, tabbed and splittable
terminal panes, with live Claude / Codex status and notifications.

Built with [Fresh](https://fresh.deno.dev) (Deno + Preact) and
[xterm.js](https://xtermjs.org), rendered natively via `deno desktop`
([WEF](https://github.com/littledivy/just-wef)).

## Features

- **Workspaces → tabs → split panes** — drag the dividers to resize.
- **tmux-backed sessions** on a dedicated socket (`tmux -L agentmux`): they
  persist across restarts and are attachable from any terminal
  (`tmux -L agentmux attach -t <name>`).
- **Agent-aware** — detects Claude / Codex, shows working / idle / needs-input
  state, and names tabs by the agent or the current directory.
- **Native notifications + dock badge** when a background agent finishes a turn
  or needs input.
- Rename anything (double-click), auto-reconnecting terminals, clean macOS
  chrome with a unified title bar.

## Requirements

- [Deno](https://deno.com) 2.x
- [tmux](https://github.com/tmux/tmux) — `brew install tmux`

## Develop (in the browser)

```sh
deno task dev
```

Then open http://localhost:5173.

## Desktop app

Requires the `deno desktop` subcommand (the WEF backend).

```sh
deno task build
deno desktop -A --hmr .
```

The unified transparent title bar uses a custom WEF window flag — see
[just-wef](https://github.com/littledivy/just-wef).

## License

MIT — see [LICENSE](LICENSE).
