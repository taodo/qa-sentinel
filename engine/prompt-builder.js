const fs = require('fs');
const path = require('path');

const ROOT = path.join(
  __dirname,
  '..'
);

const SYSTEM_CONTEXT_FILE = path.join(
  ROOT,
  'ai',
  'qa-sentinel-context.md'
);

const KNOWLEDGE_FILE = path.join(
  ROOT,
  'knowledge',
  'qa-sentinel-knowledge.json'
);

const AI_INPUT_FILE = path.join(
  ROOT,
  'reports',
  'ai',
  'ai-review-input-latest.json'
);

const OUTPUT_DIRECTORY = path.join(
  ROOT,
  'reports',
  'ai'
);

const LATEST_OUTPUT_FILE = path.join(
  OUTPUT_DIRECTORY,
  'ai-prompt-latest.md'
);


/*
 * ============================================================
 * REQUIRED OVERALL METRICS
 * ============================================================
 *
 * These are the six major monitors that must appear
 * in the AI Review output metrics array.
 *
 * The actual values come from:
 *
 *   aiInput.overallMetrics
 *
 * AI must NOT calculate these values itself.
 */
const REQUIRED_METRICS = [
  {
    monitor: 'Spin',
    slug: 'spin_event',
    metric: 'total_spins'
  },
  {
    monitor: 'Purchase',
    slug: 'purchase_response',
    metric: 'total_responses'
  },
  {
    monitor: 'Signup',
    slug: 'signup',
    metric: 'total_signups'
  },
  {
    monitor: 'Login',
    slug: 'login',
    metric: 'total_logins'
  },
  {
    monitor: 'Redemption',
    slug: 'redemption',
    metric: 'total_events'
  },
  {
    monitor: 'Quest',
    slug: 'quest',
    metric: 'completed_quests'
  }
];


function assertFileExists(
  filePath,
  label
) {
  if (!fs.existsSync(filePath)) {
    throw new Error(
      `${label} not found: ${filePath}`
    );
  }
}


function ensureOutputDirectory() {
  fs.mkdirSync(
    OUTPUT_DIRECTORY,
    {
      recursive: true
    }
  );
}


function readTextFile(filePath) {
  return fs
    .readFileSync(
      filePath,
      'utf8'
    )
    .trim();
}


function readJsonFile(filePath) {
  const raw =
    readTextFile(filePath);

  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `Invalid JSON in ${filePath}: ` +
      error.message
    );
  }
}


function createTimestamp() {
  return new Date()
    .toISOString()
    .replace(/[:.]/g, '-');
}


function formatDateInTimezone(
  date,
  timeZone
) {
  try {
    return new Intl.DateTimeFormat(
      'en-GB',
      {
        timeZone,
        dateStyle: 'medium',
        timeStyle: 'long'
      }
    ).format(date);
  } catch (error) {
    return date.toISOString();
  }
}


function normalizeText(value) {
  if (
    value === null ||
    value === undefined
  ) {
    return '';
  }

  return String(value)
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .trim();
}


function escapeMarkdownTableCell(value) {
  return normalizeText(value)
    .replace(/\|/g, '\\|')
    .replace(/\n/g, '<br>');
}


function buildMarkdownTable(
  headers,
  records
) {
  if (
    !Array.isArray(headers) ||
    headers.length === 0
  ) {
    return '_No headers configured._';
  }

  if (
    !Array.isArray(records) ||
    records.length === 0
  ) {
    return '_No knowledge records configured._';
  }

  const safeHeaders =
    headers.map(
      escapeMarkdownTableCell
    );

  const headerLine =
    `| ${safeHeaders.join(' | ')} |`;

  const separatorLine =
    `| ${safeHeaders
      .map(() => '---')
      .join(' | ')} |`;

  const dataLines =
    records.map(record => {
      const values =
        headers.map(header =>
          escapeMarkdownTableCell(
            record?.[header]
          )
        );

      return `| ${values.join(' | ')} |`;
    });

  return [
    headerLine,
    separatorLine,
    ...dataLines
  ].join('\n');
}


function validateKnowledge(knowledge) {
  if (
    !knowledge ||
    typeof knowledge !== 'object'
  ) {
    throw new Error(
      'Knowledge JSON must be an object.'
    );
  }

  if (!Array.isArray(knowledge.sheets)) {
    throw new Error(
      'Knowledge JSON must contain a "sheets" array.'
    );
  }

  if (knowledge.sheets.length === 0) {
    throw new Error(
      'Knowledge JSON contains no sheets.'
    );
  }
}


function validateAiInput(aiInput) {
  if (
    !aiInput ||
    typeof aiInput !== 'object'
  ) {
    throw new Error(
      'AI review input must be an object.'
    );
  }

  if (!aiInput.summary) {
    throw new Error(
      'AI review input does not contain summary.'
    );
  }

  if (!Array.isArray(aiInput.alerts)) {
    throw new Error(
      'AI review input does not contain an alerts array.'
    );
  }

  /*
   * Overall metrics are now mandatory.
   *
   * This prevents the AI prompt from silently falling
   * back to alert-level metrics.
   */
  if (!Array.isArray(aiInput.overallMetrics)) {
    throw new Error(
      'AI review input does not contain an overallMetrics array.'
    );
  }

  const metricByMonitor =
    new Map(
      aiInput.overallMetrics.map(
        metric => [
          String(
            metric?.monitor || ''
          ).toLowerCase(),
          metric
        ]
      )
    );

  const missingMonitors =
    REQUIRED_METRICS
      .filter(config =>
        !metricByMonitor.has(
          config.monitor.toLowerCase()
        )
      )
      .map(
        config => config.monitor
      );

  if (missingMonitors.length > 0) {
    throw new Error(
      'AI review input is missing required overall metrics: ' +
      missingMonitors.join(', ')
    );
  }
}


function buildExecutionContext(aiInput) {
  const parsedDate =
    aiInput.generatedAt
      ? new Date(aiInput.generatedAt)
      : new Date();

  const generatedAt =
    Number.isNaN(parsedDate.getTime())
      ? new Date()
      : parsedDate;

  const vietnamTime =
    formatDateInTimezone(
      generatedAt,
      'Asia/Ho_Chi_Minh'
    );

  const usEasternTime =
    formatDateInTimezone(
      generatedAt,
      'America/New_York'
    );

  const windowHours =
    aiInput.reviewPolicy?.windowHours ??
    'Unknown';

  const summary =
    aiInput.summary || {};

  const affectedMonitors =
    Array.isArray(
      summary.affectedMonitors
    )
      ? summary.affectedMonitors
      : [];

  const affectedProviders =
    Array.isArray(
      summary.affectedProviders
    )
      ? summary.affectedProviders
      : [];

  const affectedPlatforms =
    Array.isArray(
      summary.affectedPlatforms
    )
      ? summary.affectedPlatforms
      : [];

  return [
    '# EXECUTION CONTEXT',
    '',
    `- Input generated at UTC: ${generatedAt.toISOString()}`,
    `- Vietnam time: ${vietnamTime}`,
    `- US Eastern time: ${usEasternTime}`,
    `- Monitoring window: ${windowHours} hours`,
    `- Total alerts: ${summary.totalAlerts ?? 0}`,
    `- Critical alerts: ${summary.critical ?? 0}`,
    `- Warning alerts: ${summary.warning ?? 0}`,
    `- Attention alerts: ${summary.attention ?? 0}`,
    `- Affected monitors: ${
      affectedMonitors.length > 0
        ? affectedMonitors.join(', ')
        : 'None'
    }`,
    `- Affected providers: ${
      affectedProviders.length > 0
        ? affectedProviders.join(', ')
        : 'None'
    }`,
    `- Affected platforms: ${
      affectedPlatforms.length > 0
        ? affectedPlatforms.join(', ')
        : 'None'
    }`
  ].join('\n');
}


function buildKnowledgeSection(knowledge) {
  const parts = [
    '# PROJECT KNOWLEDGE BASE',
    '',
    'This knowledge is maintained by the QA team.',
    'Use it to interpret the current deterministic alerts.',
    ''
  ];

  for (const sheet of knowledge.sheets) {
    const sheetTitle =
      sheet.title ||
      sheet.sheetName ||
      'Untitled Knowledge Section';

    const description =
      normalizeText(
        sheet.description
      );

    const headers =
      Array.isArray(sheet.headers)
        ? sheet.headers
        : [];

    const records =
      Array.isArray(sheet.records)
        ? sheet.records
        : [];

    parts.push(
      `## ${sheetTitle}`,
      ''
    );

    if (description) {
      parts.push(
        description,
        ''
      );
    }

    parts.push(
      buildMarkdownTable(
        headers,
        records
      ),
      ''
    );
  }

  return parts
    .join('\n')
    .trim();
}


function buildCurrentMonitoringSection(
  aiInput
) {
  return [
    '# CURRENT MONITORING DATA',
    '',
    'The following data was generated by the deterministic QA Sentinel pipeline.',
    '',
    'IMPORTANT: The "overallMetrics" section is the authoritative source for the producer-facing metrics table.',
    '',
    'Do not modify, recalculate, aggregate, estimate, or invent metric values.',
    '',
    '```json',
    JSON.stringify(
      aiInput,
      null,
      2
    ),
    '```'
  ].join('\n');
}


function buildFinalInstructions() {
  return `
# FINAL REVIEW INSTRUCTIONS

Review the current monitoring data using the supplied system context and project knowledge.

Required behavior:

1. Correlate multiple monitors, providers, platforms, and metrics.
2. Consider absolute volume and \`volumeContext.lowVolume\`.
3. Consider the current US Eastern time and the configured low-traffic window.
4. Distinguish expected business errors from technical client errors.
5. Lower confidence for isolated low-volume percentage changes.
6. Do not invent missing facts or metrics.
7. Do not recalculate deterministic thresholds or severities.
8. Do not suppress deterministic CRITICAL alerts.
9. Use only classifications defined in the knowledge base.

# AUTHORITATIVE OVERALL METRICS

The \`overallMetrics\` array in the CURRENT MONITORING DATA is the authoritative source for the producer-facing Overall Metrics table.

This data has already been deterministically aggregated by the QA Sentinel pipeline.

You MUST NOT calculate these totals yourself.

You MUST NOT sum raw records yourself.

You MUST NOT select one alert row as a substitute for an overall monitor metric.

You MUST NOT use alert-level \`current\`, \`previous\`, \`yesterday\`, or \`twoDaysAgo\` values as the overall monitor metric.

You MUST copy the values from \`overallMetrics\` exactly.

The required monitors are exactly:

1. Spin
2. Purchase
3. Signup
4. Login
5. Redemption
6. Quest

Every one of these six monitors MUST have exactly one entry in the output \`metrics\` array.

Even if a monitor has no deterministic alerts, it MUST still appear in the \`metrics\` array because overall metrics are independent from alerts.

Client Error is NOT part of the six-monitor historical Overall Metrics table.

# METRICS SUMMARY

Return a \`metrics\` array in the JSON response.

The \`metrics\` array is used directly to build the producer-facing Slack summary table.

Rules for \`metrics\`:

- Output exactly six entries.
- Use exactly these monitor names:
  - \`Spin\`
  - \`Purchase\`
  - \`Signup\`
  - \`Login\`
  - \`Redemption\`
  - \`Quest\`
- Preserve this exact monitor order.
- Use the corresponding \`overallMetrics\` entry as the source.
- Copy \`current\` exactly from \`overallMetrics\`.
- Copy \`previous\` exactly from \`overallMetrics\`.
- Copy \`yesterday\` exactly from \`overallMetrics\`.
- Copy \`twoDaysAgo\` exactly from \`overallMetrics\`.
- Copy the \`metric\` name from \`overallMetrics\`.
- Do not recalculate or transform the values.
- Do not aggregate raw records.
- Do not average values.
- Do not select a representative alert.
- Do not replace a total with completed, failed, success, unique-user, percentage, or any other sub-metric unless that exact metric is the authoritative metric supplied by \`overallMetrics\`.
- If an authoritative source value is \`null\`, output \`null\`.
- Never convert a missing value into zero.
- \`assessment\` must be a short factual assessment only.
- Examples of acceptable assessments:
  - \`Stable\`
  - \`Healthy\`
  - \`Watch\`
  - \`Declining\`
  - \`Low volume\`
- Do not create a finding solely because an overall metric changed.
- Detailed interpretation belongs in \`findings\`.

# IMPORTANT DISTINCTION BETWEEN METRICS AND FINDINGS

The \`metrics\` array is a compact status snapshot.

The \`findings\` array is where detailed analysis belongs.

Do NOT duplicate the complete metrics table inside findings.

Do NOT repeat all six monitor totals in the executive summary.

Use findings only for meaningful signals that require attention, investigation, or action.

Avoid generic findings such as:

- "Everything looks normal."
- "All metrics are stable."
- "No issues detected."

Do not create a finding simply because a metric is higher or lower than another historical window.

A metric change becomes a finding only when the monitoring data and project knowledge provide a meaningful reason for attention.

# REQUIRED METRICS OBJECT

Each metric object MUST follow this structure:

{
  "monitor": "Spin",
  "metric": "total_spins",
  "current": 38338,
  "previous": 43679,
  "yesterday": 43551,
  "twoDaysAgo": 40558,
  "assessment": "Stable"
}

The values above are an example of the required structure only.

For the actual response, use the exact values supplied by \`overallMetrics\`.

# REQUIRED OUTPUT ORDER

The \`metrics\` array MUST follow this order:

[
  {
    "monitor": "Spin",
    ...
  },
  {
    "monitor": "Purchase",
    ...
  },
  {
    "monitor": "Signup",
    ...
  },
  {
    "monitor": "Login",
    ...
  },
  {
    "monitor": "Redemption",
    ...
  },
  {
    "monitor": "Quest",
    ...
  }
]

# OUTPUT JSON STRUCTURE

Return JSON using this top-level structure:

{
  "overallAssessment": {
    "severity": "use the severity defined by the existing system context",
    "classification": "supported classification",
    "confidence": 0,
    "shouldNotify": true,
    "summary": "short overall assessment"
  },
  "metrics": [
    {
      "monitor": "Spin",
      "metric": "total_spins",
      "current": 0,
      "previous": null,
      "yesterday": null,
      "twoDaysAgo": null,
      "assessment": "Stable"
    },
    {
      "monitor": "Purchase",
      "metric": "total_responses",
      "current": 0,
      "previous": null,
      "yesterday": null,
      "twoDaysAgo": null,
      "assessment": "Stable"
    },
    {
      "monitor": "Signup",
      "metric": "total_signups",
      "current": 0,
      "previous": null,
      "yesterday": null,
      "twoDaysAgo": null,
      "assessment": "Stable"
    },
    {
      "monitor": "Login",
      "metric": "total_logins",
      "current": 0,
      "previous": null,
      "yesterday": null,
      "twoDaysAgo": null,
      "assessment": "Stable"
    },
    {
      "monitor": "Redemption",
      "metric": "total_events",
      "current": 0,
      "previous": null,
      "yesterday": null,
      "twoDaysAgo": null,
      "assessment": "Stable"
    },
    {
      "monitor": "Quest",
      "metric": "completed_quests",
      "current": 0,
      "previous": null,
      "yesterday": null,
      "twoDaysAgo": null,
      "assessment": "Stable"
    }
  ],
  "findings": [],
  "globalRecommendations": []
}

The example numeric values above are placeholders.

The actual \`metrics\` values MUST come directly from \`overallMetrics\`.

The existing finding rules from the system context still apply.

10. Return valid JSON only.

Do not wrap the JSON response in a Markdown code block.

Do not include commentary before or after the JSON.
`;
}


function buildPrompt({
  systemContext,
  knowledge,
  aiInput
}) {
  const separator = [
    '',
    '---',
    ''
  ].join('\n');

  return [
    systemContext,
    buildExecutionContext(
      aiInput
    ),
    buildKnowledgeSection(
      knowledge
    ),
    buildCurrentMonitoringSection(
      aiInput
    ),
    buildFinalInstructions()
  ].join(separator);
}


function savePrompt(prompt) {
  ensureOutputDirectory();

  const timestamp =
    createTimestamp();

  const archivedOutputFile =
    path.join(
      OUTPUT_DIRECTORY,
      `ai-prompt-${timestamp}.md`
    );

  fs.writeFileSync(
    LATEST_OUTPUT_FILE,
    prompt,
    'utf8'
  );

  fs.writeFileSync(
    archivedOutputFile,
    prompt,
    'utf8'
  );

  return {
    latest:
      LATEST_OUTPUT_FILE,

    archived:
      archivedOutputFile
  };
}


function printSummary({
  prompt,
  knowledge,
  aiInput,
  outputPaths
}) {
  const sheetCount =
    knowledge.metadata?.sheetCount ??
    knowledge.sheets.length;

  const totalRecords =
    knowledge.metadata?.totalRecords ??
    knowledge.sheets.reduce(
      (sum, sheet) =>
        sum +
        (
          Array.isArray(sheet.records)
            ? sheet.records.length
            : 0
        ),
      0
    );

  console.log(
    '\n🧠 QA Sentinel Prompt Builder'
  );

  console.log(
    '✅ System context loaded'
  );

  console.log(
    `✅ Knowledge sheets loaded: ${sheetCount}`
  );

  console.log(
    `✅ Knowledge records loaded: ${totalRecords}`
  );

  console.log(
    `✅ Current alerts loaded: ` +
    `${aiInput.summary?.totalAlerts ?? 0}`
  );

  console.log(
    `✅ Overall metrics loaded: ` +
    `${aiInput.overallMetrics?.length ?? 0}`
  );

  console.log(
    `🎯 Required metrics: ` +
    `${REQUIRED_METRICS.length}`
  );

  console.log(
    `✅ Prompt characters: ${prompt.length}`
  );

  console.log(
    `📄 Latest prompt: ${outputPaths.latest}`
  );

  console.log(
    `📦 Archived prompt: ${outputPaths.archived}`
  );
}


function main() {
  assertFileExists(
    SYSTEM_CONTEXT_FILE,
    'System context file'
  );

  assertFileExists(
    KNOWLEDGE_FILE,
    'Knowledge JSON file'
  );

  assertFileExists(
    AI_INPUT_FILE,
    'AI review input file'
  );

  const systemContext =
    readTextFile(
      SYSTEM_CONTEXT_FILE
    );

  if (!systemContext) {
    throw new Error(
      `System context is empty: ` +
      SYSTEM_CONTEXT_FILE
    );
  }

  const knowledge =
    readJsonFile(
      KNOWLEDGE_FILE
    );

  validateKnowledge(
    knowledge
  );

  const aiInput =
    readJsonFile(
      AI_INPUT_FILE
    );

  validateAiInput(
    aiInput
  );

  const prompt =
    buildPrompt({
      systemContext,
      knowledge,
      aiInput
    });

  const outputPaths =
    savePrompt(prompt);

  printSummary({
    prompt,
    knowledge,
    aiInput,
    outputPaths
  });
}


try {
  main();
} catch (error) {
  console.error(
    `\n❌ Prompt Builder failed: ` +
    `${error.message}`
  );

  process.exit(1);
}