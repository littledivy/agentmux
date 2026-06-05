
<img width="1657" height="1039" alt="image" src="https://github.com/user-attachments/assets/db0f3bf9-7cc6-403b-9b7b-a49358cd6ec9" />


A tmux-backed terminal, runs as a desktop app. A sidebar of workspaces, tabbed and splittable
terminal panes, with live Claude / Codex status and notifications.

Built natively via `deno desktop`. Inspired by cmux.com

[![Download for macOS](https://img.shields.io/badge/Download_for_macOS-000000?style=for-the-badge&logo=apple&logoColor=white)](https://github.com/littledivy/agentmux/releases/latest/download/agentmux.dmg)

Requires
[tmux](https://github.com/tmux/tmux) (`brew install tmux`).

## Features

- **Workspaces → tabs → split panes** — drag the dividers to resize.
- **tmux-backed sessions** on a dedicated socket (`tmux -L agentmux`): they
  persist across restarts and are attachable from any terminal
  (`tmux -L agentmux attach -t <name>`).
- **Agent-aware** — detects Claude / Codex, shows working / idle / needs-input
  state, and names tabs by the agent or the current directory.
- **Notifications** when a background agent finishes a turn
  or needs input.

## Building from source

- [Deno](https://deno.com) 2.x

Requires the `deno desktop` subcommand.

```sh
deno desktop -A --hmr .
```

## License

MIT — see [LICENSE](LICENSE).
