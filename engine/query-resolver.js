const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const QUERIES_DIR = path.join(ROOT, 'queries');
const RUNNER = path.join(ROOT, 'run-and-extract.js');
const FIELD_DICTIONARY_FILE = path.join(
  __dirname,
  'splunk-field-dictionary.json'
);
const BI_CATALOG_FILE = path.join(
  __dirname,
  'bi-event-catalog.js'
);

const DEFAULT_INDEX =
  process.env.SPLUNK_DEFAULT_INDEX || 'sweeps';

const ALLOWED_OPERATIONS = new Set([
  'records',
  'sum',
  'count',
  'exists',
  'latest',
  'values'
]);


const ACTION_ALIASES = { spin: 'spin_event', 'spin event': 'spin_event', purchase: 'purchase_response', 'purchase response': 'purchase_response', signin: 'login', 'sign in': 'login', signup: 'signup', 'sign up': 'signup', redeem: 'redemption', errors: 'client_error', error: 'client_error' };
const DEFAULT_RECORD_FIELDS = { spin_event: ['Payload.ClientPayload.time_stamp','Payload.ClientPayload.game_id','Payload.ClientPayload.game_provider_id','Payload.ClientPayload.client_type','Payload.ClientPayload.unit_name','Payload.ClientPayload.spin_type','Payload.ClientPayload.bet_amount','Payload.ClientPayload.win_amount','Payload.ClientPayload.win_type'] };
function canonicalAction(action) { const raw = String(action || '').trim().toLowerCase(); return ACTION_ALIASES[raw] || raw; }
function normalizeNaturalIntent(intent) {
  const normalized = { ...intent, action: canonicalAction(intent?.action), filters: Array.isArray(intent?.filters) ? intent.filters.map(filter => ({ ...filter })) : [], requested_fields: Array.isArray(intent?.requested_fields) ? [...intent.requested_fields] : [] };
  normalized.filters = normalized.filters.map(filter => { const next = { ...filter }; if (String(next.field || '').trim() === 'Payload.ClientPayload.action') next.value = canonicalAction(next.value); return next; });
  if (normalizeOperation(normalized.operation) === 'records' && normalized.requested_fields.length === 0 && DEFAULT_RECORD_FIELDS[normalized.action]) normalized.requested_fields = [...DEFAULT_RECORD_FIELDS[normalized.action]];
  return normalized;
}

const ALLOWED_FILTER_OPERATORS = new Set([
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

function readJson(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Required resolver file not found: ${filePath}`);
  }

  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function loadCatalog() {
  if (!fs.existsSync(BI_CATALOG_FILE)) {
    throw new Error(`BI Event Catalog not found: ${BI_CATALOG_FILE}`);
  }

  return require(BI_CATALOG_FILE);
}

function loadFieldDictionary() {
  const dictionary = readJson(FIELD_DICTIONARY_FILE);
  const fields = Array.isArray(dictionary.fields)
    ? dictionary.fields
    : [];

  return new Map(
    fields.map(item => [
      String(item.field).trim(),
      String(item.type || 'String').trim().toLowerCase()
    ])
  );
}

function canonicalField(field, catalog) {
  const raw = String(field || '').trim();
  if (!raw) return null;

  if (raw.startsWith(catalog.BI_FIELD_PREFIX)) {
    return raw;
  }

  const knownLogical = new Set([
    ...catalog.BI_COMMON_FIELDS,
    ...catalog.BI_EVENTS.flatMap(event => event.fields)
  ]);

  return knownLogical.has(raw)
    ? `${catalog.BI_FIELD_PREFIX}${raw}`
    : raw;
}

function logicalField(field, catalog) {
  return String(field || '')
    .replace(catalog.BI_FIELD_PREFIX, '');
}

function getEvent(catalog, action) {
  return catalog.BI_EVENTS.find(
    event => event.name === action
  ) || null;
}

function getKnownEventNames(catalog) {
  return new Set([
    ...(catalog.BI_ALL_EVENT_NAMES || []),
    ...catalog.BI_EVENTS.map(event => event.name)
  ]);
}

function getEventFields(catalog, action) {
  const event = getEvent(catalog, action);
  const common = catalog.BI_COMMON_FIELDS || [];
  const eventSpecific = event?.fields || [];

  return new Set([
    ...common,
    ...eventSpecific
  ]);
}

function normalizeOperation(operation) {
  const normalized = String(operation || 'records')
    .trim()
    .toLowerCase();

  return ALLOWED_OPERATIONS.has(normalized)
    ? normalized
    : 'records';
}

function normalizeTimeRange(timeRange) {
  if (!timeRange) {
    return {
      type: 'named',
      value: 'current'
    };
  }

  if (typeof timeRange === 'string') {
    return {
      type: 'named',
      value: timeRange.trim().toLowerCase()
    };
  }

  const type = String(timeRange.type || '').trim().toLowerCase();

  if (type === 'relative') {
    const amount = Number(timeRange.amount);
    const unit = String(timeRange.unit || '')
      .trim()
      .toLowerCase();

    if (!Number.isInteger(amount) || amount <= 0) {
      throw new Error('Invalid relative time range amount.');
    }

    if (!['minute', 'minutes', 'hour', 'hours', 'day', 'days', 'week', 'weeks'].includes(unit)) {
      throw new Error(`Unsupported relative time unit: ${unit || 'empty'}`);
    }

    return {
      type: 'relative',
      amount,
      unit
    };
  }

  if (type === 'named') {
    const value = String(timeRange.value || 'current')
      .trim()
      .toLowerCase();

    if (!['current', 'previous', 'yesterday', 'two_days_ago'].includes(value)) {
      throw new Error(`Unsupported named time range: ${value}`);
    }

    return {
      type: 'named',
      value
    };
  }

  throw new Error(`Unsupported time range type: ${type || 'empty'}`);
}

function timeRangeToRunnerArgs(timeRange) {
  const normalized = normalizeTimeRange(timeRange);

  if (normalized.type === 'relative') {
    return {
      windowName: `last_${normalized.amount}_${normalized.unit}`,
      rangeMode: 'default'
    };
  }

  if (
    normalized.value === 'yesterday' ||
    normalized.value === 'two_days_ago'
  ) {
    return {
      windowName: normalized.value,
      rangeMode: 'full_day'
    };
  }

  return {
    windowName: normalized.value,
    rangeMode: 'default'
  };
}

function quoteString(value) {
  const escaped = String(value)
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"');

  return `"${escaped}"`;
}

function quoteIndex(value) {
  return quoteString(value || DEFAULT_INDEX);
}

function isNumericField(field, fieldDictionary) {
  const type = fieldDictionary.get(field);
  return type === 'number' || type === 'integer';
}

function buildFieldTypeMap(catalog, fieldDictionary) {
  const types = new Map(fieldDictionary);

  const catalogFields = new Set([
    ...catalog.BI_COMMON_FIELDS,
    ...catalog.BI_EVENTS.flatMap(event => event.fields)
  ]);

  for (const logical of catalogFields) {
    const field = `${catalog.BI_FIELD_PREFIX}${logical}`;
    if (!types.has(field)) {
      /*
       * biEvents.ts establishes that the field exists, while the
       * legacy PDF dictionary supplies types where available.
       * Missing type metadata must not make a valid catalog field
       * unusable; treat it as String unless the dictionary says numeric.
       */
      types.set(field, 'string');
    }
  }

  return types;
}

function normalizeFilterValue(value) {
  if (Array.isArray(value)) {
    return value.map(item => String(item).trim()).filter(Boolean);
  }

  return String(value ?? '').trim();
}

function buildFilterExpression(filter, fieldDictionary, catalog) {
  const field = canonicalField(filter?.field, catalog);
  const operator = String(filter?.operator || 'equals')
    .trim()
    .toLowerCase();
  const value = normalizeFilterValue(filter?.value);

  if (!field || !ALLOWED_FILTER_OPERATORS.has(operator)) {
    throw new Error(`Unsupported filter: ${filter?.field || 'unknown'} ${operator}`);
  }

  if (Array.isArray(value)) {
    if (operator !== 'in') {
      throw new Error(`Array filter values require operator=in for ${field}.`);
    }

    const clauses = value.map(item =>
      isNumericField(field, fieldDictionary)
        ? `${field}=${item}`
        : `${field}=${quoteString(item)}`
    );

    return `(${clauses.join(' OR ')})`;
  }

  if (!value) {
    throw new Error(`Filter value is empty for ${field}.`);
  }

  const numeric = isNumericField(field, fieldDictionary);
  const scalar = numeric && /^-?\d+(\.\d+)?$/.test(value)
    ? value
    : quoteString(value);

  switch (operator) {
    case 'equals':
      return `${field}=${scalar}`;
    case 'not_equals':
      return `NOT ${field}=${scalar}`;
    case 'contains':
      return `${field}=${quoteString(`*${value}*`)}`;
    case 'not_contains':
      return `NOT ${field}=${quoteString(`*${value}*`)}`;
    case 'gt':
      return `${field}>${scalar}`;
    case 'gte':
      return `${field}>=${scalar}`;
    case 'lt':
      return `${field}<${scalar}`;
    case 'lte':
      return `${field}<=${scalar}`;
    case 'in': {
      const values = value
        .split(',')
        .map(item => item.trim())
        .filter(Boolean);

      if (values.length === 0) {
        throw new Error(`Filter value is empty for ${field}.`);
      }

      return `(${values.map(item =>
        numeric && /^-?\d+(\.\d+)?$/.test(item)
          ? `${field}=${item}`
          : `${field}=${quoteString(item)}`
      ).join(' OR ')})`;
    }
    default:
      throw new Error(`Unsupported filter operator: ${operator}`);
  }
}

function validateIntent(intent) {
  const catalog = loadCatalog();
  const fieldDictionary = buildFieldTypeMap(
    catalog,
    loadFieldDictionary()
  );
  const knownEvents = getKnownEventNames(catalog);

  if (!intent || intent.understood !== true) {
    throw new Error('The natural query intent is not understood.');
  }

  const action = String(intent.action || '').trim();
  if (!action || !knownEvents.has(action)) {
    throw new Error(`Unknown BI event/action: ${action || 'empty'}`);
  }

  const eventFields = getEventFields(catalog, action);
  const unresolved = Array.isArray(intent.unresolved_terms)
    ? intent.unresolved_terms.filter(Boolean)
    : [];

  if (unresolved.length > 0) {
    throw new Error(
      `I need clarification before querying: ${unresolved.join(', ')}`
    );
  }

  const filters = Array.isArray(intent.filters)
    ? intent.filters
    : [];

  const requestedFields = Array.isArray(intent.requested_fields)
    ? intent.requested_fields
    : [];

  for (const filter of filters) {
    const field = canonicalField(filter?.field, catalog);
    const logical = logicalField(field, catalog);

    if (!fieldDictionary.has(field)) {
      throw new Error(`Unknown Splunk field: ${field || 'empty'}`);
    }

    if (!eventFields.has(logical)) {
      throw new Error(
        `Field ${field} is not documented for action ${action}.`
      );
    }
  }

  for (const requested of requestedFields) {
    const field = canonicalField(requested, catalog);
    const logical = logicalField(field, catalog);

    if (!fieldDictionary.has(field)) {
      throw new Error(`Unknown requested field: ${field || 'empty'}`);
    }

    if (!eventFields.has(logical)) {
      throw new Error(
        `Requested field ${field} is not documented for action ${action}.`
      );
    }
  }

  const operation = normalizeOperation(intent.operation);

  if (operation === 'sum') {
    if (requestedFields.length === 0) {
      throw new Error('A sum query requires at least one requested numeric field.');
    }

    for (const requested of requestedFields) {
      const field = canonicalField(requested, catalog);
      if (!isNumericField(field, fieldDictionary)) {
        throw new Error(`Cannot sum non-numeric field: ${field}`);
      }
    }
  }

  if (
    ['latest', 'values'].includes(operation) &&
    requestedFields.length === 0
  ) {
    throw new Error(`${operation} query requires at least one requested field.`);
  }

  if (operation === 'records' && requestedFields.length === 0) {
    throw new Error('A records query requires requested_fields.');
  }

  return {
    catalog,
    fieldDictionary,
    action,
    operation,
    filters,
    requestedFields: requestedFields.map(field =>
      canonicalField(field, catalog)
    )
  };
}

function buildSplQuery(intent) {
  const validated = validateIntent(intent);
  const {
    catalog,
    fieldDictionary,
    action,
    operation,
    filters,
    requestedFields
  } = validated;

  const clauses = [
    `index=${quoteIndex(DEFAULT_INDEX)}`,
    `Payload.ClientPayload.action=${quoteString(action)}`
  ];

  for (const filter of filters) {
    const field = canonicalField(filter.field, catalog);

    // The action is already constrained above.
    if (logicalField(field, catalog) === 'action') {
      continue;
    }

    clauses.push(
      buildFilterExpression(
        filter,
        fieldDictionary,
        catalog
      )
    );
  }

  let body;

  if (operation === 'sum') {
    const expressions = requestedFields.map(field =>
      `sum(${field}) as ${field}`
    );

    body = `| stats ${expressions.join(', ')}`;
  } else if (operation === 'count') {
    body = '| stats count as matching_events';
  } else if (operation === 'exists') {
    const expressions = [
      'count as matching_events',
      ...requestedFields.map(field =>
        `values(${field}) as ${field}`
      )
    ];

    body = `| stats ${expressions.join(', ')}`;
  } else if (operation === 'latest') {
    const expressions = requestedFields.map(field =>
      `latest(${field}) as ${field}`
    );

    body = `| stats ${expressions.join(', ')}`;
  } else if (operation === 'values') {
    const expressions = requestedFields.map(field =>
      `values(${field}) as ${field}`
    );

    body = `| stats ${expressions.join(', ')}`;
  } else {
    body = `| table ${requestedFields.join(' ')}`;
  }

  return [
    clauses.join(' '),
    body
  ].join('\n');
}

function createQueryFile(query) {
  fs.mkdirSync(QUERIES_DIR, { recursive: true });

  const queryName =
    `__natural_query_${Date.now()}_${process.pid}`;
  const queryFile = path.join(
    QUERIES_DIR,
    `${queryName}.spl`
  );

  fs.writeFileSync(
    queryFile,
    query,
    'utf8'
  );

  return {
    queryName,
    queryFile
  };
}

function runExistingSplunkRunner({ queryName, windowName, rangeMode }) {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(RUNNER)) {
      reject(new Error(`Existing Splunk runner not found: ${RUNNER}`));
      return;
    }

    const child = spawn(
      process.execPath,
      [RUNNER, queryName, windowName, '', 'natural_query'],
      {
        cwd: ROOT,
        env: process.env,
        stdio: ['ignore', 'pipe', 'pipe']
      }
    );

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', chunk => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', chunk => {
      stderr += chunk.toString();
    });

    child.on('error', reject);

    child.on('close', code => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }

      const details = [
        `exit code ${code}`,
        stderr.trim(),
        stdout.trim()
      ].filter(Boolean).join('\n');

      reject(
        new Error(
          `Splunk runner failed: ${details}`
        )
      );
    });
  });
}

function getLatestRawPath(queryName, windowName) {
  return path.join(
    ROOT,
    'reports',
    'raw',
    `${queryName}-${windowName}.json`
  );
}

function readRunnerRecords(queryName, windowName) {
  const rawPath = getLatestRawPath(queryName, windowName);

  if (!fs.existsSync(rawPath)) {
    throw new Error(`Splunk result file not found: ${rawPath}`);
  }

  const raw = JSON.parse(
    fs.readFileSync(rawPath, 'utf8')
  );

  const records = Array.isArray(raw)
    ? raw
    : Array.isArray(raw.records)
      ? raw.records
      : [];

  return {
    raw,
    records,
    rawPath
  };
}

function getRecordFieldValue(record, field) {
  if (!record || !field) return undefined;
  if (Object.prototype.hasOwnProperty.call(record, field)) return record[field];
  const raw = String(field).trim();
  const normalized = raw.toLowerCase();
  if (Object.prototype.hasOwnProperty.call(record, normalized)) return record[normalized];
  const logical = normalized.startsWith('payload.clientpayload.') ? normalized.slice('payload.clientpayload.'.length) : normalized;
  if (Object.prototype.hasOwnProperty.call(record, logical)) return record[logical];
  for (const [key, value] of Object.entries(record)) {
    const keyNorm = String(key).trim().toLowerCase();
    if (keyNorm === logical || keyNorm === normalized || keyNorm.endsWith('.' + logical)) return value;
  }
  return undefined;
}

function normalizeDisplayValue(value) {
  if (value === null || value === undefined || value === '') {
    return '—';
  }

  return String(value)
    .replace(/\s+/g, ' ')
    .trim();
}

function formatNumber(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return normalizeDisplayValue(value);
  }

  return numeric.toLocaleString('en-US', {
    maximumFractionDigits: 6
  });
}

function formatResult({ intent, records, timeRange }) {
  const operation = normalizeOperation(intent.operation);
  const requestedFields = Array.isArray(intent.requested_fields)
    ? intent.requested_fields
    : [];

  const header = [
    '🔎 *QA Sentinel — Natural Query Result*',
    '',
    `*Action:* ${intent.action || '—'}`,
    `*Player:* ${intent.subject?.player_id ?? '—'}`,
    `*Game:* ${intent.scope?.game_id || intent.scope?.game_name || '—'}`,
    `*Unit:* ${intent.scope?.unit_name || '—'}`,
    `*Time:* ${formatTimeRangeForResult(timeRange)}`,
    `*Operation:* ${operation}`,
    ''
  ];

  if (records.length === 0) {
    return {
      text: `${header.join('\n')}⚪ No matching events found.`,
      naturalQuery: true,
      queryResult: true,
      intent,
      records: []
    };
  }

  if (operation === 'exists') {
    const count = Number(records[0].matching_events || 0);
    const yesNo = count > 0 ? 'Yes' : 'No';
    const lines = [
      ...header,
      `*Found:* ${yesNo} — ${formatNumber(count)} matching event(s).`
    ];

    for (const field of requestedFields) {
      const logical = field.includes('.')
        ? field.split('.').pop()
        : field;
      lines.push(
        `• *${logical}:* ${normalizeDisplayValue(getRecordFieldValue(records[0], field))}`
      );
    }

    return {
      text: lines.join('\n'),
      naturalQuery: true,
      queryResult: true,
      intent,
      records
    };
  }

  if (operation === 'sum') {
    const lines = [...header];
    for (const field of requestedFields) {
      const logical = field.includes('.')
        ? field.split('.').pop()
        : field;
      lines.push(
        `*${logical}:* ${formatNumber(getRecordFieldValue(records[0], field))}`
      );
    }

    return {
      text: lines.join('\n'),
      naturalQuery: true,
      queryResult: true,
      intent,
      records
    };
  }

  if (operation === 'count') {
    return {
      text: `${header.join('\n')}*Matching events:* ${formatNumber(records[0].matching_events)}`,
      naturalQuery: true,
      queryResult: true,
      intent,
      records
    };
  }

  if (operation === 'latest' || operation === 'values') {
    const lines = [...header];

    for (const field of requestedFields) {
      const logical = field.includes('.')
        ? field.split('.').pop()
        : field;
      lines.push(
        `*${logical}:* ${normalizeDisplayValue(getRecordFieldValue(records[0], field))}`
      );
    }

    return {
      text: lines.join('\n'),
      naturalQuery: true,
      queryResult: true,
      intent,
      records
    };
  }

  const visibleRecords = records.slice(0, 25);
  const columns = requestedFields.map(field =>
    field.includes('.') ? field.split('.').pop() : field
  );

  const lines = [
    ...header,
    `*Rows:* ${formatNumber(records.length)}${records.length > 25 ? ' (showing first 25)' : ''}`,
    '',
    `| ${columns.join(' | ')} |`,
    `| ${columns.map(() => '---').join(' | ')} |`
  ];

  for (const record of visibleRecords) {
    lines.push(
      `| ${requestedFields.map(field =>
        normalizeDisplayValue(getRecordFieldValue(record, field)).replace(/\|/g, '\\|')
      ).join(' | ')} |`
    );
  }

  return {
    text: lines.join('\n'),
    naturalQuery: true,
    queryResult: true,
    intent,
    records
  };
}

function formatTimeRangeForResult(timeRange) {
  if (!timeRange) return 'current';

  if (timeRange.type === 'relative') {
    return `last ${timeRange.amount} ${timeRange.unit}`;
  }

  const labels = {
    current: 'current',
    previous: 'previous hour',
    yesterday: 'yesterday',
    two_days_ago: 'two days ago'
  };

  return labels[timeRange.value] || timeRange.value || 'current';
}

async function resolveNaturalQuery(intent) {
  const normalizedIntent = normalizeNaturalIntent(intent);
  const validated = validateIntent(normalizedIntent);
  const timeRange = normalizeTimeRange(intent.time_range);
  const runnerWindow = timeRangeToRunnerArgs(timeRange);
  const spl = buildSplQuery(normalizedIntent);
  const queryFileInfo = createQueryFile(spl);

  console.log('🔎 Natural Query Resolver');
  console.log(`Action: ${validated.action}`);
  console.log(`Operation: ${validated.operation}`);
  console.log(`Window: ${runnerWindow.windowName}`);
  console.log('Generated SPL:');
  console.log(spl);

  try {
    await runExistingSplunkRunner({
      queryName: queryFileInfo.queryName,
      windowName: runnerWindow.windowName,
      rangeMode: runnerWindow.rangeMode
    });

    const result = readRunnerRecords(
      queryFileInfo.queryName,
      runnerWindow.windowName
    );

    return formatResult({
      intent: normalizedIntent,
      records: result.records,
      timeRange
    });
  } finally {
    try {
      fs.unlinkSync(queryFileInfo.queryFile);
    } catch (error) {
      /* Keep runner output for audit/debug; only remove the temporary .spl. */
    }
  }
}

module.exports = {
  resolveNaturalQuery,
  buildSplQuery,
  validateIntent,
  normalizeTimeRange,
  timeRangeToRunnerArgs,
  formatResult
};
