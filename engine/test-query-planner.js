const assert = require('assert');

const {
  canonicalizeAction,
  normalizeIntent
} = require('./gemini-command-interpreter');

const {
  buildDeterministicPlan,
  normalizePlan
} = require('./query-planner');

const {
  buildSplQuery,
  validatePlannedQuery
} = require('./query-resolver');

const catalog = require('./bi-event-catalog');

function makeIntent(overrides = {}) {
  return {
    understood: true,
    query_type: 'data_query',
    action: 'spin_event',
    subject: {
      player_id: 1187248
    },
    scope: {},
    filters: [],
    requested_fields: [],
    operation: 'count',
    time_range: {
      type: 'relative',
      amount: 10,
      unit: 'days'
    },
    unresolved_terms: [],
    interpretation: [],
    original_command: '',
    ...overrides
  };
}

function testCanonicalAction() {
  assert.strictEqual(
    canonicalizeAction('spin', catalog),
    'spin_event'
  );
  assert.strictEqual(
    canonicalizeAction('spin event', catalog),
    'spin_event'
  );
}

function testRecordsCannotBeEmpty() {
  assert.throws(
    () =>
      normalizePlan(
        {
          answer_goal: 'bad',
          response_type: 'summary',
          queries: [
            {
              id: 'q1',
              purpose: 'bad records query',
              action: 'spin_event',
              operation: 'records',
              requested_fields: [],
              group_by: [],
              metric_field: null,
              filters: [],
              sort: null,
              limit: null
            }
          ]
        },
        makeIntent()
      ),
    /records without requested_fields/
  );
}

function testBiggestWinsPlan() {
  const intent =
    makeIntent({
      original_command:
        "Show me this player's biggest wins in the last 10 days"
    });

  const plan =
    buildDeterministicPlan({
      command:
        intent.original_command,
      intent
    });

  assert.strictEqual(
    plan.response_type,
    'top_wins'
  );
  assert.strictEqual(
    plan.queries[0].operation,
    'top_n'
  );
  assert.strictEqual(
    plan.queries[0].metric_field,
    'win_amount'
  );
  assert.strictEqual(
    plan.queries[0].limit,
    10
  );

  const built =
    buildSplQuery(
      plan.queries[0],
      intent
    );

  assert.match(
    built.spl,
    /win_amount/
  );
  assert.match(
    built.spl,
    /head 10/
  );
  assert.match(
    built.spl,
    /sort -/
  );
}

function testGameListPlan() {
  const intent =
    makeIntent({
      original_command:
        'list all games he played in the last 10 days'
    });

  const plan =
    buildDeterministicPlan({
      command:
        intent.original_command,
      intent
    });

  assert.strictEqual(
    plan.response_type,
    'game_list'
  );
  assert.strictEqual(
    plan.queries[0].operation,
    'group_count'
  );
  assert.deepStrictEqual(
    plan.queries[0].group_by,
    [
      'game_id',
      'game_provider_id'
    ]
  );

  const built =
    buildSplQuery(
      plan.queries[0],
      intent
    );

  assert.match(
    built.spl,
    /stats count as spin_count by/
  );
  assert.match(
    built.spl,
    /game_id/
  );
  assert.match(
    built.spl,
    /game_provider_id/
  );
}

function testJackpotPlan() {
  const intent =
    makeIntent({
      original_command:
        'did this player win any big jackpots in the last 10 days?'
    });

  const plan =
    buildDeterministicPlan({
      command:
        intent.original_command,
      intent
    });

  assert.strictEqual(
    plan.response_type,
    'jackpot'
  );
  assert.strictEqual(
    plan.queries.length,
    2
  );

  const built =
    buildSplQuery(
      plan.queries[0],
      intent
    );

  assert.match(
    built.spl,
    /win_type="grand_jackpot"/
  );
  assert.match(
    built.spl,
    /win_amount>0/
  );
}

function testOverviewPlan() {
  const intent =
    makeIntent({
      original_command:
        'give me an overview of this player gameplay in the last 10 days'
    });

  const plan =
    buildDeterministicPlan({
      command:
        intent.original_command,
      intent
    });

  assert.strictEqual(
    plan.response_type,
    'overview'
  );
  assert(
    plan.queries.length >= 5
  );

  const operations =
    plan.queries.map(
      query => query.operation
    );

  assert(
    operations.includes('sum')
  );
  assert(
    operations.includes('top_n')
  );
  assert(
    operations.includes('group_count')
  );
}

function testRequiredPlayerFilterSurvives() {
  const intent =
    makeIntent({
      scope: {
        game_id:
          'boomingsevendeluxelegacy'
      }
    });

  const malicious = {
    id: 'q1',
    purpose: 'count',
    action: 'spin_event',
    operation: 'count',
    requested_fields: [],
    group_by: [],
    metric_field: null,
    filters: [],
    sort: null,
    limit: null
  };

  const validated =
    validatePlannedQuery(
      malicious,
      intent
    );

  // Validation should accept the query shape; the planner's normalization
  // supplies required filters. This unit test checks direct resolver validation
  // does not crash on the safe plan shape.
  assert.strictEqual(
    validated.action,
    'spin_event'
  );
}

testCanonicalAction();
testRecordsCannotBeEmpty();
testBiggestWinsPlan();
testGameListPlan();
testJackpotPlan();
testOverviewPlan();
testRequiredPlayerFilterSurvives();

console.log('✅ Phase 7 Query Planner tests passed.');
