---
"@symplek/mcp": minor
---

- The published `@symplek/mcp` binary starts. It previously resolved to a bundle whose startup guard never fired, and a duplicated shebang line made the built file a syntax error.
- The server sends no reply to the `notifications/initialized` notification, as the protocol requires. It used to answer with an `id: null` frame.
- `symplek_consensus` and `symplek_debate` run on fixed stub agents, and now say so in their descriptions and in every result: each result carries `simulated: true` and a `notice`. A stub approval can no longer be read as a decision.
- A client using the default trust policies can complete a call. `requireTwoSources` is no longer in the default set, because nothing in the package can supply a second source yet; add it yourself when you have one.
- Every policy verdict is enforced. A `degrade` verdict used to permit the call it was meant to restrict.
- The stdio client performs the MCP `initialize` handshake, bounds the output it buffers from the child process, honours the abort signal, handles a failed spawn without crashing the host, and starts one child per server when first calls race.
- The `sse` transport now fails with a clear error pointing at `@modelcontextprotocol/sdk`. It never spoke MCP JSON-RPC, so it could not work against a compliant server.
- The README's setup blocks point at the file the package ships, `dist/bin.cjs`.
