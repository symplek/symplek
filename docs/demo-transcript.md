# Weft Demo: Terminal Transcript

> **Status.** This is a transcript from a demo script that lives outside this repository. The demo repository it came from (`wefthq/weft-demo`) is not published, so the output below has not been re-run against this checkout and cannot be reproduced from here. For something you can run yourself, use the record and replay example in the [README](../README.md#record-and-replay). It shows the same behaviour: two events recorded, nothing executed on replay.

## The Adversarial Demo

The demo simulates a flaky data pipeline with **5 API calls**, two of which fail ~40% of the time due to `Math.random()`. You cannot predict which runs will fail.

### Phase 1: The Problem, a Flaky Agent

Running the bare agent 5 times without Weft:

```
  Run 1: ✗ FAILED — [API #3] POST /analyze → TIMEOUT (5000ms)
  Run 2: ✗ FAILED — [API #3] POST /analyze → TIMEOUT (5000ms)
  Run 3: ✗ FAILED — [API #5] POST /export → TIMEOUT (3000ms)
  Run 4: ✓ SUCCESS — 5 results
  Run 5: ✗ FAILED — [API #5] POST /export → TIMEOUT (3000ms)
  → 4/5 runs failed (genuinely non-deterministic)
```

**4 out of 5 runs fail.** Different failures each time. Without a recording, debugging this means re-running and hoping you hit the failure.

### Phase 2: Record with `.rehearse()`

Weft wraps the agent and records a successful run:

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

The trace holds the outcome of that run: a start event, an end event and the final output. That is why the count says 2 events. The five API calls inside the agent are not recorded one by one.

### Phase 3: Replay with `.replay()`

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

The sentinel value `apiCallCount = -999` shows the agent body never executed. The output is identical because replay returns the stored output.

### Phase 4: Verification

```
  Original output:  ["[API #1] GET /products → 200", ...]
  Replayed output:  ["[API #1] GET /products → 200", ...]
  Exact match:      ✓ YES
  Agent re-executed: ✓ NO (deterministic!)
```

## What this shows, and what it does not

| Without Weft | With Weft |
|---|---|
| A flaky agent fails intermittently and is hard to reproduce | `.rehearse()` keeps the outcome of one good run |
| Each debug attempt re-executes the calls and gets different results | `.replay()` hands that stored outcome back, with zero re-execution |
| You pay for every token burned during debugging | Nothing runs on replay, so nothing is spent |

Replay does not re-run the agent. It cannot tell you whether the agent still behaves the way it did when the trace was recorded. `Replay matched: YES` means the trace is intact, not that today's agent would produce the same output. See [Record and replay](ARCHITECTURE.md) for the detail.

The original transcript ended with a full capture of the demo's terminal output, including a "Get started" command that used `npm create weft`. That section is removed: the capture cannot be reproduced without the demo repository, and `create-weft` on npm is someone else's package.
