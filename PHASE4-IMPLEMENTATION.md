# Phase 4 — Gemini Command Layer

## What changed

1. `engine/gemini-command-interpreter.js`
   - New primary semantic command layer.
   - Routes commands to `legacy_monitor`, `natural_query`, `help`, or `unknown`.
   - Uses Gemini structured output.
   - Uses BI Event Catalog + conversation context.
   - Never generates SPL.

2. `engine/command-router.js`
   - Existing monitor execution code is preserved.
   - When `GEMINI_COMMAND_ROUTER_ENABLED=true`, Gemini interprets first.
   - Legacy monitor commands are converted back into the existing execution intent and run through the existing executor.
   - Natural BI queries are stored in the existing thread context and shown as structured interpretation only; query execution remains disabled until Query Resolver.
   - If Gemini fails, the existing command parser remains the fallback.

3. `engine/gemini-query-parser.js`
   - BI Event Catalog is now the knowledge source instead of the older standalone field dictionary.
   - Logical BI fields are canonicalized to `Payload.ClientPayload.*`.
   - Catalog-backed guard prevents `sweep` / `gold` from being incorrectly mapped to `spin_type`; they map to `unit_name` for `spin_event`.
   - Subject/scope are synchronized from filters for clean conversation context.

4. `engine/bi-event-catalog.js`
   - Runtime JS representation generated from the supplied `biEvents.ts` catalog.

5. `engine/test-gemini-command-layer.js`
   - Verifies catalog loading, field prefix, spin semantics, requested-field canonicalization, and command schema.

## Environment

Add to `.env`:

```env
GEMINI_API_KEY=...
GEMINI_MODEL=gemini-3.5-flash-lite
GEMINI_COMMAND_ROUTER_ENABLED=false
```

Keep `OPENAI_API_KEY` during this migration because the legacy command parser still uses it as fallback.

Set `GEMINI_COMMAND_ROUTER_ENABLED=true` only when ready to test the Gemini command layer, then restart the Node process.

## Scope protection

This phase does NOT modify:
- `scheduler.js`
- `run-all-monitors.js`
- scheduled monitor execution
- AI Review pipeline

## Expected flow

Slack → Command Router → Gemini Command Layer → structured intent → existing monitor executor OR Natural Query context.

Gemini decides WHAT the user means. QA Sentinel code decides HOW it is executed.
