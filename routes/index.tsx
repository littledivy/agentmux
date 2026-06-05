import { Head } from "fresh/runtime";
import { define } from "../utils.ts";
import Dashboard from "../islands/Dashboard.tsx";

export default define.page(function Home() {
  // The desktop runtime sets DENO_DESKTOP_TITLEBAR=hidden when the native
  // window uses a transparent/full-size title bar — then the page draws into
  // that strip and must inset its toolbar to clear the traffic-light buttons.
  let transparentTitlebar = false;
  try {
    // deno-lint-ignore no-explicit-any
    transparentTitlebar =
      (globalThis as any).Deno?.env?.get?.("DENO_DESKTOP_TITLEBAR") === "hidden";
  } catch { /* not in Deno / no env perm */ }

  return (
    <>
      <Head>
        <title>agentmux</title>
      </Head>
      <Dashboard transparentTitlebar={transparentTitlebar} />
    </>
  );
});
