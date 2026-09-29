const https = require('https');
const fs = require('fs');
const path = require('path');

require('dotenv').config();

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL =
  process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite';

const CATALOG_FILE =
  path.join(__dirname, 'bi-event-catalog.js');

const MAX_QUERIES = 8;
const MAX_FIELDS = 12;
const MAX_LIMIT = 25;

const OPERATIONS = new Set([
  'count',
  'sum',
  'distinct_count',
  'latest',
  'values',
  'records',
  'top_n',
  'group_count',
  'group_sum'
]);

const OPERATORS = new Set([
  'equals',
  'not_equals',
  'contains',
  'not_contains',
  'gt',
  'gte',
  'lt',
  'lte',
  'in'
]);

const ACTION_ALIASES = {
  spin: 'spin_event',
  spins: 'spin_event',
  'spin event': 'spin_event',
  purchase: 'purchase_response',
  purchases: 'purchase_response',
  redemption: 'redemption_response',
  redemptions: 'redemption_response',
  redeem: 'redemption_response',
  login: 'login',
  signin: 'login',
  'sign in': 'login',
  signup: 'signup',
  'sign up': 'signup'
};

function loadCatalog() {
  if (!fs.existsSync(CATALOG_FILE)) {
    throw new Error(`BI Event Catalog not found: ${CATALOG_FILE}`);
  }
  return require(CATALOG_FILE);
}

function canonicalAction(value, catalog) {
  const raw = String(value || '').trim();
  const names = new Set([
    ...(catalog.BI_ALL_EVENT_NAMES || []),
    ...(catalog.BI_EVENTS || []).map(event => event.name)
  ]);

  if (names.has(raw)) return raw;

  const mapped =
    ACTION_ALIASES[raw.toLowerCase()];

  return mapped && names.has(mapped)
    ? mapped
    : raw;
}

function logicalField(field, catalog) {
  return String(field || '')
    .replace(catalog.BI_FIELD_PREFIX, '');
}

function canonicalField(field, catalog) {
  const raw = String(field || '').trim();
  if (!raw) return '';

  if (
    raw.startsWith(
      catalog.BI_FIELD_PREFIX
    )
  ) {
    return raw;
  }

  const known = new Set([
    ...(catalog.BI_COMMON_FIELDS || []),
    ...(catalog.BI_EVENTS || []).flatMap(
      event => event.fields || []
    )
  ]);

  return known.has(raw)
    ? `${catalog.BI_FIELD_PREFIX}${raw}`
    : raw;
}

function numericFields() {
  return new Set([
    'bet_amount',
    'bet_value',
    'max_bet',
    'win_amount',
    'spin_duration_ms',
    'number_free_spin',
    'price',
    'amount'
  ]);
}

function isNumericField(field, catalog) {
  return numericFields().has(
    logicalField(
      field,
      catalog
    )
  );
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

function normalizeFilter(filter, catalog) {
  const field =
    canonicalField(
      filter?.field,
      catalog
    );

  const operator =
    normalizeOperator(
      filter?.operator
    );

  let value =
    filter?.value;

  if (
    Array.isArray(value)
  ) {
    value =
      value
        .map(item => String(item).trim())
        .filter(Boolean);
  } else {
    value =
      String(
        value ?? ''
      ).trim();
  }

  if (!field) {
    throw new Error(
      'Planner produced an empty filter field.'
    );
  }

  if (!OPERATORS.has(operator)) {
    throw new Error(
      `Planner produced unsupported operator: ${operator}`
    );
  }

  if (
    (
      Array.isArray(value) &&
      value.length === 0
    ) ||
    (
      !Array.isArray(value) &&
      !value
    )
  ) {
    throw new Error(
      `Planner produced an empty filter value for ${field}.`
    );
  }

  return {
    field,
    operator,
    value
  };
}

function baseFilters(intent, catalog) {
  const prefix =
    catalog.BI_FIELD_PREFIX;

  const filters = [];

  const player =
    intent?.subject?.player_id;

  if (
    player !== null &&
    player !== undefined &&
    String(player).trim()
  ) {
    filters.push({
      field:
        `${prefix}game_user_id`,
      operator: 'equals',
      value: String(player)
    });
  }

  const scope =
    intent?.scope || {};

  if (scope.game_id) {
    filters.push({
      field:
        `${prefix}game_id`,
      operator: 'equals',
      value:
        String(scope.game_id)
    });
  }

  if (scope.game_name) {
    filters.push({
      field:
        `${prefix}game_name`,
      operator: 'equals',
      value:
        String(scope.game_name)
    });
  }

  if (scope.unit_name) {
    filters.push({
      field:
        `${prefix}unit_name`,
      operator: 'equals',
      value:
        String(scope.unit_name)
    });
  }

  if (scope.client_type) {
    filters.push({
      field:
        `${prefix}client_type`,
      operator: 'equals',
      value:
        String(scope.client_type)
    });
  }

  if (scope.device_type) {
    filters.push({
      field:
        `${prefix}device_type`,
      operator: 'equals',
      value:
        String(scope.device_type)
    });
  }

  if (scope.provider) {
    filters.push({
      field:
        `${prefix}game_provider_id`,
      operator: 'equals',
      value:
        String(scope.provider)
    });
  }

  for (
    const rawFilter of
    Array.isArray(intent?.filters)
      ? intent.filters
      : []
  ) {
    const normalized =
      normalizeFilter(
        rawFilter,
        catalog
      );

    if (
      !filters.some(
        existing =>
          existing.field ===
            normalized.field &&
          existing.operator ===
            normalized.operator &&
          String(existing.value) ===
            String(normalized.value)
      )
    ) {
      filters.push(
        normalized
      );
    }
  }

  return filters;
}

function mergeRequiredFilters(
  plannedFilters,
  requiredFilters
) {
  const result =
    Array.isArray(plannedFilters)
      ? [...plannedFilters]
      : [];

  for (
    const required of
    requiredFilters
  ) {
    const found =
      result.some(
        candidate =>
          candidate.field ===
            required.field &&
          candidate.operator ===
            required.operator &&
          String(candidate.value) ===
            String(required.value)
      );

    if (!found) {
      result.push(
        required
      );
    }
  }

  return result;
}

function isAllGamesRequest(command) {
  const lower = String(command || '').toLowerCase();
  return /\b(?:list|show|which)\s+(?:all\s+)?games\b/.test(lower) || /\ball\s+games\b/.test(lower);
}

function removeGameFilters(filters, catalog) {
  const gameFields = new Set([
    `${catalog.BI_FIELD_PREFIX}game_id`,
    `${catalog.BI_FIELD_PREFIX}game_name`,
    'game_id',
    'game_name'
  ]);
  return (filters || []).filter(filter => !gameFields.has(String(filter?.field || '')));
}

function normalizeTimeSpan(value, operation, purpose) {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === '1h' || raw === '1d') return raw;
  if (operation === 'group_count' && /day|active day/i.test(String(purpose || ''))) return '1d';
  return operation === 'group_count' ? '1h' : null;
}

function normalizePlan(
  rawPlan,
  intent
) {
  const catalog =
    loadCatalog();

  if (
    !rawPlan ||
    typeof rawPlan !== 'object'
  ) {
    throw new Error(
      'Gemini Query Planner returned an empty plan.'
    );
  }

  const queries =
    Array.isArray(
      rawPlan.queries
    )
      ? rawPlan.queries
      : [];

  if (
    queries.length < 1 ||
    queries.length > MAX_QUERIES
  ) {
    throw new Error(
      `Query plan must contain 1-${MAX_QUERIES} queries.`
    );
  }

  const requiredFilters =
    baseFilters(
      intent,
      catalog
    );

  const normalizedQueries =
    queries.map(
      (rawQuery, index) => {
        const action =
          canonicalAction(
            rawQuery?.action ||
            intent?.action,
            catalog
          );

        const operation =
          String(
            rawQuery?.operation ||
            'count'
          )
            .trim()
            .toLowerCase();

        if (!OPERATIONS.has(operation)) {
          throw new Error(
            `Unsupported planner operation: ${operation}`
          );
        }

        const eventNames =
          new Set([
            ...(catalog.BI_ALL_EVENT_NAMES || []),
            ...(catalog.BI_EVENTS || [])
              .map(event => event.name)
          ]);

        if (
          !action ||
          !eventNames.has(action)
        ) {
          throw new Error(
            `Unknown planner BI event/action: ${action || 'empty'}`
          );
        }

        let requestedFields =
          Array.isArray(
            rawQuery?.requested_fields
          )
            ? rawQuery.requested_fields
                .map(field =>
                  canonicalField(
                    field,
                    catalog
                  )
                )
                .filter(Boolean)
            : [];

        if (
          requestedFields.length >
          MAX_FIELDS
        ) {
          throw new Error(
            `Planner query ${index + 1} requests too many fields.`
          );
        }

        const groupBy =
          Array.isArray(
            rawQuery?.group_by
          )
            ? rawQuery.group_by
                .map(field =>
                  String(field || '').trim()
                )
                .filter(Boolean)
                .map(field =>
                  field === '_time'
                    ? field
                    : canonicalField(
                        field,
                        catalog
                      )
                )
                .filter(Boolean)
            : [];

        const metricField =
          rawQuery?.metric_field
            ? canonicalField(
                rawQuery.metric_field,
                catalog
              )
            : null;

        let filters =
          mergeRequiredFilters(
            Array.isArray(rawQuery?.filters)
              ? rawQuery.filters.map(filter =>
                  normalizeFilter(
                    filter,
                    catalog
                  )
                )
              : [],
            requiredFilters
          );

        if (isAllGamesRequest(intent?.original_command || '')) {
          filters = removeGameFilters(filters, catalog);
        }

        let sort = null;
        if (rawQuery?.sort?.field) {
          sort = {
            field:
              canonicalField(
                rawQuery.sort.field,
                catalog
              ),
            direction:
              String(
                rawQuery.sort.direction ||
                'desc'
              )
                .trim()
                .toLowerCase()
          };

          if (
            !['asc', 'desc']
              .includes(sort.direction)
          ) {
            throw new Error(
              `Invalid sort direction: ${sort.direction}`
            );
          }
        }

        let limit =
          rawQuery?.limit === null ||
          rawQuery?.limit === undefined
            ? null
            : Number(rawQuery.limit);

        if (
          limit !== null &&
          (
            !Number.isInteger(limit) ||
            limit < 1 ||
            limit > MAX_LIMIT
          )
        ) {
          throw new Error(
            `Invalid planner limit: ${limit}`
          );
        }

        /*
         * Never allow a records operation without fields.
         * This is the exact failure mode we are eliminating.
         */
        if (
          operation === 'records' &&
          requestedFields.length === 0
        ) {
          throw new Error(
            `Planner query ${index + 1} uses records without requested_fields.`
          );
        }

        if (
          ['latest', 'values']
            .includes(operation) &&
          requestedFields.length === 0
        ) {
          throw new Error(
            `Planner query ${index + 1} uses ${operation} without requested_fields.`
          );
        }

        if (
          ['sum', 'group_sum', 'top_n']
            .includes(operation) &&
          !metricField
        ) {
          throw new Error(
            `Planner query ${index + 1} uses ${operation} without metric_field.`
          );
        }

        if (
          metricField &&
          !isNumericField(
            metricField,
            catalog
          )
        ) {
          throw new Error(
            `Planner metric field is not numeric: ${metricField}`
          );
        }

        if (
          operation === 'group_count' &&
          groupBy.length === 0
        ) {
          throw new Error(
            `Planner query ${index + 1} uses group_count without group_by.`
          );
        }

        if (
          operation === 'group_sum' &&
          groupBy.length === 0
        ) {
          throw new Error(
            `Planner query ${index + 1} uses group_sum without group_by.`
          );
        }

        return {
          id:
            String(
              rawQuery?.id ||
              `q${index + 1}`
            )
              .trim()
              .replace(
                /[^a-zA-Z0-9_-]/g,
                '_'
              ),
          purpose:
            String(
              rawQuery?.purpose ||
              `Evidence query ${index + 1}`
            ).trim(),
          action,
          operation,
          requested_fields:
            requestedFields,
          group_by:
            groupBy,
          time_span:
            normalizeTimeSpan(
              rawQuery?.time_span,
              operation,
              rawQuery?.purpose
            ),
          metric_field:
            metricField,
          filters,
          sort,
          limit
        };
      }
    );

  return {
    version: 2,
    answer_goal:
      String(
        rawPlan.answer_goal ||
        'Answer the user question from the collected evidence.'
      ).trim(),
    response_type:
      String(
        rawPlan.response_type ||
        'summary'
      ).trim(),
    queries:
      normalizedQueries
  };
}

const QUERY_SCHEMA = {
  type: 'OBJECT',
  properties: {
    answer_goal: {
      type: 'STRING'
    },
    response_type: {
      type: 'STRING'
    },
    queries: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          id: {
            type: 'STRING'
          },
          purpose: {
            type: 'STRING'
          },
          action: {
            type: 'STRING'
          },
          operation: {
            type: 'STRING',
            enum: [
              'count',
              'sum',
              'distinct_count',
              'latest',
              'values',
              'records',
              'top_n',
              'group_count',
              'group_sum'
            ]
          },
          requested_fields: {
            type: 'ARRAY',
            items: {
              type: 'STRING'
            }
          },
          group_by: {
            type: 'ARRAY',
            items: {
              type: 'STRING'
            }
          },
          time_span: {
            type: 'STRING',
            nullable: true,
            enum: ['1h', '1d']
          },
          metric_field: {
            type: 'STRING',
            nullable: true
          },
          filters: {
            type: 'ARRAY',
            items: {
              type: 'OBJECT',
              properties: {
                field: {
                  type: 'STRING'
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
          sort: {
            type: 'OBJECT',
            nullable: true,
            properties: {
              field: {
                type: 'STRING'
              },
              direction: {
                type: 'STRING',
                enum: [
                  'asc',
                  'desc'
                ]
              }
            },
            required: [
              'field',
              'direction'
            ]
          },
          limit: {
            type: 'INTEGER',
            nullable: true
          }
        },
        required: [
          'id',
          'purpose',
          'action',
          'operation',
          'requested_fields',
          'group_by',
          'time_span',
          'metric_field',
          'filters',
          'sort',
          'limit'
        ]
      }
    }
  },
  required: [
    'answer_goal',
    'response_type',
    'queries'
  ]
};

function buildDeterministicPlan({
  command,
  intent
}) {
  const catalog =
    loadCatalog();

  const action =
    canonicalAction(
      intent?.action,
      catalog
    );

  if (!action) {
    throw new Error(
      'Cannot plan a query without a BI event/action.'
    );
  }

  const filters =
    baseFilters(
      intent,
      catalog
    );

  const lower =
    String(
      command ||
      intent?.original_command ||
      ''
    )
      .trim()
      .toLowerCase();

  const player =
    intent?.subject?.player_id;

  const isSpin =
    action === 'spin_event';

  const isJackpot =
    isSpin &&
    /\bjackpot(?:s)?\b/.test(lower);

  const isBiggestWins =
    isSpin &&
    (
      /\b(biggest|largest|top)\b.*\bwin/.test(lower) ||
      /\bwin(?:s)?\b.*\b(biggest|largest|top)\b/.test(lower)
    );

  const isGameList =
    isSpin &&
    (
      /\b(list|show|which)\b.*\b(all\s+)?games\b/.test(lower) ||
      /\ball\s+games\b/.test(lower)
    );

  const isInterruption =
    isSpin &&
    (
      /\binterrupt/.test(lower) ||
      /\bbreak in gameplay\b/.test(lower) ||
      /\bgameplay.*break\b/.test(lower) ||
      /\bno activity\b/.test(lower)
    );

  const isOverview =
    isSpin &&
    (
      /\boverview\b/.test(lower) ||
      /\bsummary\b/.test(lower) ||
      (
        /\btotal spins\b/.test(lower) &&
        /\bwager/.test(lower)
      )
    );

  const commonWinFields = [
    'time_stamp',
    'game_id',
    'game_provider_id',
    'unit_name',
    'bet_value',
    'win_amount',
    'win_type'
  ];

  if (isGameList) {
    return {
      version: 2,
      answer_goal:
        'List every distinct game the player played, with provider and spin count.',
      response_type: 'game_list',
      queries: [
        {
          id: 'game_list',
          purpose:
            'Distinct games with provider and spin count.',
          action,
          operation: 'group_count',
          requested_fields: [],
          group_by: [
            'game_id',
            'game_provider_id'
          ],
          time_span: null,
          metric_field: null,
          filters: removeGameFilters(filters, catalog),
          sort: {
            field: 'spin_count',
            direction: 'desc'
          },
          limit: null
        }
      ]
    };
  }

  if (isJackpot) {
    return {
      version: 2,
      answer_goal:
        'Determine whether any recorded grand jackpot spin wins occurred and show the largest.',
      response_type: 'jackpot',
      queries: [
        {
          id: 'jackpot_count',
          purpose:
            'Count spin events explicitly flagged as grand jackpots.',
          action,
          operation: 'count',
          requested_fields: [],
          group_by: [],
          metric_field: null,
          filters: [
            ...filters,
            {
              field: 'win_type',
              operator: 'equals',
              value: 'grand_jackpot'
            },
            {
              field: 'win_amount',
              operator: 'gt',
              value: '0'
            }
          ],
          sort: null,
          limit: null
        },
        {
          id: 'jackpot_wins',
          purpose:
            'Largest recorded grand jackpot wins with context.',
          action,
          operation: 'top_n',
          requested_fields:
            commonWinFields,
          group_by: [],
          metric_field: 'win_amount',
          filters: [
            ...filters,
            {
              field: 'win_type',
              operator: 'equals',
              value: 'grand_jackpot'
            },
            {
              field: 'win_amount',
              operator: 'gt',
              value: '0'
            }
          ],
          sort: {
            field: 'win_amount',
            direction: 'desc'
          },
          limit: 10
        }
      ]
    };
  }

  if (isBiggestWins) {
    return {
      version: 2,
      answer_goal:
        'Show the player’s largest positive spin wins with game/provider and wager context.',
      response_type: 'top_wins',
      queries: [
        {
          id: 'top_wins',
          purpose:
            'Largest positive win amounts.',
          action,
          operation: 'top_n',
          requested_fields:
            commonWinFields,
          group_by: [],
          metric_field: 'win_amount',
          filters: [
            ...filters,
            {
              field: 'win_amount',
              operator: 'gt',
              value: '0'
            }
          ],
          sort: {
            field: 'win_amount',
            direction: 'desc'
          },
          limit: 10
        }
      ]
    };
  }

  if (isInterruption) {
    return {
      version: 2,
      answer_goal:
        'Assess gameplay continuity and observed activity gaps without claiming a technical failure unless error evidence exists.',
      response_type: 'interruption',
      queries: [
        {
          id: 'hourly_activity',
          purpose:
            'Hourly spin activity for the player across all games.',
          action,
          operation: 'group_count',
          requested_fields: [],
          group_by: ['_time'],
          time_span: '1h',
          metric_field: null,
          filters: [
            {
              field:
                `${catalog.BI_FIELD_PREFIX}game_user_id`,
              operator: 'equals',
              value: String(player || '')
            }
          ],
          sort: null,
          limit: null
        },
        {
          id: 'device_context',
          purpose:
            'Device/platform/browser values during requested activity.',
          action,
          operation: 'values',
          requested_fields: [
            'device_type',
            'os_platform',
            'browser_name'
          ],
          group_by: [],
          metric_field: null,
          filters,
          sort: null,
          limit: null
        }
      ]
    };
  }

  if (isOverview) {
    return {
      version: 2,
      answer_goal:
        'Summarize gameplay activity including spins, games, active days, wagered, won, net, and biggest wins.',
      response_type: 'overview',
      queries: [
        {
          id: 'total_spins',
          purpose: 'Total spin events.',
          action,
          operation: 'count',
          requested_fields: [],
          group_by: [],
          metric_field: null,
          filters,
          sort: null,
          limit: null
        },
        {
          id: 'games_played',
          purpose: 'Distinct games played.',
          action,
          operation: 'distinct_count',
          requested_fields: [],
          group_by: [],
          metric_field: 'game_id',
          filters,
          sort: null,
          limit: null
        },
        {
          id: 'active_days',
          purpose: 'One evidence row per active calendar day.',
          action,
          operation: 'group_count',
          requested_fields: [],
          group_by: ['_time'],
          time_span: '1d',
          metric_field: null,
          filters,
          sort: null,
          limit: null
        },
        {
          id: 'wagered',
          purpose: 'Total wagered amount.',
          action,
          operation: 'sum',
          requested_fields: ['bet_value'],
          group_by: [],
          metric_field: 'bet_value',
          filters,
          sort: null,
          limit: null
        },
        {
          id: 'won',
          purpose: 'Total win amount.',
          action,
          operation: 'sum',
          requested_fields: ['win_amount'],
          group_by: [],
          metric_field: 'win_amount',
          filters,
          sort: null,
          limit: null
        },
        {
          id: 'top_wins',
          purpose: 'Largest positive wins.',
          action,
          operation: 'top_n',
          requested_fields:
            commonWinFields,
          group_by: [],
          metric_field: 'win_amount',
          filters: [
            ...filters,
            {
              field: 'win_amount',
              operator: 'gt',
              value: '0'
            }
          ],
          sort: {
            field: 'win_amount',
            direction: 'desc'
          },
          limit: 10
        }
      ]
    };
  }

  const requested =
    Array.isArray(
      intent?.requested_fields
    )
      ? intent.requested_fields
      : [];

  if (requested.length > 0) {
    const operation =
      intent.operation === 'sum'
        ? 'sum'
        : intent.operation === 'values'
          ? 'values'
          : intent.operation === 'latest'
            ? 'latest'
            : 'records';

    return {
      version: 2,
      answer_goal:
        'Answer the requested field question.',
      response_type: 'lookup',
      queries: [
        {
          id: 'lookup',
          purpose:
            'Requested field evidence.',
          action,
          operation,
          requested_fields:
            requested,
          group_by: [],
          metric_field:
            operation === 'sum' &&
            requested.length === 1
              ? requested[0]
              : null,
          filters,
          sort: null,
          limit: null
        }
      ]
    };
  }

  return {
    version: 2,
    answer_goal:
      'Count matching BI events for the user question.',
    response_type: 'summary',
    queries: [
      {
        id: 'count',
        purpose:
          'Count matching events.',
        action,
        operation: 'count',
        requested_fields: [],
        group_by: [],
        metric_field: null,
        filters,
        sort: null,
        limit: null
      }
    ]
  };
}

function postGemini(body) {
  return new Promise((resolve, reject) => {
    if (!GEMINI_API_KEY) {
      reject(
        new Error(
          'GEMINI_API_KEY is not configured.'
        )
      );
      return;
    }

    const payload =
      JSON.stringify(body);

    const req =
      https.request(
        {
          hostname:
            'generativelanguage.googleapis.com',
          path:
            `/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`,
          method: 'POST',
          headers: {
            'Content-Type':
              'application/json',
            'Content-Length':
              Buffer.byteLength(payload)
          }
        },
        res => {
          let raw = '';

          res.on(
            'data',
            chunk => {
              raw += chunk.toString();
            }
          );

          res.on(
            'end',
            () => {
              let data;

              try {
                data =
                  JSON.parse(raw);
              } catch (error) {
                reject(
                  new Error(
                    `Invalid Gemini planner response: ${raw.slice(0, 500)}`
                  )
                );
                return;
              }

              if (
                res.statusCode < 200 ||
                res.statusCode >= 300
              ) {
                reject(
                  new Error(
                    data?.error?.message ||
                    `Gemini planner HTTP ${res.statusCode}`
                  )
                );
                return;
              }

              resolve(data);
            }
          );
        }
      );

    req.on(
      'error',
      reject
    );

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

function buildPlannerPrompt({
  command,
  intent
}) {
  const catalog =
    loadCatalog();

  const events =
    (catalog.BI_EVENTS || [])
      .map(event => ({
        name: event.name,
        flow: event.flow,
        source: event.source,
        fields:
          event.fields || [],
        note:
          event.note || ''
      }));

  const common =
    catalog.BI_COMMON_FIELDS || [];

  return [
    'You are QA Sentinel Query Planner.',
    '',
    'Decide WHAT evidence is required to answer the user question.',
    'Do not write SPL.',
    '',
    'AUTHORITATIVE VOCABULARY:',
    '- action MUST be a canonical BI event name from BI_ALL_EVENT_NAMES.',
    '- "spin" means spin_event.',
    '- "purchase" means purchase_response.',
    '- "redeem/redemption" means redemption_response.',
    '',
    'PLANNING RULES:',
    '- One question may require multiple evidence queries.',
    '- Do not reduce a rich question to a simple count.',
    '- "biggest/largest/top wins" => top_n, metric_field=win_amount, descending, positive wins only, with time_stamp, game_id, game_provider_id, unit_name, bet_value, win_amount, win_type.',
    '- "big jackpots" => a separate jackpot count using win_type=grand_jackpot and a top_n jackpot query.',
    '- "list/show all games" => group_count by game_id and game_provider_id; do not use latest(game_id).',
    '- "overview/summary" of gameplay => total spins, distinct games, active days, wagered, won, and top wins.',
    '- "how much did he bet/wager" => sum bet_value.',
    '- "how much did he win" => sum win_amount.',
    '- "active days" => group_count by _time with 1d binning.',
    '- "gameplay interruption/break" => hourly activity + device/platform/browser context; do not claim crash without error evidence.',
    '- Keep player/game/unit/client/device filters from the resolved intent.',
    '- If user says all games, remove only the explicit game filter if the user explicitly requested all games; keep player/time/unit/client/device filters.',
    '- Never invent fields.',
    '',
    'CRITICAL OUTPUT RULE:',
    '- operation=records MUST have requested_fields with at least one field.',
    '- Do NOT output records with an empty requested_fields array.',
    '- Prefer count/group_count/top_n/sum for queries that do not need raw fields.',
    '',
    `BI EVENTS:\n${JSON.stringify(events, null, 2)}`,
    '',
    `COMMON FIELDS:\n${JSON.stringify(common, null, 2)}`,
    '',
    `RESOLVED INTENT:\n${JSON.stringify(intent || {}, null, 2)}`,
    '',
    `USER QUESTION:\n${command || intent?.original_command || ''}`,
    '',
    'Return only JSON matching the schema.'
  ].join('\n');
}

async function createQueryPlan({
  command,
  intent
}) {
  const fallback =
    () =>
      normalizePlan(
        buildDeterministicPlan({
          command,
          intent
        }),
        intent
      );

  if (!GEMINI_API_KEY) {
    return fallback();
  }

  try {
    const response =
      await postGemini({
        contents: [
          {
            role: 'user',
            parts: [
              {
                text:
                  buildPlannerPrompt({
                    command,
                    intent
                  })
              }
            ]
          }
        ],
        generationConfig: {
          temperature: 0,
          responseMimeType:
            'application/json',
          responseSchema:
            QUERY_SCHEMA
        }
      });

    const text =
      extractText(response);

    if (!text) {
      throw new Error(
        'Gemini Query Planner returned no content.'
      );
    }

    return normalizePlan(
      JSON.parse(text),
      intent
    );
  } catch (error) {
    console.error(
      `⚠️ Gemini Query Planner failed: ${error.message}`
    );

    return fallback();
  }
}

module.exports = {
  createQueryPlan,
  normalizePlan,
  buildDeterministicPlan,
  buildBaseFilters: baseFilters,
  canonicalAction,
  canonicalField,
  logicalField
};
