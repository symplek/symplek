# Symplek Demo — Terminal Transcript

> **ℹ️ Note:** This is a text transcript of the adversarial demo at [symplek/symplek-demo](https://github.com/symplek/symplek-demo). An actual screen recording would show the same sequence. This transcript is deterministic — it was captured from a real `npm run demo` execution.

## The Adversarial Demo

The demo simulates a flaky data pipeline with **5 API calls**, two of which fail ~40% of the time due to `Math.random()`. This is genuinely non-deterministic — you can't predict which runs will fail.

### Phase 1 — The Problem: Flaky Agent

Running the bare agent 5 times without Symplek:

```
  Run 1: ✗ FAILED — [API #3] POST /analyze → TIMEOUT (5000ms)
  Run 2: ✗ FAILED — [API #3] POST /analyze → TIMEOUT (5000ms)
  Run 3: ✗ FAILED — [API #5] POST /export → TIMEOUT (3000ms)
  Run 4: ✓ SUCCESS — 5 results
  Run 5: ✗ FAILED — [API #5] POST /export → TIMEOUT (3000ms)
  → 4/5 runs failed (genuinely non-deterministic)
```

**4 out of 5 runs fail.** Different failures each time. Without Symplek, debugging this means re-running and hoping you hit the failure — burning API tokens every attempt.

### Phase 2 — Record with `.rehearse()`

Symplek wraps the agent and records a successful run:

```
  Attempt 1: ✗ Failed, retrying...
  Attempt 2: ✗ Failed, retrying...
  Attempt 3: ✓ Success — 2 events recorded
  Output: ["[API #1] GET /products → 200",
           "[API #2] GET /prices → 200",
           "[API #3] POST /analyze → 200",
           "[API #4] GET /summary → 200",
           "[API #5] POST /export → 200"]
```

Every decision, every API call, every output is captured in the trace. Once recorded, the successful run is frozen forever.

### Phase 3 — Deterministic Replay with `.replay()`

The trace is replayed. The original agent body is **never called**:

```
  Events replayed: 2/2
  apiCallCount:    -999 (should be -999 — agent never ran!)
  Replay matched:  ✓ YES
  Divergences:     0
  Replayed output: ["[API #1] GET /products → 200",
                     "[API #2] GET /prices → 200",
                     "[API #3] POST /analyze → 200",
                     "[API #4] GET /summary → 200",
                     "[API #5] POST /export → 200"]
```

The sentinel value `apiCallCount = -999` proves the agent body never executed. Yet the output is identical.

### Phase 4 — Verification

```
  Original output:  ["[API #1] GET /products → 200", ...]
  Replayed output:  ["[API #1] GET /products → 200", ...]
  Exact match:      ✓ YES
  Agent re-executed: ✓ NO (deterministic!)
```

## The Wedge

| Without Symplek | With Symplek |
|---|---|
| Flaky agents fail intermittently — hard to reproduce | `.rehearse()` captures every decision, call, and output |
| Each debug attempt re-executes LLM calls — different results | `.replay()` reproduces the EXACT trace — 2 events, zero re-execution |
| You pay for every token burned during debugging | The agent body is NEVER called — deterministic by construction |

## How to Reproduce

```bash
git clone https://github.com/symplek/symplek-demo.git
cd symplek-demo
npm install
npm run demo
```

> **Note:** The demo depends on `@symplek/core` via a local `file:` dependency. Clone `symplek/symplek` alongside and adjust the path if needed.

## Running the Demo (Real Output)

Here's a complete terminal capture from an actual run:

```
$ npm run demo

══════════════════════════════════════════════════════════════
  SYMPLEK ADVERSARIAL DEMO
  Deterministic Failure Replay
══════════════════════════════════════════════════════════════

▶ Phase 1 — The Problem: Flaky Agent
  Running bare agent 5 times (no Symplek). Each run makes 5 API calls.
  Two of those calls fail ~40% of the time.

  Run 1: ✗ FAILED — [API #3] POST /analyze → TIMEOUT (5000ms)
  Run 2: ✗ FAILED — [API #3] POST /analyze → TIMEOUT (5000ms)
  Run 3: ✗ FAILED — [API #5] POST /export → TIMEOUT (3000ms)
  Run 4: ✓ SUCCESS — 5 results
  Run 5: ✗ FAILED — [API #5] POST /export → TIMEOUT (3000ms)
  → 4/5 runs failed (genuinely non-deterministic)

▶ Phase 2 — Record a run with .rehearse()
  Trying until we get a successful run, then recording it...

  Attempt 1: ✗ Failed, retrying...
  Attempt 2: ✗ Failed, retrying...
  Attempt 3: ✓ Success — 2 events recorded
  Output: ["[API #1] GET /products → 200","[API #2] GET /prices → 200","[API #3] POST /analyze → 200","[API #4] GET /summary → 200","[API #5] POST /export → 200"]

▶ Phase 3 — Deterministic Replay with .replay()
  Replaying the recorded trace. The agent body is NEVER called.

  Events replayed: 2/2
  apiCallCount:    -999 (should be -999 — agent never ran!)
  Replay matched:  ✓ YES
  Divergences:     0
  Replayed output: ["[API #1] GET /products → 200","[API #2] GET /prices → 200","[API #3] POST /analyze → 200","[API #4] GET /summary → 200","[API #5] POST /export → 200"]

▶ Phase 4 — Verification

  Original output:  ["[API #1] GET /products → 200","[API #2] GET /prices → 200","[API #3] POST /analyze → 200","[API #4] GET /summary → 200","[API #5] POST /export → 200"]
  Replayed output:  ["[API #1] GET /products → 200","[API #2] GET /prices → 200","[API #3] POST /analyze → 200","[API #4] GET /summary → 200","[API #5] POST /export → 200"]
  Exact match:      ✓ YES
  Agent re-executed: ✓ NO (deterministic!)

══════════════════════════════════════════════════════════════
  THE SYMPLEK WEDGE
══════════════════════════════════════════════════════════════

  Without Symplek:
    • Flaky agents fail intermittently — hard to reproduce
    • Each debug attempt re-executes LLM calls — different results
    • You pay for every token burned during debugging

  With Symplek:
    • .rehearse() captures every decision, call, and output
    • .replay() reproduces the EXACT trace — 2 events, zero re-execution
    • The agent body is NEVER called — deterministic by construction
    • Output is identical: yes

  Get started: npm create symplek@latest
```
