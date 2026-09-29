const assert = require('assert');
const { buildKnowledge } = require('./gemini-query-parser');
const {
  mergeConversationContext,
  buildParserContext
} = require('./conversation-context');

const knowledge = buildKnowledge();
assert.ok(knowledge.field_dictionary.length > 0);
assert.ok(
  knowledge.field_dictionary.some(
    item => item.field === 'Payload.ClientPayload.game_user_id'
  )
);
assert.ok(
  knowledge.field_dictionary.some(
    item => item.field === 'Payload.ClientPayload.modal_id'
  )
);
assert.ok(knowledge.profiles.spin_event);
assert.ok(knowledge.profiles.modal_interact);

const previous = {
  version: 1,
  scope: {
    channelId: 'C123',
    threadTs: '123.456'
  },
  subject: {
    player_id: 1103838
  },
  queryScope: {
    game_id: 'ABC',
    unit_name: 'sweep'
  },
  action: 'spin_event',
  lastQuery: {
    filters: [],
    requested_fields: []
  },
  timeRange: {
    type: 'named',
    value: 'yesterday'
  }
};

const followUp = mergeConversationContext(previous, {
  action: 'spin_event',
  subject: {},
  scope: {},
  filters: [],
  requested_fields: ['Payload.ClientPayload.bet_value'],
  time_range: null
});

assert.strictEqual(followUp.subject.player_id, 1103838);
assert.strictEqual(followUp.queryScope.game_id, 'ABC');
assert.strictEqual(followUp.queryScope.unit_name, 'sweep');
assert.strictEqual(followUp.action, 'spin_event');
assert.strictEqual(
  followUp.lastQuery.requested_fields[0],
  'Payload.ClientPayload.bet_value'
);
assert.strictEqual(followUp.timeRange.value, 'yesterday');

const changedPlayer = mergeConversationContext(previous, {
  action: 'spin_event',
  subject: { player_id: 2200441 },
  scope: {},
  filters: [],
  requested_fields: [],
  time_range: null
});

assert.strictEqual(changedPlayer.subject.player_id, 2200441);
assert.strictEqual(changedPlayer.queryScope.game_id, 'ABC');

assert.strictEqual(
  buildParserContext(previous).subject.player_id,
  1103838
);

console.log('✅ Natural Query foundation tests passed.');
