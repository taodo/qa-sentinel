const assert = require('assert');
const {
  buildKnowledge,
  normalizeIntent
} = require('./gemini-query-parser');
const {
  COMMAND_SCHEMA
} = require('./gemini-command-interpreter');

const knowledge = buildKnowledge();

assert.ok(knowledge.events.some(event => event.name === 'spin_event'));
assert.ok(knowledge.events.some(event => event.name === 'modal_open_success'));
assert.ok(knowledge.field_dictionary.some(item => item.logical_name === 'game_user_id'));
assert.ok(knowledge.field_dictionary.some(item => item.logical_name === 'unit_name'));
assert.ok(knowledge.field_prefix === 'Payload.ClientPayload.');

const spin = normalizeIntent({
  understood: true,
  query_type: 'data_query',
  action: 'spin_event',
  subject: { player_id: 1103838 },
  scope: { game_name: 'abcxyz' },
  filters: [
    {
      field: 'Payload.ClientPayload.game_user_id',
      operator: 'equals',
      value: '1103838'
    },
    {
      field: 'Payload.ClientPayload.spin_type',
      operator: 'equals',
      value: 'sweep'
    }
  ],
  requested_fields: ['bet_value'],
  time_range: { type: 'relative', amount: 2, unit: 'day', value: null },
  unresolved_terms: [],
  interpretation: []
});

assert.ok(
  spin.filters.some(
    filter =>
      filter.field === 'Payload.ClientPayload.unit_name' &&
      filter.value === 'sweep'
  )
);
assert.ok(
  spin.requested_fields.includes('Payload.ClientPayload.bet_value')
);
assert.ok(COMMAND_SCHEMA.properties.route);

console.log('✅ Gemini Command Layer tests passed.');
