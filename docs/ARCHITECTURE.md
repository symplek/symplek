# Weft Architecture — Record/Replay Loop

## Overview

Weft's record/replay engine is the foundation for deterministic agent testing. It decouples **execution** from **observation**: record a run once, replay it infinitely at zero cost.

```mermaid
flowchart TB
    subgraph RECORD["🎬 RECORD: .rehearse()"]
        direction TB
        A[AgentUnit&lt;T&gt;] -->|".rehearse(opts)"| B[TraceRecorder]
        B -->|"wrap + instrument"| C[Instrumented Agent]
        C -->|"execute"| D[Agent Body]
        D -->|"returns T"| C
        C -->|"capture events"| B
        B -->|"appendEvent()"| E[Event Stream]
        B -->|"createCheckpoint()"| F[Checkpoints]
        B -->|"finalize(T)"| G[("ExecutionTrace&lt;T&gt;<br/>━━━━━━━━━━<br/>• events[]<br/>• checkpoints[]<br/>• finalOutput<br/>• metadata<br/>• vector clocks<br/>• integrity hashes")]
    end

    subgraph STORE["💾 STORE"]
        direction LR
        G --> H[("Filesystem<br/>JSON trace")]
        G --> I[("Database<br/>via Storage adapter")]
    end

    subgraph REPLAY["▶ REPLAY: .replay(trace)"]
        direction TB
        J[("ExecutionTrace&lt;T&gt;")] -->|"load"| K[TraceReplayer]
        K -->|"verify hash integrity"| L{Hash Check}
        L -->|"ok"| M[DependencyScheduler]
        L -->|"fail"| X[ReplayDivergenceError]
        M -->|"next event"| N[ReplayLLMInterceptor]
        N -->|"cached response"| O[Event Processor]
        O -->|"assert deterministic"| P[Divergence Detector]
        P -->|"pass"| Q[ReplayResult&lt;T&gt;]
        P -->|"divergence"| R[Divergence[]]
    end

    G -.->|"serialize"| J

    subgraph KEY["🔑 KEY INSIGHT"]
        direction LR
        S["Agent body NEVER executes during replay"]
    end

    RECORD --> KEY
    KEY --> REPLAY

    style RECORD fill:#1a1a2e,stroke:#16213e,color:#e0e0e0
    style REPLAY fill:#1a1a2e,stroke:#16213e,color:#e0e0e0
    style STORE fill:#0f3460,stroke:#16213e,color:#e0e0e0
    style KEY fill:#16213e,stroke:#e94560,color:#e94560
    style S fill:#16213e,stroke:#e94560,color:#e94560,stroke-width:3px
    style G fill:#0f3460,stroke:#533483,color:#e0e0e0
    style J fill:#0f3460,stroke:#533483,color:#e0e0e0
    style X fill:#e94560,stroke:#e94560,color:#fff
    style R fill:#e94560,stroke:#e94560,color:#fff
```

## How It Works

### Phase 1: Record (`.rehearse()`)

1. **AgentUnit wrapper** — `.rehearse(opts)` wraps the agent body in an instrumented execution path
2. **TraceRecorder** — every decision point, API call, and output is captured as a `TraceEvent`
3. **Vector clocks** — each event carries a Lamport-style vector clock for causal ordering across multi-agent compositions
4. **Integrity hashes** — every event is DJB2-hashed at record time for tamper detection on replay
5. **Checkpoints** — periodic state snapshots enable partial replay from any point
6. **Finalize** — the trace is frozen with `Object.freeze()` and includes metadata, the final output, and the complete event stream

### Phase 2: Replay (`.replay(trace)`)

1. **TraceReplayer** — loads the `ExecutionTrace<T>` and validates schema version
2. **Hash verification** — re-computes every event hash; divergences throw `ReplayDivergenceError`
3. **DependencyScheduler** — respects causal ordering from vector clocks
4. **ReplayLLMInterceptor** — all LLM calls are served from cached responses; **the model is never called**
5. **Divergence detection** — output hashes are compared; any mismatch is logged as a `Divergence`
6. **Result** — `ReplayResult<T>` contains the original output, match status, event counts, and any divergences

### The Key Win

The agent body is **never called** during replay. The `TraceReplayer` replays from the stored event stream, using the `ReplayLLMInterceptor` to serve cached LLM responses. This means:

- **Zero API costs** during replay
- **Deterministic output** — same trace always produces the same result
- **No flakiness** — network failures, timeouts, and non-deterministic behavior are frozen in the trace
- **Fast** — replay is purely CPU-bound; no network I/O

## Component Map

| Component | File | Role |
|---|---|---|
| `TraceRecorder` | `rehearsal/recorder.ts` | Captures events, checkpoints, finalizes traces |
| `TraceReplayer` | `rehearsal/replayer.ts` | Replays traces with hash verification and divergence detection |
| `VectorClockManager` | `rehearsal/vectorClock.ts` | Causal ordering across multi-agent traces |
| `DependencyScheduler` | `rehearsal/scheduler.ts` | Topological sort respecting vector clock ordering |
| `ReplayLLMInterceptor` | `rehearsal/interceptor.ts` | Serves cached LLM responses during replay |
| `CheckpointManager` | `rehearsal/checkpoint.ts` | State snapshots for partial replay |
| `TraceStorage` | `rehearsal/storage.ts` | Persistence adapter (filesystem, DB, etc.) |
| `ExecutionTrace<T>` | `rehearsal/types.ts` | The serialized trace data structure |

## Replay vs. The Competition

| Framework | Replay Type | Re-executes LLM? | Deterministic? | Costs Tokens? |
|---|---|---|---|---|
| **Weft** | Recorded trace replay | **No** | **Yes** | **No** |
| LangGraph | Time-travel from checkpoints | Yes | No | Yes |
| Mastra | No replay primitive | N/A | N/A | N/A |
| Vercel AI SDK | No replay primitive | N/A | N/A | N/A |

Weft is the only framework where replay is a first-class primitive that never calls the model.
