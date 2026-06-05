// Client-side shims that forward to /api/notify, which fires the *native*
// notification / dock APIs from the Deno desktop runtime. We deliberately do
// NOT touch the page's own `Notification` — in the CEF webview that's
// Chromium's Web Notifications (shows a Chrome permission prompt, not the
// native macOS one).

async function post(body: Record<string, unknown>): Promise<Response | null> {
  try {
    return await fetch("/api/notify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    return null;
  }
}

// Prompt the OS once (native dialog) and return the resolved permission.
export async function ensureNotifyPermission(): Promise<string> {
  const r = await post({ action: "request" });
  if (!r) return "denied";
  try {
    return (await r.json()).permission ?? "denied";
  } catch {
    return "denied";
  }
}

// Fire a native notification + dock bounce. Returns true if the OS actually
// showed the toast (so callers can fall back to an in-app one when it didn't).
export async function notify(title: string, body: string): Promise<boolean> {
  const r = await post({ action: "notify", title, body, bounce: true });
  if (!r) return false;
  try {
    return (await r.json()).shown === true;
  } catch {
    return false;
  }
}

// Dock/taskbar badge — pass "" to clear.
export function setBadge(text: string): void {
  post({ action: "badge", badge: text });
}

// Last path segment of an OSC title like "user@host: ~/code/proj" → "proj".
export function cwdName(osc: string): string {
  if (!osc) return "";
  const tail = osc.includes(":") ? osc.slice(osc.lastIndexOf(":") + 1) : osc;
  const p = tail.trim().replace(/\/+$/, "");
  const seg = p.split("/").filter(Boolean).pop();
  return seg || "";
}
