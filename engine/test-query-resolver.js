const assert = require('assert');
const {
  buildSplQuery,
  validateIntent,
  timeRangeToRunnerArgs
} = require('./query-resolver');

const spin = {
  understood: true,
  query_type: 'data_query',
  operation: 'sum',
  action: 'spin_event',
  subject: { player_id: 1187248 },
  scope: {
    game_name: 'egyptianpots',
    unit_name: 'sweep'
  },
  filters: [
    {
      field: 'Payload.ClientPayload.game_user_id',
      operator: 'equals',
      value: '1187248'
    },
    {
      field: 'Payload.ClientPayload.game_name',
      operator: 'equals',
      value: 'egyptianpots'
    },
    {
      field: 'Payload.ClientPayload.unit_name',
      operator: 'equals',
      value: 'sweep'
    }
  ],
  requested_fields: [
    'Payload.ClientPayload.bet_amount'
  ],
  time_range: {
    type: 'relative',
    amount: 2,
    unit: 'days'
  },
  unresolved_terms: []
};

const spinSpl = buildSplQuery(spin);
assert.ok(spinSpl.includes('index="sweeps"'));
assert.ok(spinSpl.includes('Payload.ClientPayload.action="spin_event"'));
assert.ok(spinSpl.includes('Payload.ClientPayload.game_user_id=1187248'));
assert.ok(spinSpl.includes('Payload.ClientPayload.game_name="egyptianpots"'));
assert.ok(spinSpl.includes('Payload.ClientPayload.unit_name="sweep"'));
assert.ok(spinSpl.includes('sum(Payload.ClientPayload.bet_amount) as Payload.ClientPayload.bet_amount'));

const purchaseExists = {
  understood: true,
  query_type: 'data_query',
  operation: 'exists',
  action: 'purchase_attempt',
  subject: { player_id: 1187248 },
  scope: {},
  filters: [
    {
      field: 'Payload.ClientPayload.game_user_id',
      operator: 'equals',
      value: '1187248'
    }
  ],
  requested_fields: [
    'Payload.ClientPayload.offer_id',
    'Payload.ClientPayload.price',
    'Payload.ClientPayload.transaction_id'
  ],
  time_range: {
    type: 'relative',
    amount: 2,
    unit: 'days'
  },
  unresolved_terms: []
};

const purchaseSpl = buildSplQuery(purchaseExists);
assert.ok(purchaseSpl.includes('Payload.ClientPayload.action="purchase_attempt"'));
assert.ok(purchaseSpl.includes('count as matching_events'));
assert.ok(purchaseSpl.includes('values(Payload.ClientPayload.offer_id) as Payload.ClientPayload.offer_id'));
assert.ok(purchaseSpl.includes('values(Payload.ClientPayload.price) as Payload.ClientPayload.price'));

const modalRecords = {
  understood: true,
  query_type: 'data_query',
  operation: 'records',
  action: 'modal_interact',
  subject: { player_id: 1187248 },
  scope: {},
  filters: [
    {
      field: 'Payload.ClientPayload.game_user_id',
      operator: 'equals',
      value: '1187248'
    },
    {
      field: 'Payload.ClientPayload.modal_id',
      operator: 'equals',
      value: 'default_offer_popup_4'
    }
  ],
  requested_fields: [
    'Payload.ClientPayload.modal_id',
    'Payload.ClientPayload.trigger_id',
    'Payload.ClientPayload.button_id'
  ],
  time_range: {
    type: 'named',
    value: 'yesterday'
  },
  unresolved_terms: []
};

const modalSpl = buildSplQuery(modalRecords);
assert.ok(modalSpl.includes('Payload.ClientPayload.action="modal_interact"'));
assert.ok(modalSpl.includes('| table Payload.ClientPayload.modal_id Payload.ClientPayload.trigger_id Payload.ClientPayload.button_id'));

assert.deepStrictEqual(
  timeRangeToRunnerArgs({ type: 'relative', amount: 7, unit: 'days' }),
  { windowName: 'last_7_days', rangeMode: 'default' }
);
assert.deepStrictEqual(
  timeRangeToRunnerArgs({ type: 'named', value: 'yesterday' }),
  { windowName: 'yesterday', rangeMode: 'full_day' }
);

assert.throws(
  () => validateIntent({
    ...spin,
    requested_fields: ['Payload.ClientPayload.not_a_real_field']
  }),
  /Unknown requested field/
);

assert.throws(
  () => validateIntent({
    ...spin,
    unresolved_terms: ['some unknown term']
  }),
  /clarification/
);

console.log('✅ Query Resolver tests passed.');
