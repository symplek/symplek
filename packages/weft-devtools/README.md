# weft-devtools

Chrome DevTools panel for inspecting Weft agent traces, spans, and operator chains in your running app. Drop the extension in, open DevTools, and you can see every `AgentUnit` execution, its operator chain, the spans it produced, the values it threaded through, and any errors it caught.

**Pre-1.0. The panel surface will change.**

---

## What it does

Standard browser DevTools don't understand agents. They show you network calls and console logs, but not which `AgentUnit` made the call, which operator was active when an error fired, or how a `.consensus()` voted.

`weft-devtools` exposes that view.

- **Agent timeline.** Every `AgentUnit.run()` since the page loaded, in execution order.
- **Operator chain.** For each run: what got chained (`of`, `retry`, `fallback`, `consensus`, etc.) and where time went.
- **Span tree.** Nested operator spans with durations.
- **Errors.** Operator-level rejections with the operator chain that led to them.
- **Trace export.** Save a `.rehearsal` trace JSON for offline replay via `weft-harness/replay`.

---

## Install

This package is a **Chrome extension build**, not a runtime library. You build it locally and side-load:

```bash
git clone https://github.com/wefthq/weft.git
cd weft/packages/weft-devtools
pnpm install
pnpm build
```

Then in Chrome:

1. `chrome://extensions`
2. Toggle **Developer mode**.
3. **Load unpacked** → select `packages/weft-devtools/dist`.
4. Open DevTools on any page running `weft-core` with observability enabled.

A **Weft** tab appears alongside Elements, Console, etc.

---

## Enabling traces in your app

The panel only shows traces your app emits. Turn observability on:

```typescript
import { configureObservability } from "weft-core";

configureObservability({ enabled: true });
```

For production you'd typically gate this behind a flag.

---

## Pre-1.0 status

- Manifest V3 service worker. Should work in any current Chromium-based browser.
- Not yet on the Chrome Web Store. Side-load only.
- The trace shape is shared with `weft-core`; breaking changes there cascade here.

---

## License

MIT
