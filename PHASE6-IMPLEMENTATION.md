# Phase 6B — Top Wins + Evidence Guard

This is a corrective follow-up to Phase 6 after the first live test.

## Fixes

### 1. Non-empty result cannot become "no matching records"

The Answer Generator now checks the actual record count and rejects a Gemini
narrative that contradicts a non-empty result.

### 2. Biggest Wins is a real query plan

A spin query with `records + win_amount` is upgraded deterministically to:

```text
where win_amount > 0
sort - win_amount
head 10
table time_stamp game_name game_id unit_name bet_value win_amount win_type
```

### 3. Factual table is deterministic

Gemini generates only the narrative. The Top 10 table is built directly from
the returned Splunk records, including the calculated multiplier.

## Replace only

```text
engine/query-resolver.js
engine/gemini-answer-generator.js
```

Do not touch:

```text
.env
scheduler.js
run-all-monitors.js
run-and-extract.js
```

## Verify

```bash
node --check engine/query-resolver.js
node --check engine/gemini-answer-generator.js
node engine/test-query-resolver.js
```

Then restart QA Sentinel.

## Expected

`Show me this player's biggest wins in the last 10 days`

should no longer issue a plain `table win_amount`. It should return the
largest positive wins with date/game/bet/win/multiplier.

The full player overview (total spins, games played, active days, wagered,
won, net) still needs the next multi-metric Query Planner step.
