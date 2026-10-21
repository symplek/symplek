---
"@symplek/mcp": minor
---

- The published `@symplek/mcp` binary starts. It previously resolved to a bundle whose startup guard never fired.
- Every policy verdict is enforced. A `degrade` verdict used to permit the call it was meant to restrict.
- The stdio client performs the MCP `initialize` handshake, bounds the output it buffers from the child process, honours the abort signal, handles a failed spawn without crashing the host, and starts one child per server when first calls race.
- The `sse` transport now fails with a clear error pointing at `@modelcontextprotocol/sdk`. It never spoke MCP JSON-RPC, so it could not work against a compliant server.
- `symplek_debate` is described as a fixture in its tool description: its role agents are deterministic stubs and the synthesis equals the prompt.
