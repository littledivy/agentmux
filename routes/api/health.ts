import { define } from "../../utils.ts";
import { tmuxVersion } from "../../components/tmux.ts";

// Environment checks the dashboard needs to warn about missing dependencies.
export const handler = define.handlers({
  async GET() {
    return Response.json({ tmux: await tmuxVersion() });
  },
});
