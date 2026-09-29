# Phase 5.1 — Natural Query Execution Hotfix

## Why this hotfix is required

The Phase 5 resolver successfully generated a natural-query SPL and launched the existing `run-and-extract.js` runner, but the runner's result detector only considered legacy monitor metric columns such as `total_spins` and `total_responses`.

A natural query can legitimately return arbitrary BI fields such as:

- `Payload.ClientPayload.bet_amount`
- `Payload.ClientPayload.bet_value`
- `Payload.ClientPayload.win_amount`
- `Payload.ClientPayload.device_model`

Therefore Splunk can visibly show a valid result table while the runner incorrectly waits for 120 seconds and reports a timeout.

The screenshot from the live test confirmed exactly this behavior: Splunk displayed a valid table with `bet_amount` / `bet_value`, but the runner did not recognize it as a completed result.

## Changes

### 1. `run-and-extract.js`

Adds an optional execution mode:

- existing monitor execution remains unchanged (`monitor`)
- natural query execution uses `natural_query`

Only `natural_query` mode allows a generic visible result table to count as complete. Legacy monitor queries continue to require their known metric columns.

### 2. `engine/query-resolver.js`

Passes `natural_query` as the fifth argument when invoking `run-and-extract.js`.

### 3. `engine/gemini-query-parser.js`

Adds a deterministic safety net for clear operation wording:

- `how much ... bet/win/spend/redeem` → `sum`
- `did ... any ...` → `exists`
- `how many` → `count`
- `latest/current` → `latest`
- `which / what types` → `values`

Also prevents a clear singular spin metric such as `how much did he bet?` from returning both `bet_amount` and `bet_value` when Gemini supplies both; `bet_amount` is preferred for that wording.

Gemini remains the semantic interpreter and still never writes SPL.

### 4. `engine/gemini-command-interpreter.js`

Passes the original user command into the parser normalization so the deterministic operation safeguard applies to the Gemini command-layer route as well.

## Replace

From this hotfix package, replace:

```text
run-and-extract.js
engine/query-resolver.js
engine/gemini-query-parser.js
engine/gemini-command-interpreter.js
```

No other Phase 5 files need to be replaced.

## Do NOT replace

```text
scheduler.js
run-all-monitors.js
monitor-config.json
```

The existing scheduled monitor flow is untouched.

## Tests

Run:

```bash
node engine/test-query-resolver.js
node engine/test-gemini-command-layer.js
node engine/test-natural-query-foundation.js
```

Then restart QA Sentinel.

## Live test

Use the same Slack thread:

```text
How much did he bet?
How much did he win?
```

The first query should now resolve to a `sum` query for `bet_amount`, rather than a raw table query, and the existing runner should recognize the result immediately.
