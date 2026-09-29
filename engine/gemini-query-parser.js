const fs = require('fs');
const path = require('path');
const https = require('https');

try {
  require('dotenv').config({
    path: path.join(__dirname, '..', '.env')
  });
} catch (error) {
  /* dotenv is optional for parser-only unit tests. */
}

const ROOT = path.join(__dirname, '..');
const QUERY_PROFILES_FILE = path.join(
  __dirname,
  'query-profiles.json'
);
const BI_EVENT_CATALOG_FILE = path.join(
  __dirname,
  'bi-event-catalog.js'
);

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL =
  process.env.GEMINI_MODEL ||
  'gemini-3.5-flash-lite';

function readJson(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Required query knowledge file not found: ${filePath}`);
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function buildKnowledge() {
  if (!fs.existsSync(BI_EVENT_CATALOG_FILE)) {
    throw new Error(`Required BI event catalog not found: ${BI_EVENT_CATALOG_FILE}`);
  }

  const catalog = require(BI_EVENT_CATALOG_FILE);
  const profiles = readJson(QUERY_PROFILES_FILE);

  const fieldDictionary = [
    ...catalog.BI_COMMON_FIELDS,
    ...catalog.BI_EVENTS.flatMap(event => event.fields)
  ]
    .filter((field, index, array) => array.indexOf(field) === index)
    .map(field => ({
      field: `${catalog.BI_FIELD_PREFIX}${field}`,
      logical_name: field
    }));

  return {
    field_dictionary: fieldDictionary,
    top_level_fields: catalog.BI_TOP_LEVEL_FIELDS,
    field_prefix: catalog.BI_FIELD_PREFIX,
    flows: catalog.BI_FLOWS,
    events: catalog.BI_EVENTS,
    all_event_names: catalog.BI_ALL_EVENT_NAMES,
    profiles: profiles.profiles || {}
  };
}

const GEMINI_QUERY_SCHEMA = {
  type: 'OBJECT',
  properties: {
    understood: {
      type: 'BOOLEAN'
    },
    query_type: {
      type: 'STRING'
    },
    operation: {
      type: 'STRING'
    },
    action: {
      type: 'STRING',
      nullable: true
    },
    subject: {
      type: 'OBJECT',
      properties: {
        player_id: {
          type: 'INTEGER',
          nullable: true
        }
      },
      required: []
    },
    scope: {
      type: 'OBJECT',
      properties: {
        game_id: {
          type: 'STRING',
          nullable: true
        },
        game_name: {
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
        unit_name: {
          type: 'STRING',
          nullable: true
        },
        provider: {
          type: 'STRING',
          nullable: true
        }
      },
      required: []
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
        required: ['field', 'operator', 'value']
      }
    },
    requested_fields: {
      type: 'ARRAY',
      items: {
        type: 'STRING'
      }
    },
    time_range: {
      type: 'OBJECT',
      properties: {
        type: {
          type: 'STRING'
        },
        amount: {
          type: 'NUMBER',
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
      },
      required: ['type']
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
        required: ['term', 'mapped_to', 'reason']
      }
    }
  },
  required: [
    'understood',
    'query_type',
    'operation',
    'action',
    'subject',
    'scope',
    'filters',
    'requested_fields',
    'time_range',
    'unresolved_terms',
    'interpretation'
  ]
};

function postJson({ hostname, pathName, body, headers }) {
  return new Promise((resolve, reject) => {
    const request = https.request(
      {
        hostname,
        path: pathName,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...headers
        }
      },
      response => {
        let responseBody = '';

        response.setEncoding('utf8');
        response.on('data', chunk => {
          responseBody += chunk;
        });
        response.on('end', () => {
          resolve({
            statusCode: response.statusCode || 0,
            body: responseBody
          });
        });
      }
    );

    request.on('error', reject);
    request.write(JSON.stringify(body));
    request.end();
  });
}

function extractResponseText(data) {
  return data?.candidates
    ?.flatMap(candidate => candidate.content?.parts || [])
    ?.map(part => part.text)
    ?.filter(Boolean)
    ?.join('') || null;
}

function getBiCatalog() {
  if (!fs.existsSync(BI_EVENT_CATALOG_FILE)) {
    throw new Error(`Required BI event catalog not found: ${BI_EVENT_CATALOG_FILE}`);
  }
  return require(BI_EVENT_CATALOG_FILE);
}

function normalizeCatalogField(field) {
  const catalog = getBiCatalog();
  const raw = String(field || '').trim();
  if (!raw) return null;

  if (
    raw.startsWith(catalog.BI_FIELD_PREFIX)
  ) {
    return raw;
  }

  const knownLogical = new Set([
    ...catalog.BI_COMMON_FIELDS,
    ...catalog.BI_EVENTS.flatMap(event => event.fields)
  ]);

  if (knownLogical.has(raw)) {
    return `${catalog.BI_FIELD_PREFIX}${raw}`;
  }

  return raw;
}

function normalizeCatalogIntent(intent) {
  const catalog = getBiCatalog();
  const action = String(intent?.action || '').trim();
  const event = catalog.BI_EVENTS.find(
    item => item.name === action
  );

  const normalized = {
    ...intent,
    action: action || null,
    filters: Array.isArray(intent?.filters)
      ? intent.filters.map(filter => ({
          ...filter,
          field: normalizeCatalogField(filter?.field)
        }))
      : [],
    requested_fields: Array.isArray(intent?.requested_fields)
      ? intent.requested_fields
          .map(normalizeCatalogField)
          .filter(Boolean)
      : []
  };

  /*
   * Catalog-backed semantic guard for spin units:
   * "sweep" / "gold" are unit_name values, while spin_type is
   * regular/free_spin/buy_bonus. This prevents the model from
   * turning a unit term into an incompatible spin_type filter.
   */
  if (event?.name === 'spin_event') {
    normalized.filters = normalized.filters.map(filter => {
      const logicalField = String(filter.field || '')
        .replace(catalog.BI_FIELD_PREFIX, '');
      const value = String(filter.value || '').trim().toLowerCase();

      if (
        logicalField === 'spin_type' &&
        (value === 'sweep' || value === 'gold')
      ) {
        return {
          ...filter,
          field: `${catalog.BI_FIELD_PREFIX}unit_name`
        };
      }

      return filter;
    });
  }

  /* Keep the human-readable scope/subject synchronized with filters. */
  const nextSubject = {
    ...(normalized.subject || {})
  };
  const nextScope = {
    ...(normalized.scope || {})
  };

  normalized.filters.forEach(filter => {
    const logicalField = String(filter.field || '')
      .replace(catalog.BI_FIELD_PREFIX, '');
    const value = filter.value;

    if (logicalField === 'game_user_id' && nextSubject.player_id == null) {
      const numeric = Number(value);
      nextSubject.player_id = Number.isFinite(numeric) ? numeric : value;
    }

    if (
      ['game_id', 'game_name', 'client_type', 'device_type', 'unit_name'].includes(logicalField) &&
      nextScope[logicalField] == null
    ) {
      nextScope[logicalField] = value;
    }

    if (logicalField === 'game_provider_id' && nextScope.provider == null) {
      nextScope.provider = value;
    }
  });

  normalized.subject = nextSubject;
  normalized.scope = nextScope;

  return normalized;
}

function inferNaturalOperation(command, intent) {
  const text = String(command || '')
    .trim()
    .toLowerCase();

  const current = String(intent?.operation || '')
    .trim()
    .toLowerCase();

  /*
   * Gemini is the semantic interpreter, but operation selection is
   * execution-critical. Keep a deterministic safety net for clear
   * natural-language patterns so a numeric question cannot silently
   * degrade into a raw-record query.
   */
  if (
    /\bhow much\b/.test(text) ||
    /\btotal\b.*\b(bet|win|won|spend|redeem)\b/.test(text)
  ) {
    return 'sum';
  }

  if (
    /\b(did|has|have)\b/.test(text) &&
    /\b(any|anything|purchase|purchases|redemption|redemptions)\b/.test(text)
  ) {
    return 'exists';
  }

  if (
    /\bhow many\b/.test(text) ||
    /\b(number of)\b/.test(text)
  ) {
    return 'count';
  }

  if (
    /\b(latest|most recent|current)\b/.test(text)
  ) {
    return 'latest';
  }

  if (
    /\bwhich\b/.test(text) ||
    /\bwhat .* (types?|values?)\b/.test(text)
  ) {
    return 'values';
  }

  return current || 'records';
}

function normalizeRequestedFieldsForClearMetric(command, intent) {
  const text = String(command || '')
    .trim()
    .toLowerCase();

  const action = String(intent?.action || '')
    .trim()
    .toLowerCase();

  const requested = Array.isArray(intent?.requested_fields)
    ? intent.requested_fields
    : [];

  if (action !== 'spin_event' || requested.length <= 1) {
    return requested;
  }

  const preferred =
    /\bhow much\b.*\b(bet|wager)\b/.test(text)
      ? 'bet_amount'
      : /\bhow much\b.*\b(win|won)\b/.test(text)
        ? 'win_amount'
        : null;

  if (!preferred) {
    return requested;
  }

  const catalog = getBiCatalog();
  const preferredField = `${catalog.BI_FIELD_PREFIX}${preferred}`;
  const match = requested.find(field =>
    String(field || '').trim() === preferredField
  );

  return match ? [match] : requested;
}

function normalizeIntent(intent, command = '') {
  const normalized = {
    understood: intent?.understood === true,
    query_type: intent?.query_type || 'data_query',
    operation: intent?.operation || 'records',
    action: intent?.action || null,
    subject: intent?.subject || {},
    scope: intent?.scope || {},
    filters: Array.isArray(intent?.filters)
      ? intent.filters
      : [],
    requested_fields: Array.isArray(intent?.requested_fields)
      ? intent.requested_fields
      : [],
    time_range: intent?.time_range || {
      type: 'named',
      value: 'current',
      amount: null,
      unit: null
    },
    unresolved_terms: Array.isArray(intent?.unresolved_terms)
      ? intent.unresolved_terms
      : [],
    interpretation: Array.isArray(intent?.interpretation)
      ? intent.interpretation
      : []
  };

  normalized.operation =
    inferNaturalOperation(command, normalized);

  normalized.requested_fields =
    normalizeRequestedFieldsForClearMetric(
      command,
      normalized
    );

  let catalogNormalized =
    normalizeCatalogIntent(normalized);

  /*
   * BI catalog semantic mapping:
   * For spin_event, natural wording "game <X>" refers to the
   * event-specific game_id. Keep game_name only when the user
   * explicitly asks for "game name".
   */
  const text = String(command || '').toLowerCase();
  const explicitGameName =
    /\\bgame\\s+name\\b/.test(text);

  if (
    catalogNormalized.action === 'spin_event' &&
    !explicitGameName &&
    /\\bgame\\b/.test(text)
  ) {
    const gameNameFilter =
      catalogNormalized.filters.find(filter =>
        String(filter?.field || '')
          .endsWith('game_name')
      );

    if (gameNameFilter) {
      const gameIdField =
        `${getBiCatalog().BI_FIELD_PREFIX}game_id`;

      catalogNormalized = {
        ...catalogNormalized,
        filters: catalogNormalized.filters.map(filter =>
          filter === gameNameFilter
            ? {
                ...filter,
                field: gameIdField
              }
            : filter
        ),
        scope: {
          ...(catalogNormalized.scope || {}),
          game_id:
            catalogNormalized.scope?.game_id ??
            gameNameFilter.value
        }
      };

      if (
        catalogNormalized.scope?.game_name ===
        gameNameFilter.value
      ) {
        const nextScope = {
          ...(catalogNormalized.scope || {})
        };
        delete nextScope.game_name;
        catalogNormalized.scope = nextScope;
      }
    }
  }

  return catalogNormalized;
}

function buildPrompt({ command, conversationContext }) {
  const knowledge = buildKnowledge();

  return `
You are the Natural Language Query Parser for QA Sentinel.

Your job is to translate a user's natural-language Splunk investigation request into a SAFE structured query intent.

IMPORTANT ARCHITECTURE:
- You interpret intent only.
- You do NOT write SPL.
- You do NOT invent Splunk fields.
- The application will decide how to build and execute the actual Splunk query.
- The global field dictionary is authoritative for field names and types.
- Action profiles are semantic hints, NOT whitelists and NOT restrictions.
- If a request is outside a profile, still try to resolve it using the global dictionary and the meaning of the action.
- Only put a term in unresolved_terms when you genuinely cannot map it to a known field or action.

FILTERS vs REQUESTED FIELDS:
- filters = fields/values that constrain which events are selected.
- requested_fields = fields the user wants to inspect in the result.
- A field may appear in both when the user wants to filter and inspect it.

OPERATION:
- operation controls the deterministic result shape. Choose exactly one: records, sum, count, exists, latest, values.
- Use sum for questions such as "how much did he bet/win/spend/redeem" when the requested field is numeric.
- Use exists for yes/no questions such as "did he purchase anything" or "did he make a redemption".
- Use count when the user asks how many events/attempts/transactions occurred.
- Use latest when the user asks for the latest/current value or latest event field.
- Use values when the user asks which values occurred (for example, which device types or payment types).
- Use records when the user asks to inspect individual events/rows.

CONVERSATION CONTINUITY:
- The conversation context comes from the same Slack thread.
- Resolve pronouns and references such as "he", "that player", "same game", "that game", "same period", and "what about" against the previous context.
- New user-specified values override previous context.
- If the user changes player, use the new player.
- If the user changes game, use the new game.
- If the user only asks for another field, inherit the existing subject/scope/time/action when appropriate.
- Do not invent missing context.

PLAYER ID:
- A numeric player identifier should normally map to Payload.ClientPayload.game_user_id when the request is explicitly about the game player.
- Do not map it to a different player field unless the wording clearly indicates another identity.

TIME:
- Support natural relative ranges such as last 2 days, last 7 days, last 4 hours.
- "yesterday" means a calendar-day concept.
- If the user does not specify time, inherit the previous time range when appropriate; otherwise use current.

KNOWN KNOWLEDGE:
${JSON.stringify(knowledge, null, 2)}

PREVIOUS CONVERSATION CONTEXT:
${JSON.stringify(conversationContext || {}, null, 2)}

USER REQUEST:
${command}

Return ONLY JSON matching the provided response schema.
`;
}

async function parseNaturalQuery({ command, conversationContext = null }) {
  if (!GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY is not configured.');
  }

  const prompt = buildPrompt({
    command,
    conversationContext
  });

  const body = {
    contents: [
      {
        role: 'user',
        parts: [
          {
            text: prompt
          }
        ]
      }
    ],
    generationConfig: {
      temperature: 0,
      responseMimeType: 'application/json',
      responseSchema: GEMINI_QUERY_SCHEMA
    }
  };

  const response = await postJson({
    hostname: 'generativelanguage.googleapis.com',
    pathName:
      `/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`,
    body,
    headers: {}
  });

  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error(
      `Gemini query parser failed: HTTP ${response.statusCode} ${response.body}`
    );
  }

  const data = JSON.parse(response.body);
  const text = extractResponseText(data);

  if (!text) {
    throw new Error('Gemini query parser returned no structured content.');
  }

  return normalizeIntent(JSON.parse(text), command);
}

module.exports = {
  parseNaturalQuery,
  buildPrompt,
  buildKnowledge,
  normalizeIntent,
  GEMINI_QUERY_SCHEMA,
  GEMINI_MODEL
};
