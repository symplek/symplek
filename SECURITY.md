# Security Policy

## Supported versions

Symplek is pre-1.0. We support **only the latest minor of each `@symplek/*` package** while in 0.x. Older minors receive no patches. Pin exact versions and upgrade deliberately.

| Package | Supported |
|---|---|
| `@symplek/core` | Latest 0.x minor |
| `@symplek/react` | Latest 0.x minor |
| `@symplek/convex` | Latest 0.x minor |
| `@symplek/cli` | Latest 0.x minor |
| `@symplek/mcp` | Latest 0.x minor |
| `@symplek/harness` | Latest 0.x minor |
| `@symplek/testing` | Latest 0.x minor |
| `@symplek/devtools` | Latest 0.x minor |
| `@symplek/pro` | Latest 0.x minor |

## Reporting a vulnerability

**Do not open a public issue.** Email **security@symplek.dev** with:

1. A description of the issue.
2. Affected package(s) and version(s).
3. A minimal reproduction (code, steps, expected vs actual).
4. Your assessment of severity and exploit path.
5. Whether you intend to publish under your own name or anonymously.

We aim to acknowledge within 48 hours and produce a fix or mitigation within 14 days for critical issues.

## Coordinated disclosure

We follow a **90-day coordinated disclosure** window:

- Day 0: report received, acknowledged.
- Day 0–14: fix developed and patched release prepared.
- Day 14–30: patched release published, advisory drafted.
- Day 30–90: window for users to upgrade.
- Day 90: public advisory and CVE (if applicable).

If we cannot meet the timeline, we will communicate revised dates in writing. If you disclose publicly before Day 90 without our agreement, that's your call — we will still publish an advisory but won't credit the discovery.

## In scope

- The published `@symplek/*` packages and their build artefacts on npm.
- This repo's CI configuration and release tooling.
- The Symplek documentation site.

## Out of scope

- The upstream private application that consumes Symplek. Vulnerabilities there are not handled by this project.
- Third-party LLM providers Symplek routes calls through. Report those to the provider.
- Issues in transitive dependencies — please report upstream and let us know.
- Social engineering of maintainers.

## Bug bounty

We do not currently offer a paid bounty. Credit in the advisory is the only reward.
