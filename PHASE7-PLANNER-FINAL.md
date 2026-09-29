# Phase 7 Planner Final

This replaces the previous parser/planner implementation as one coherent integration.

## Replace under `engine/`

- `gemini-command-interpreter.js`
- `query-planner.js`
- `query-resolver.js`
- `gemini-answer-generator.js`

The package also includes the runtime BI catalog, field dictionary, and planner test:

- `bi-event-catalog.js` — generated from the supplied current `biEvents.ts`
- `splunk-field-dictionary.json`
- `test-query-planner.js`

If the project already has a newer synchronized `bi-event-catalog.js` or
`splunk-field-dictionary.json`, keep those files instead of overwriting them.

## Do not replace

- `.env`
- `scheduler.js`
- `run-all-monitors.js`
- `run-multi-window.js`
- `run-and-extract.js`
- `command-router.js`

The current command-router already has the legacy-first guard and passes the original
command into the natural-query intent.

## What changed

### 1. Gemini parser uses BI catalog as canonical vocabulary

The parser receives the canonical event names from `BI_ALL_EVENT_NAMES` and the
structured schema constrains `query_intent.action` to those names.

Examples:

- `spin` -> `spin_event`
- `spin event` -> `spin_event`
- `purchase` -> `purchase_response`
- `redeem` / `redemption` -> `redemption_response`

A small defensive alias layer remains after Gemini, but the catalog is the primary
source of truth.

### 2. Query Planner is a real planning stage

One question may produce multiple evidence queries.

Examples:

- biggest wins -> Top-N win evidence
- jackpots -> jackpot count + jackpot Top-N
- all games -> grouped Game ID + Game Provider + spin count
- gameplay overview -> spins + distinct games + active days + wagered + won + top wins
- interruption -> hourly activity + device/platform/browser context

### 3. Invalid `records` plans are rejected before execution

This is explicitly invalid:

```json
{"operation":"records","requested_fields":[]}
```

If Gemini produces it, planner normalization rejects it and uses the deterministic
planner fallback.

### 4. Game terminology

- `game_id` -> Game ID
- `game_provider_id` -> Game Provider
- `game_name` -> Product/App name

The final answer layer is instructed not to call `game_name` the provider.

### 5. Scheduler isolation

Natural Query continues to invoke the existing `run-and-extract.js` interface.
The package does not modify scheduler files or the scheduler 4-hour mode.

## Validation

```bash
node --check engine/gemini-command-interpreter.js
node --check engine/query-planner.js
node --check engine/query-resolver.js
node --check engine/gemini-answer-generator.js
node engine/test-query-planner.js
```

The local syntax checks and planner tests pass.
