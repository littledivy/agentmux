import { define } from "../../utils.ts";

// Native notifications + dock live in the Deno *desktop runtime* context
// (where `globalThis.Notification` and `Deno.dock` are installed by the WEF
// backend), NOT in the CEF page. So the browser island POSTs here and we fire
// them server-side. In a plain browser/`deno serve` run these globals are
// absent and every branch degrades to a no-op.

// deno-lint-ignore no-explicit-any
const g = globalThis as any;

async function resolvePermission(): Promise<string> {
  const N = g.Notification;
  if (!N) return "unsupported";
  if (N.permission === "granted" || N.permission === "denied") {
    return N.permission;
  }
  try {
    return await N.requestPermission(); // native macOS UN dialog
  } catch {
    return "denied";
  }
}

export const handler = define.handlers({
  async POST(ctx) {
    // deno-lint-ignore no-explicit-any
    let body: any = {};
    try {
      body = await ctx.req.json();
    } catch { /* empty/invalid body */ }

    const dock = g.Deno?.dock;

    switch (body.action) {
      case "request":
        return Response.json({ permission: await resolvePermission() });

      case "badge": {
        try {
          // Empty string clears; never pass null (the native side renders it
          // as the literal text "null").
          dock?.setBadge?.(String(body.badge ?? ""));
        } catch { /* ignore */ }
        return Response.json({ ok: true });
      }

      case "notify": {
        const permission = g.Notification?.permission ?? "unsupported";
        let shown = false;
        try {
          if (g.Notification && permission === "granted") {
            new g.Notification(String(body.title ?? "agentmux"), {
              body: String(body.body ?? ""),
              tag: body.tag ? String(body.tag) : undefined,
            });
            shown = true;
          }
        } catch { /* ignore */ }
        // Dock bounce needs no permission — always a usable native signal.
        try {
          if (body.bounce) dock?.bounce?.("informational");
        } catch { /* ignore */ }
        return Response.json({ permission, shown });
      }

      default:
        return Response.json({ error: "unknown action" }, { status: 400 });
    }
  },
});
