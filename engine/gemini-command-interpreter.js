const https = require('https');

require('dotenv').config();

const fs = require('fs');
const path = require('path');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL =
  process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite';

const CATALOG_FILE =
  path.join(__dirname, 'bi-event-catalog.js');

const ALIAS_TO_CANONICAL = {
  spin: 'spin_event',
  spins: 'spin_event',
  'spin event': 'spin_event',
  gameplay: 'spin_event',
  purchase: 'purchase_response',
  purchases: 'purchase_response',
  'purchase response': 'purchase_response',
  redemption: 'redemption_response',
  redemptions: 'redemption_response',
  redeem: 'redemption_response',
  'redemption response': 'redemption_response',
  login: 'login',
  signin: 'login',
  'sign in': 'login',
  signup: 'signup',
  'sign up': 'signup',
  error: 'client_error',
  errors: 'client_error',
  'client error': 'client_error',
  quest: 'quest_end'
};

function loadCatalog() {
  if (!fs.existsSync(CATALOG_FILE)) {
    throw new Error(`BI Event Catalog not found: ${CATALOG_FILE}`);
  }
  return require(CATALOG_FILE);
}

function getCanonicalEvents(catalog) {
  return [
    ...new Set([
      ...(catalog.BI_ALL_EVENT_NAMES || []),
      ...(catalog.BI_EVENTS || []).map(event => event.name)
    ])
  ];
}

function canonicalizeAction(value, catalog) {
  const raw = String(value || '').trim();
  if (!raw) return '';

  const events = new Set(getCanonicalEvents(catalog));

  if (events.has(raw)) {
    return raw;
  }

  const lower = raw.toLowerCase();
  const mapped = ALIAS_TO_CANONICAL[lower];

  return mapped && events.has(mapped)
    ? mapped
    : raw;
}

function canonicalizeField(value, catalog) {
  const raw = String(value || '').trim();
  if (!raw) return '';

  const allFields = new Set([
    ...(catalog.BI_COMMON_FIELDS || []),
    ...(catalog.BI_EVENTS || []).flatMap(event => event.fields || [])
  ]);

  if (allFields.has(raw)) {
    return raw;
  }

  const aliases = {
    'game id': 'game_id',
    'game': 'game_id',
    'game provider': 'game_provider_id',
    'provider': 'game_provider_id',
    'game provider id': 'game_provider_id',
    'bet': 'bet_value',
    'wager': 'bet_value',
    'wagered': 'bet_value',
    'win': 'win_amount',
    'won': 'win_amount',
    'win amount': 'win_amount',
    'device': 'device_type',
    'os': 'os_platform',
    'browser': 'browser_name'
  };

  const mapped = aliases[raw.toLowerCase()];
  return mapped && allFields.has(mapped)
    ? mapped
    : raw;
}


function isNaturalDataCommand(command) {
  const text = String(command || '').trim().toLowerCase();
  if (!text) return false;

  // These are player/data questions, not scheduled monitor commands.
  // A leading "check" does not make them legacy when the command contains
  // a player subject or asks about a specific data dimension.
  const naturalSignals = [
    /\bplayer\s+\d{4,}\b/,
    /\bplayer\b.*\b(spin|spins|game|games|bet|win|won|purchase|redemption|device|event|activity)\b/,
    /\b(spin|spins)\b.*\b(any|all|which)\s+games?\b/,
    /\bhow much\b.*\b(bet|wager|win|won|purchase)\b/,
    /\bwhat (game|games|device|browser|os|platform|did)\b/,
    /\bdid\s+player\b/,
    /\bfor player\b/,
    /\bhis\b|\bher\b|\btheir\b.*\b(spin|game|bet|win|purchase|activity)\b/
  ];

  return naturalSignals.some(pattern => pattern.test(text));
}

function extractPlayerId(command) {
  const text = String(command || '');
  const match = text.match(/\bplayer\s*#?\s*(\d{4,})\b/i);
  return match ? Number(match[1]) : null;
}

function extractRelativeTime(command) {
  const text = String(command || '').toLowerCase();
  const match = text.match(
    /\b(?:last|past|previous|over\s+the\s+last|in\s+the\s+last)\s+(\d+(?:\.\d+)?)\s*(minute|minutes|min|mins|hour|hours|hr|hrs|day|days|week|weeks|month|months|mon|mons)\b/
  );

  if (!match) return null;

  const amount = Number(match[1]);
  const unitMap = {
    minute: 'minutes', minutes: 'minutes', min: 'minutes', mins: 'minutes',
    hour: 'hours', hours: 'hours', hr: 'hours', hrs: 'hours',
    day: 'days', days: 'days',
    week: 'weeks', weeks: 'weeks',
    month: 'months', months: 'months', mon: 'months', mons: 'months'
  };

  const unit = unitMap[match[2]];
  if (!Number.isFinite(amount) || amount <= 0 || !unit) return null;

  return {
    type: 'relative',
    amount,
    unit,
    value: null
  };
}

function inferNaturalAction(command, catalog) {
  const text = String(command || '').toLowerCase();
  const candidates = [
    [/\b(spin|spins|spin event)\b/, 'spin_event'],
    [/\b(purchase|purchases|purchase response)\b/, 'purchase_response'],
    [/\b(redemption|redemptions|redeem)\b/, 'redemption_response'],
    [/\b(sign\s*up|signup)\b/, 'signup'],
    [/\b(sign\s*in|signin|login)\b/, 'login'],
    [/\b(client\s+errors?|errors?)\b/, 'client_error']
  ];

  for (const [pattern, action] of candidates) {
    if (pattern.test(text)) {
      return canonicalizeAction(action, catalog);
    }
  }

  return '';
}

function buildNaturalFallbackIntent(command, catalog, existingIntent) {
  const base = existingIntent && typeof existingIntent === 'object'
    ? { ...existingIntent }
    : {};

  const playerId = extractPlayerId(command);
  const timeRange = extractRelativeTime(command);
  const action = canonicalizeAction(
    base.action || inferNaturalAction(command, catalog),
    catalog
  );

  base.understood = true;
  base.query_type = base.query_type || 'data_query';
  base.action = action || base.action || 'spin_event';
  base.subject = {
    ...(base.subject || {}),
    ...(playerId !== null ? { player_id: playerId } : {})
  };
  base.scope = {
    ...(base.scope || {})
  };
  base.filters = Array.isArray(base.filters) ? base.filters : [];
  base.requested_fields = Array.isArray(base.requested_fields)
    ? base.requested_fields
    : [];
  base.operation = base.operation || 'count';
  base.time_range = timeRange || base.time_range || {
    type: 'named',
    value: 'current'
  };
  base.unresolved_terms = Array.isArray(base.unresolved_terms)
    ? base.unresolved_terms
    : [];
  base.interpretation = Array.isArray(base.interpretation)
    ? base.interpretation
    : [];
  base.original_command = command;

  return normalizeIntent(base, catalog);
}

function normalizeIntent(intent, catalog) {
  const normalized = {
    ...(intent || {})
  };

  normalized.action =
    canonicalizeAction(
      normalized.action,
      catalog
    );

  normalized.requested_fields =
    Array.isArray(normalized.requested_fields)
      ? normalized.requested_fields
          .map(field =>
            canonicalizeField(
              field,
              catalog
            )
          )
          .filter(Boolean)
      : [];

  normalized.filters =
    Array.isArray(normalized.filters)
      ? normalized.filters.map(filter => ({
          ...filter,
          field: canonicalizeField(
            filter?.field,
            catalog
          ),
          operator:
            normalizeOperator(
              filter?.operator
            )
        }))
      : [];

  if (
    normalized.scope &&
    typeof normalized.scope === 'object'
  ) {
    normalized.scope = {
      ...normalized.scope
    };

    if (
      normalized.scope.game &&
      !normalized.scope.game_id &&
      !normalized.scope.game_name
    ) {
      normalized.scope.game_id =
        normalized.scope.game;
      delete normalized.scope.game;
    }
  }

  if (
    normalized.scope?.unit_name
  ) {
    const unit =
      String(
        normalized.scope.unit_name
      ).toLowerCase();

    if (
      unit === 'sc' ||
      unit === 'sweeps' ||
      unit === 'sweeps coin'
    ) {
      normalized.scope.unit_name =
        'sweep';
    }

    if (
      unit === 'gc' ||
      unit === 'gold' ||
      unit === 'gold coin'
    ) {
      normalized.scope.unit_name =
        'gold';
    }
  }

  return normalized;
}

function normalizeOperator(value) {
  const raw =
    String(value || 'equals')
      .trim()
      .toLowerCase();

  return {
    eq: 'equals',
    ne: 'not_equals',
    neq: 'not_equals',
    '=': 'equals'
  }[raw] || raw;
}

const schema = (() => {
  const catalog = loadCatalog();
  const events =
    getCanonicalEvents(catalog);

  const fields = [
    ...new Set([
      ...(catalog.BI_COMMON_FIELDS || []),
      ...(catalog.BI_EVENTS || []).flatMap(
        event => event.fields || []
      )
    ])
  ];

  return {
    type: 'OBJECT',
    properties: {
      route: {
        type: 'STRING',
        enum: [
          'natural_query',
          'legacy_monitor',
          'help',
          'unknown'
        ]
      },
      query_intent: {
        type: 'OBJECT',
        nullable: true,
        properties: {
          understood: {
            type: 'BOOLEAN'
          },
          query_type: {
            type: 'STRING'
          },
          action: {
            type: 'STRING',
            enum: events
          },
          subject: {
            type: 'OBJECT',
            nullable: true,
            properties: {
              player_id: {
                type: 'INTEGER',
                nullable: true
              }
            }
          },
          scope: {
            type: 'OBJECT',
            nullable: true,
            properties: {
              game_id: {
                type: 'STRING',
                nullable: true
              },
              game_name: {
                type: 'STRING',
                nullable: true
              },
              unit_name: {
                type: 'STRING',
                nullable: true
              },
              client_type: {
                type: 'STRING',
                nullable: true
              },
              device_type: {
                type: 'STRING',
                nullable: true
              },
              provider: {
                type: 'STRING',
                nullable: true
              }
            }
          },
          filters: {
            type: 'ARRAY',
            items: {
              type: 'OBJECT',
              properties: {
                field: {
                  type: 'STRING',
                  enum: fields
                },
                operator: {
                  type: 'STRING'
                },
                value: {
                  type: 'STRING'
                }
              },
              required: [
                'field',
                'operator',
                'value'
              ]
            }
          },
          requested_fields: {
            type: 'ARRAY',
            items: {
              type: 'STRING',
              enum: fields
            }
          },
          operation: {
            type: 'STRING',
            enum: [
              'count',
              'sum',
              'latest',
              'values',
              'records'
            ]
          },
          time_range: {
            type: 'OBJECT',
            nullable: true,
            properties: {
              type: {
                type: 'STRING'
              },
              amount: {
                type: 'INTEGER',
                nullable: true
              },
              unit: {
                type: 'STRING',
                nullable: true
              },
              value: {
                type: 'STRING',
                nullable: true
              }
            }
          },
          unresolved_terms: {
            type: 'ARRAY',
            items: {
              type: 'STRING'
            }
          },
          interpretation: {
            type: 'ARRAY',
            items: {
              type: 'OBJECT',
              properties: {
                term: {
                  type: 'STRING'
                },
                mapped_to: {
                  type: 'STRING'
                },
                reason: {
                  type: 'STRING'
                }
              },
              required: [
                'term',
                'mapped_to',
                'reason'
              ]
            }
          }
        },
        required: [
          'understood',
          'query_type',
          'action',
          'subject',
          'scope',
          'filters',
          'requested_fields',
          'operation',
          'time_range',
          'unresolved_terms',
          'interpretation'
        ]
      },
      legacy_intent: {
        type: 'OBJECT',
        nullable: true,
        properties: {
          understood: {
            type: 'BOOLEAN'
          },
          action: {
            type: 'STRING'
          },
          monitor: {
            type: 'STRING'
          },
          time_range: {
            type: 'OBJECT',
            nullable: true
          }
        }
      }
    },
    required: [
      'route',
      'query_intent',
      'legacy_intent'
    ]
  };
})();

function buildPrompt({
  command,
  conversationContext
}) {
  const catalog = loadCatalog();

  const eventDescriptions =
    (catalog.BI_EVENTS || []).map(
      event => ({
        name: event.name,
        flow: event.flow,
        source: event.source,
        fields: event.fields || [],
        note: event.note || ''
      })
    );

  return [
    'You are QA Sentinel Natural Query Interpreter.',
    '',
    'Your task is semantic interpretation only.',
    'You do not write SPL and you do not answer the user.',
    '',
    'AUTHORITATIVE BI EVENT RULE:',
    'The action field MUST be one of the canonical BI event names from BI_ALL_EVENT_NAMES.',
    'Use the BI catalog as the source of truth.',
    'Map natural wording to the canonical event name.',
    'Examples:',
    '  "spin", "spins", "spin event", "gameplay" → spin_event',
    '  "purchase", "purchases" → purchase_response',
    '  "redeem", "redemption" → redemption_response',
    'Never return a shorthand such as "spin" when the canonical event is "spin_event".',
    '',
    'FIELD RULES:',
    'Return logical field names exactly as listed in the catalog.',
    'For a spin question, "game" normally means game_id.',
    'Only use game_name when the user explicitly says "game name" or asks for the product/app name.',
    '"game provider" means game_provider_id.',
    '"SC"/"Sweeps Coin" means unit_name=sweep.',
    '"GC"/"Gold Coin" means unit_name=gold.',
    '',
    'CONVERSATION RULES:',
    '- Resolve pronouns such as "he", "his", "that player" using the supplied conversation context.',
    '- Preserve previous player/game/unit/time unless the user changes that dimension.',
    '- If the user changes the action, remove incompatible action-specific filters.',
    '- User-provided values override context.',
    '',
    'NATURAL QUERY VS LEGACY:',
    '- legacy_monitor is only for explicit monitor commands that name a monitor, e.g. "check spin event", "check purchase".',
    '- Natural player/data questions are natural_query.',
    '- Never convert a natural player question into a legacy monitor merely because it contains the word "spin".',
    '',
    'Do not invent fields. If something cannot be mapped to the catalog, put it in unresolved_terms.',
    '',
    `BI EVENT CATALOG:\n${JSON.stringify(eventDescriptions, null, 2)}`,
    '',
    `ALL CANONICAL EVENT NAMES:\n${JSON.stringify(catalog.BI_ALL_EVENT_NAMES || [], null, 2)}`,
    '',
    `CONVERSATION CONTEXT:\n${JSON.stringify(conversationContext || {}, null, 2)}`,
    '',
    `USER COMMAND:\n${command || ''}`,
    '',
    'Return only JSON matching the response schema.'
  ].join('\n');
}

function postGemini(body) {
  return new Promise((resolve, reject) => {
    if (!GEMINI_API_KEY) {
      reject(new Error('GEMINI_API_KEY is not configured.'));
      return;
    }

    const payload = JSON.stringify(body);

    const req = https.request(
      {
        hostname:
          'generativelanguage.googleapis.com',
        path:
          `/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload)
        }
      },
      res => {
        let raw = '';

        res.on('data', chunk => {
          raw += chunk.toString();
        });

        res.on('end', () => {
          let data;

          try {
            data = JSON.parse(raw);
          } catch (error) {
            reject(
              new Error(
                `Invalid Gemini interpreter response: ${raw.slice(0, 500)}`
              )
            );
            return;
          }

          if (res.statusCode < 200 || res.statusCode >= 300) {
            reject(
              new Error(
                data?.error?.message ||
                `Gemini interpreter HTTP ${res.statusCode}`
              )
            );
            return;
          }

          resolve(data);
        });
      }
    );

    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

function extractText(response) {
  return response?.candidates
    ?.flatMap(
      candidate =>
        candidate.content?.parts || []
    )
    ?.map(part => part?.text || '')
    ?.filter(Boolean)
    ?.join('')
    ?.trim() || '';
}

async function interpretCommand({
  command,
  conversationContext
}) {
  const catalog = loadCatalog();

  const response =
    await postGemini({
      contents: [
        {
          role: 'user',
          parts: [
            {
              text:
                buildPrompt({
                  command,
                  conversationContext
                })
            }
          ]
        }
      ],
      generationConfig: {
        temperature: 0,
        responseMimeType: 'application/json',
        responseSchema: schema
      }
    });

  const text =
    extractText(response);

  if (!text) {
    throw new Error(
      'Gemini command interpreter returned no content.'
    );
  }

  const parsed =
    JSON.parse(text);

  if (parsed.query_intent) {
    parsed.query_intent =
      normalizeIntent(
        parsed.query_intent,
        catalog
      );
  }

  if (parsed.legacy_intent) {
    parsed.legacy_intent =
      normalizeIntent(
        parsed.legacy_intent,
        catalog
      );
  }

  // IMPORTANT: "check player ..." is still a natural data query.
  // Do not let Gemini route it to the legacy monitor path merely because
  // the word "check" or a monitor alias such as "spin" is present.
  if (isNaturalDataCommand(command)) {
    parsed.route = 'natural_query';

    parsed.query_intent =
      buildNaturalFallbackIntent(
        command,
        catalog,
        parsed.query_intent || null
      );
  }

  if (
    parsed.route === 'natural_query' &&
    (!parsed.query_intent || parsed.query_intent.understood !== true)
  ) {
    parsed.query_intent =
      buildNaturalFallbackIntent(
        command,
        catalog,
        parsed.query_intent || parsed.legacy_intent || null
      );
  }

  return parsed;
}

module.exports = {
  interpretCommand,
  buildPrompt,
  normalizeIntent,
  canonicalizeAction,
  canonicalizeField,
  getCanonicalEvents,
  isNaturalDataCommand,
  buildNaturalFallbackIntent
};
