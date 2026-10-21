# Symplek Launch Marketing

Internal strategy doc. Not for publishing. The raw material that launch content gets cut from.

---

## The Story (in order)

### 1. The Setup

Single dad. Four kids. Commercial Director at a tiling company he rescued from collapse at 17. Thirteen years building Specialist Ceramics to £2.4M turnover in an industry that punishes perfectionism and rewards cutting corners. Always the tech guy in an analogue world. Cloud infrastructure before COVID. Bluebeam when everyone else was on pen and paper. Natural wiring, not foresight.

### 2. The Turn

Started building ProSentinel, a construction SaaS with AI at its core. Multi-agent system for programme management, Gantt charts, document intelligence. Picked Convex as the backend because when you're one person with no spare hours, you need the highest leverage per line of code. Convex's real-time subscriptions and serverless actions turned out to be uniquely suited to multi-agent coordination. Agents streaming results through mutations. The UI picking up consensus votes as reactive subscriptions. Isolated execution per agent without managing infrastructure. It wasn't planned as an architecture decision for a framework. It was a solo developer choosing the tool that let him move fastest.

### 3. The Frustration

Every TypeScript agent framework either made him write 80+ lines of scaffolding for basic coordination, or locked him into one LLM provider, or treated agent output as trusted by default. None of them composed cleanly on top of Convex. None of them had real multi-agent consensus. None of them cared about whether an agent's output was hallucinated garbage before passing it downstream.

### 4. The Build

So he built his own. Extracted from a real product, not imagined in a vacuum. A lazy monadic algebra where retry, fallback, consensus, debate, and confidence tracking compose as method chains on a single type. Zero-trust by default. Every result tracked with provenance, confidence scores, and verification metadata. Because in construction, if your AI tells a contractor the wrong thing about a contract clause, someone loses money. Trust isn't optional.

### 5. The Framework

Symplek. MIT core, BSL 1.1 Pro tier. Nine packages. TypeScript-native. The first agent framework that treats multi-agent coordination as a first-class composable primitive, not an afterthought bolted onto a prompt chain.

---

## The One-Liner (variations)

- "Composable agent primitives for TypeScript."
- "The TypeScript agent framework that was extracted from a real product, not invented in a pitch deck."
- "Multi-agent consensus, debate, and trust tracking as method chains. Not 80 lines of scaffolding."
- "I built this because I needed it. Then I realised everyone else does too."

---

## Competitive Position

### What Symplek is NOT competing against

- Python frameworks (CrewAI, AutoGen, LangGraph). Different ecosystem. Don't fight on their turf.
- Vercel AI SDK. Streaming-focused, different problem space. Complementary, not competitive.

### What Symplek IS competing against

- **"Just write the Promise.all yourself"** mentality. The biggest competitor is hand-rolled coordination code. Symplek has to prove the abstraction is worth the dependency.
- **Mastra.** Closest TypeScript competitor. Imperative, VC-backed, bigger community. Symplek's edge: monadic composition is genuinely more elegant, and the confidence/coherence math is more rigorous.
- **LangChain.js.** Established but bloated. Chain-of-prompts model. Symplek is smaller, more opinionated, better typed.
- **VoltAgent.** Newer entrant, agent engineering platform angle. Less mature coordination primitives.

### The wedge

TypeScript developers who need multi-agent coordination with real type safety, real confidence scoring, and real consensus mechanisms. Not prompt chaining. Not single-agent wrappers. Actual coordination.

---

## Key Messages

### For developers (Show HN, Reddit, Twitter)

**Lead:** "I was building a multi-agent SaaS for the construction industry and every TypeScript agent framework made me write 80 lines of scaffolding for basic coordination. So I built my own."

**Follow:** Symplek is extracted from a real product. The API was shaped by actual usage, not by imagining what developers might want. It's MIT-licensed, 25KB core, zero required peer deps, and the coordination operators (consensus, debate, dialectic, converge) are the things you're currently hand-rolling badly every time.

**Proof:** Show the 15-line example vs the 80-line equivalent. Then show consensus in 5 lines. Then show debate. Let the code do the talking.

### For the personal story angle

**Lead with frustration, not biography.** The single dad, self-taught, construction background comes in paragraph two as colour that makes you memorable. Not paragraph one as a sympathy play.

**The Convex angle.** Don't lead with it (small community), but use it as a credibility signal. "I picked Convex because I'm one person and needed maximum leverage. Turned out real-time subscriptions are exactly what multi-agent coordination needs. Symplek was born inside a Convex app and has first-class bindings for it."

**The constraint narrative.** Every technical decision traces back to having no spare resources. The framework is small and composable because it had to be. The Convex integration exists because that's where the real problem lives. Constraint-driven engineering. Not a funded team building features speculatively. One person building what they actually need.

### For teams evaluating frameworks

**Lead with trust.** Zero-trust by default. TrackedResult with provenance. Confidence scoring. Coherence measurement. The things enterprise teams care about that no other TypeScript framework has.

**The Pro tier.** TaCo consensus (multi-round iterative voting). Antibody registry (pattern detection and quarantine for bad outputs). Trust registry. These are the enterprise features. BSL 1.1 licensed. Clear free/paid boundary.

---

## Launch Channels (priority order)

### 1. Show HN

The origin story format. Technical substance with personal context. HN rewards "I built this because I needed it" when the technical work is real. The construction angle makes it memorable. The monadic composition gives the FP crowd something to engage with.

**Title options:**
- "Show HN: Symplek, composable agent primitives for TypeScript"
- "Show HN: I built a TypeScript agent framework because existing ones couldn't handle multi-agent consensus"

**Timing:** Weekday morning US time. Tuesday-Thursday.

### 2. Twitter/X thread

The compressed story. 5-7 tweets. Hook with the frustration, show the code comparison, end with the link. Tag relevant accounts in the TypeScript/AI space. Don't tag Convex directly in the launch thread (looks like shilling), but have a separate Convex-specific thread ready.

### 3. Reddit

- r/typescript: Technical deep-dive. Code examples. No personal story.
- r/AI_Agents: The coordination angle. Consensus, debate, dialectic as first-class primitives.
- r/node: Practical angle. 25KB, zero deps, dual ESM/CJS.

### 4. Dev.to / Hashnode blog post

Longer-form version of the Show HN. "Why I Built Another TypeScript Agent Framework (And Why This One Is Different)." Technical walkthrough with the personal narrative woven in.

### 5. Convex community

Dedicated post in Convex Discord/community. "Symplek was born inside a Convex app. Here's the integration." This audience is small but highly aligned and likely to adopt.

---

## Free vs Paid Boundary (make this visible)

| Feature | Core (MIT) | Pro (BSL 1.1) |
|---------|-----------|----------------|
| AgentUnit monad | Free | - |
| map, flatMap, retry, timeout, fallback | Free | - |
| consensus (single-round) | Free | - |
| debate, dialectic, converge | Free | - |
| Confidence scoring | Free | - |
| Coherence measurement | Free | - |
| Provider abstraction (OpenAI, Anthropic, Google) | Free | - |
| Observability and tracing | Free | - |
| Rehearsal and replay | Free | - |
| React hooks | Free | - |
| Convex bindings | Free | - |
| CLI scaffolding | Free | - |
| MCP server | Free | - |
| TaCo consensus (multi-round iterative) | - | Paid |
| Antibody registry | - | Paid |
| Trust registry | - | Paid |
| Stigmergic confidence | - | Paid |
| Teams and TeamRegistry | - | Paid |
| Solo autonomous execution | - | Paid |

The free tier is genuinely generous. This is deliberate. Adoption first, revenue from teams that need the enterprise features.

---

## README Fix (do before launch)

**DONE.** README restructured. The progression is now:

1. Multi-agent consensus (the differentiator, 10 lines)
2. Symplek facade for simple AI calls (3 lines)
3. `.toUnit()` bridging facade into full coordination
4. Resilience (retry/timeout/fallback)

The `.toUnit()` bridge was already in the code but undocumented. Now it's front and centre in the README, facade JSDoc, and SymplekBuilder JSDoc.

---

## What NOT to do

- Don't lead with "single dad" as the headline. It's colour, not the pitch.
- Don't position as a Convex-only framework. Provider-agnostic first, Convex-native second.
- Don't compare directly to Python frameworks. Different audience, different fight.
- Don't launch all nine packages simultaneously. Lead with @symplek/core. The rest follows.
- Don't undersell the technical work. "I used AI to code" is not the framing. Architecture is the framing.
- Don't wait for the perfect launch. The framework is ready. Ship the announcement.

---

## Open Questions

- [ ] Exact Convex-to-coordination mechanism: need Anthony to articulate the specific reactive pattern (consensus votes as subscriptions? agent results as mutations?) in one concrete sentence.
- [ ] npm publish: is @symplek/* claimed? Check namespace availability before launch day.
- [ ] GitHub repo visibility: symplek/symplek is the target. When does it go public?
- [ ] Landing page: does Symplek need one, or is the GitHub README sufficient for v1?
- [ ] Pro tier pricing: what's the model? Per-seat? Usage-based? Flat monthly?
