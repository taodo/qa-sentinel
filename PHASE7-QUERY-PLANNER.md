# QA Sentinel Phase 7 — Query Planner

This is the first full Query Planner implementation rather than another formatter
patch.

## Architecture

```text
Slack question
    ↓
Gemini Natural Query Parser
    ↓
Resolved Intent + conversation context
    ↓
Gemini Query Planner
    ↓
Validated multi-query plan
    ↓
Deterministic Query Resolver
    ↓
Splunk
    ↓
Structured Evidence
    ↓
Gemini Answer Generator
    ↓
Slack
```

Gemini decides **what evidence is needed**. The application decides **how SPL is
generated** and enforces the player/game/time filters.

## Supported planner patterns

- simple count / existence
- sum of wagered/bet/win amounts
- latest / values lookup
- distinct counts such as unique games
- Top-N wins
- jackpot checks using `win_type=grand_jackpot`
- hourly gameplay activity for interruption/break questions
- device/platform/browser context
- grouped counts and grouped sums

## Important safety behavior

- Planner cannot remove the player filter from the resolved intent.
- Planner cannot remove explicit game/unit/client/device filters.
- Planned fields are validated against the BI catalog.
- SPL is never supplied by Gemini.
- Multiple evidence queries are supported.
- An empty individual query does not erase evidence returned by other queries.
- The answer layer cannot call non-empty evidence "no matching records".

## Files to replace

```text
engine/query-planner.js
engine/query-resolver.js
engine/gemini-answer-generator.js
```

Add:

```text
engine/test-query-planner.js
```

`bi-event-catalog.js` and the existing field knowledge files are included only
as the resolver/planner dependencies. If your current Phase 5/6 project already
has the newer versions of these knowledge files, keep those versions.

Do NOT replace:

```text
.env
scheduler.js
run-all-monitors.js
run-and-extract.js
```

## Validation

```bash
node --check engine/query-planner.js
node --check engine/query-resolver.js
node --check engine/gemini-answer-generator.js
node engine/test-query-planner.js
```

## Expected planning examples

### Biggest wins

A question such as:

`Show me this player's biggest wins in the last 10 days`

requires Top-N evidence, not a plain `table win_amount`.

### Jackpot

A question mentioning jackpots gets separate evidence for:

```text
win_type = grand_jackpot
```

and largest positive wins.

### Gameplay interruption

A question about interruptions gets:

1. hourly activity for the player across games
2. device/platform/browser context
3. hourly activity for the requested game

This supports describing an observed activity gap without falsely calling it
a crash or disconnect.

## Note

This is intentionally the foundation for the richer player-overview responses.
The planner is now multi-query, so the next work should extend planner patterns
and answer rendering—not introduce another parallel query system.
