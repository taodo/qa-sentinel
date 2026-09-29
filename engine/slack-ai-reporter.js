const fs = require('fs');
const path = require('path');

require('dotenv').config({
  path: path.join(__dirname, '..', '.env')
});

const {
  sendSlackMessage
} = require('./slack-notifier');

const ROOT = path.join(
  __dirname,
  '..'
);

const VALIDATED_REVIEW_FILE = path.join(
  ROOT,
  'reports',
  'ai',
  'validated-ai-review-latest.json'
);

const USAGE_SUMMARY_FILE = path.join(
  ROOT,
  'reports',
  'ai',
  'usage',
  'usage-summary-latest.json'
);

const OUTPUT_DIRECTORY = path.join(
  ROOT,
  'reports',
  'ai',
  'slack'
);

const LATEST_PAYLOAD_FILE = path.join(
  OUTPUT_DIRECTORY,
  'slack-ai-payload-latest.json'
);

const LAST_SENT_FILE = path.join(
  OUTPUT_DIRECTORY,
  'last-sent-ai-review.json'
);

const SLACK_WEBHOOK_ENV_KEY =
  'SLACK_WEBHOOK_AI_REVIEW';

const MAX_FINDINGS = 2;
const MAX_SLACK_BLOCKS = 50;


/*
 * ============================================================
 * REQUIRED OVERALL METRICS
 * ============================================================
 *
 * The AI Reviewer must return exactly these six monitors.
 *
 * Slack Reporter does NOT calculate these values.
 * It only renders review.metrics.
 */
const REQUIRED_METRICS = [
  {
    monitor: 'Spin',
    metric: 'total_spins'
  },
  {
    monitor: 'Purchase',
    metric: 'total_responses'
  },
  {
    monitor: 'Signup',
    metric: 'total_signups'
  },
  {
    monitor: 'Login',
    metric: 'total_logins'
  },
  {
    monitor: 'Redemption',
    metric: 'total_events'
  },
  {
    monitor: 'Quest',
    metric: 'completed_quests'
  }
];


function parseBoolean(
  value,
  defaultValue = false
) {
  if (value === undefined) {
    return defaultValue;
  }

  return String(value)
    .trim()
    .toLowerCase() === 'true';
}


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


function readJsonFile(
  filePath,
  fallbackValue = null
) {
  if (!fs.existsSync(filePath)) {
    return fallbackValue;
  }

  const raw = fs
    .readFileSync(
      filePath,
      'utf8'
    )
    .trim();

  if (!raw) {
    return fallbackValue;
  }

  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `Invalid JSON in ${filePath}: ${error.message}`
    );
  }
}


function writeJsonFile(
  filePath,
  data
) {
  fs.writeFileSync(
    filePath,
    JSON.stringify(
      data,
      null,
      2
    ),
    'utf8'
  );
}


function createTimestamp() {
  return new Date()
    .toISOString()
    .replace(/[:.]/g, '-');
}


function truncate(
  value,
  maxLength
) {
  const text =
    String(value || '')
      .trim();

  if (text.length <= maxLength) {
    return text;
  }

  return (
    text.slice(
      0,
      Math.max(
        0,
        maxLength - 1
      )
    ) +
    '…'
  );
}


function escapeSlackText(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .trim();
}


function formatNumber(value) {
  if (
    value === null ||
    value === undefined ||
    value === ''
  ) {
    return '-';
  }

  const number =
    Number(value);

  return Number.isFinite(number)
    ? number.toLocaleString('en-US')
    : '-';
}


function formatDuration(durationMs) {
  const milliseconds =
    Number(durationMs || 0);

  if (!Number.isFinite(milliseconds)) {
    return 'Unknown';
  }

  return `${(
    milliseconds / 1000
  ).toFixed(1)}s`;
}


function formatTime(
  dateValue,
  timeZone
) {
  const date =
    new Date(dateValue);

  if (
    Number.isNaN(
      date.getTime()
    )
  ) {
    return 'Unknown';
  }

  try {
    return new Intl.DateTimeFormat(
      'en-GB',
      {
        timeZone,
        dateStyle: 'medium',
        timeStyle: 'short'
      }
    ).format(date);
  } catch (error) {
    return date.toISOString();
  }
}


function severityEmoji(severity) {
  switch (
    String(severity || '')
      .trim()
      .toUpperCase()
  ) {
    case 'CRITICAL':
      return '🔴';

    case 'WARNING':
      return '🟠';

    case 'ATTENTION':
      return '🟡';

    default:
      return '⚪';
  }
}


function normalizeClassification(
  classification
) {
  return String(classification || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_');
}


function classificationEmoji(
  classification
) {
  switch (
    normalizeClassification(
      classification
    )
  ) {
    case 'provider_issue':
      return '🎰';

    case 'payment_issue':
      return '💳';

    case 'frontend_issue':
      return '🌐';

    case 'mobile_issue':
      return '📱';

    case 'backend_issue':
      return '🖥️';

    case 'analytics_delay':
      return '📊';

    case 'splunk_delay':
      return '🔍';

    case 'low_traffic_noise':
      return '🌙';

    case 'broad_incident':
      return '🚨';

    case 'normal_variation':
      return '✅';

    default:
      return '❓';
  }
}


function classificationLabel(
  classification
) {
  const normalized =
    normalizeClassification(
      classification
    );

  if (
    !normalized ||
    normalized === 'unknown'
  ) {
    return 'Under Investigation';
  }

  return normalized
    .replace(/_/g, ' ')
    .replace(
      /\b\w/g,
      character =>
        character.toUpperCase()
    );
}


function formatMonitorName(value) {
  return String(
    value ||
    'Unknown monitor'
  )
    .split(',')
    .map(item =>
      item.trim()
    )
    .filter(Boolean)
    .map(item =>
      item
        .replace(/_/g, ' ')
        .replace(
          /\b\w/g,
          character =>
            character.toUpperCase()
        )
    )
    .join(' / ');
}


function formatBulletList(
  items,
  maxLength = 180
) {
  if (
    !Array.isArray(items) ||
    items.length === 0
  ) {
    return '_None provided._';
  }

  return items
    .filter(Boolean)
    .map(item =>
      `• ${escapeSlackText(
        truncate(
          item,
          maxLength
        )
      )}`
    )
    .join('\n');
}


/*
 * ============================================================
 * METRICS TABLE
 * ============================================================
 */

function metricAssessmentEmoji(
  assessment
) {
  switch (
    String(assessment || '')
      .trim()
      .toLowerCase()
  ) {
    case 'healthy':
    case 'stable':
      return '🟢';

    case 'watch':
    case 'declining':
      return '🟡';

    case 'critical':
      return '🔴';

    case 'warning':
      return '🟠';

    default:
      return '⚪';
  }
}


function metricMonitorIcon(
  monitor
) {
  const normalized =
    String(monitor || '')
      .trim()
      .toLowerCase()
      .replace(/_/g, ' ');

  if (
    normalized.includes('spin')
  ) {
    return '🎰';
  }

  if (
    normalized.includes('purchase')
  ) {
    return '💳';
  }

  if (
    normalized.includes('signup') ||
    normalized.includes('sign up')
  ) {
    return '📝';
  }

  if (
    normalized.includes('login') ||
    normalized.includes('signin')
  ) {
    return '🔐';
  }

  if (
    normalized.includes('redemption') ||
    normalized.includes('redeem')
  ) {
    return '💰';
  }

  if (
    normalized.includes('quest')
  ) {
    return '🎯';
  }

  return '📊';
}


function formatMetricValue(
  value
) {
  if (
    value === null ||
    value === undefined ||
    value === ''
  ) {
    return '-';
  }

  return formatNumber(value);
}


function normalizeMetrics(
  metrics
) {
  if (!Array.isArray(metrics)) {
    return [];
  }

  const metricMap =
    new Map();

  for (const metric of metrics) {
    const key =
      String(
        metric?.monitor || ''
      )
        .trim()
        .toLowerCase();

    if (!key) {
      continue;
    }

    metricMap.set(
      key,
      metric
    );
  }

  /*
   * Always render the six required monitors
   * in a deterministic order.
   *
   * If AI omitted one, use a null placeholder
   * rather than silently dropping the row.
   */
  return REQUIRED_METRICS.map(
    required => {
      const existing =
        metricMap.get(
          required.monitor.toLowerCase()
        );

      if (!existing) {
        return {
          monitor:
            required.monitor,

          metric:
            required.metric,

          current: null,
          previous: null,
          yesterday: null,
          twoDaysAgo: null,

          assessment:
            'Unavailable'
        };
      }

      return {
        monitor:
          required.monitor,

        metric:
          existing.metric ||
          required.metric,

        current:
          existing.current ?? null,

        previous:
          existing.previous ?? null,

        yesterday:
          existing.yesterday ?? null,

        twoDaysAgo:
          existing.twoDaysAgo ?? null,

        assessment:
          existing.assessment ||
          'Unknown'
      };
    }
  );
}


function buildMetricsTable(
  metrics
) {
  const normalizedMetrics =
    normalizeMetrics(metrics);

  if (
    normalizedMetrics.length === 0
  ) {
    return null;
  }

  const rows =
    normalizedMetrics.map(
      metric => ({
        monitor:
          `${metricMonitorIcon(
            metric.monitor
          )} ${formatMonitorName(
            metric.monitor
          )}`,

        current:
          formatMetricValue(
            metric.current
          ),

        previous:
          formatMetricValue(
            metric.previous
          ),

        yesterday:
          formatMetricValue(
            metric.yesterday
          ),

        twoDaysAgo:
          formatMetricValue(
            metric.twoDaysAgo
          ),

        assessment:
          `${metricAssessmentEmoji(
            metric.assessment
          )} ${
            metric.assessment ||
            'Unknown'
          }`
      })
    );

  const headers = {
    monitor: 'Monitor',
    current: 'Current',
    previous: 'Previous',
    yesterday: 'Yesterday',
    twoDaysAgo: '2 Days Ago',
    assessment: 'Assessment'
  };

  const widths = {
    monitor: Math.max(
      headers.monitor.length,
      ...rows.map(
        row =>
          row.monitor.length
      )
    ),

    current: Math.max(
      headers.current.length,
      ...rows.map(
        row =>
          row.current.length
      )
    ),

    previous: Math.max(
      headers.previous.length,
      ...rows.map(
        row =>
          row.previous.length
      )
    ),

    yesterday: Math.max(
      headers.yesterday.length,
      ...rows.map(
        row =>
          row.yesterday.length
      )
    ),

    twoDaysAgo: Math.max(
      headers.twoDaysAgo.length,
      ...rows.map(
        row =>
          row.twoDaysAgo.length
      )
    ),

    assessment: Math.max(
      headers.assessment.length,
      ...rows.map(
        row =>
          row.assessment.length
      )
    )
  };

  const pad =
    (
      value,
      width
    ) =>
      String(value)
        .padEnd(
          width,
          ' '
        );

  const header =
    `${pad(
      headers.monitor,
      widths.monitor
    )}  ` +

    `${pad(
      headers.current,
      widths.current
    )}  ` +

    `${pad(
      headers.previous,
      widths.previous
    )}  ` +

    `${pad(
      headers.yesterday,
      widths.yesterday
    )}  ` +

    `${pad(
      headers.twoDaysAgo,
      widths.twoDaysAgo
    )}  ` +

    `${pad(
      headers.assessment,
      widths.assessment
    )}`;

  const separator =
    '-'.repeat(
      header.length
    );

  const lines =
    rows.map(
      row =>
        `${pad(
          row.monitor,
          widths.monitor
        )}  ` +

        `${pad(
          row.current,
          widths.current
        )}  ` +

        `${pad(
          row.previous,
          widths.previous
        )}  ` +

        `${pad(
          row.yesterday,
          widths.yesterday
        )}  ` +

        `${pad(
          row.twoDaysAgo,
          widths.twoDaysAgo
        )}  ` +

        `${pad(
          row.assessment,
          widths.assessment
        )}`
    );

  return [
    '```',
    header,
    separator,
    ...lines,
    '```'
  ].join('\n');
}


/*
 * ============================================================
 * VALIDATION
 * ============================================================
 */

function validateInput(
  data
) {
  if (
    !data ||
    typeof data !== 'object'
  ) {
    throw new Error(
      'Validated AI review must be an object.'
    );
  }

  if (
    data.validation?.valid !== true
  ) {
    throw new Error(
      'AI review did not pass validation.'
    );
  }

  if (!data.review) {
    throw new Error(
      'Validated AI review has no review object.'
    );
  }

  if (
    !data.review.overallAssessment
  ) {
    throw new Error(
      'Validated AI review has no overallAssessment.'
    );
  }

  if (
    !Array.isArray(
      data.review.findings
    )
  ) {
    throw new Error(
      'Validated AI review has no findings array.'
    );
  }

  /*
   * Metrics are now required.
   *
   * The prompt builder should already guarantee this,
   * but keeping validation here protects Slack output
   * from malformed AI responses.
   */
  if (
    !Array.isArray(
      data.review.metrics
    )
  ) {
    throw new Error(
      'Validated AI review has no metrics array.'
    );
  }

  const normalizedMetrics =
    normalizeMetrics(
      data.review.metrics
    );

  if (
    normalizedMetrics.length !==
    REQUIRED_METRICS.length
  ) {
    throw new Error(
      'Validated AI review does not contain the required six metrics.'
    );
  }
}


/*
 * ============================================================
 * OVERALL SECTION
 * ============================================================
 */

function buildOverallBlocks(
  data
) {
  const overall =
    data.review
      .overallAssessment;

  const metrics =
    normalizeMetrics(
      data.review.metrics
    );

  const severityIcon =
    severityEmoji(
      overall.severity
    );

  const metricsTable =
    buildMetricsTable(
      metrics
    );

  const blocks = [
    {
      type: 'header',

      text: {
        type: 'plain_text',

        text:
          `${severityIcon} QA Sentinel AI Review`,

        emoji: true
      }
    },

    {
      type: 'section',

      fields: [
        {
          type: 'mrkdwn',

          text:
  `*Overall*\n` +
  `${severityIcon} ` +
  `${escapeSlackText(
    truncate(
      overall.summary ||
      overall.severity ||
      'No overall assessment',
      240
    )
  )}`
        },

        {
          type: 'mrkdwn',

          text:
            `*Decision*\n` +
            `${
              overall.shouldNotify
                ? '✅ Notify'
                : '➖ Observe'
            }`
        }
      ]
    }
  ];

  if (metricsTable) {
    blocks.push(
      {
        type: 'section',

        text: {
          type: 'mrkdwn',

          text:
            `*📊 Overall Metrics*\n` +
            metricsTable
        }
      }
    );
  }

  blocks.push(
    {
      type: 'section',

      text: {
        type: 'mrkdwn',

        text:
          `*🔎 Key Signals*`
      }
    }
  );

  return blocks;
}


/*
 * ============================================================
 * FINDINGS
 * ============================================================
 *
 * Keep findings concise.
 *
 * Do not render the complete metric payload here.
 * Metrics already appear in the table above.
 */

function buildFindingBlocks(
  finding,
  index
) {
  const severityIcon =
    severityEmoji(
      finding.severity
    );

  const classificationIcon =
    classificationEmoji(
      finding.classification
    );

  const classification =
    classificationLabel(
      finding.classification
    );

  const monitor =
    formatMonitorName(
      finding.monitor
    );

  const title =
    escapeSlackText(
      truncate(
        finding.title ||
        `Finding ${index + 1}`,
        120
      )
    );

  const evidence =
    Array.isArray(
      finding.evidence
    )
      ? finding.evidence
          .filter(Boolean)
          .slice(0, 2)
      : [];

    const actions =
    Array.isArray(
      finding.recommendedActions
    )
      ? finding.recommendedActions
          .filter(Boolean)
          .slice(0, 1)
      : [];

  const blocks = [
    {
      type: 'section',

      text: {
        type: 'mrkdwn',

        text:
          `*${severityIcon} ` +
          `${escapeSlackText(
            monitor
          )}: ${title}*\n` +

          `${classificationIcon} ` +
          `*${escapeSlackText(
            classification
          )}*`
      }
    }
  ];

    if (actions.length > 0) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text:
          `*Action*\n` +
          formatBulletList(
            actions,
            180
          )
      }
    });
  }

  blocks.push({
    type: 'divider'
  });

  return blocks;
}


/*
 * ============================================================
 * GLOBAL RECOMMENDATIONS
 * ============================================================
 */

function buildGlobalRecommendationBlocks(
  data
) {
  const recommendations =
    data.review
      ?.globalRecommendations || [];

  if (
    !Array.isArray(
      recommendations
    ) ||
    recommendations.length === 0
  ) {
    return [];
  }

    const usefulRecommendations =
    recommendations
      .filter(Boolean)
      .slice(0, 2);

  if (
    usefulRecommendations.length === 0
  ) {
    return [];
  }

    return [
    {
      type: 'section',

      text: {
        type: 'mrkdwn',

        text:
          `*📌 Recommended QA Actions*\n` +
          formatBulletList(
            usefulRecommendations,
            180
          )
      }
    }
  ];
}


/*
 * ============================================================
 * METADATA
 * ============================================================
 *
 * Confidence is intentionally NOT rendered.
 *
 * Model / validation / duration are kept at the bottom
 * for internal traceability.
 */

function buildMetadataBlocks(
  data
) {
  const metadata =
    data.metadata || {};

  const generatedAt =
    metadata.generatedAtUtc ||
    new Date().toISOString();

  return [
    {
      type: 'context',

      elements: [
        {
          type: 'mrkdwn',

          text:
  `✅ Validation ${formatNumber(
    data.validation?.score
  )}/100  •  ` +

  `🕒 ${escapeSlackText(
    formatTime(
      generatedAt,
      'America/New_York'
    )
  )} US / ` +

  `${escapeSlackText(
    formatTime(
      generatedAt,
      'Asia/Ho_Chi_Minh'
    )
  )} ICT`
        }
      ]
    }
  ];
}


/*
 * ============================================================
 * SLACK PAYLOAD
 * ============================================================
 */

function buildSlackPayload(
  data
) {
  const overall =
    data.review
      .overallAssessment;

    const findings =
    data.review.findings
      .filter(Boolean)
      .filter(
        finding =>
          normalizeClassification(
            finding.classification
          ) !== 'normal_variation'
      )
      .slice(
        0,
        MAX_FINDINGS
      );

  const blocks = [
    ...buildOverallBlocks(
      data
    )
  ];

  findings.forEach(
    (
      finding,
      index
    ) => {
      blocks.push(
        ...buildFindingBlocks(
          finding,
          index
        )
      );
    }
  );

  blocks.push(
    ...buildGlobalRecommendationBlocks(
      data
    )
  );

  blocks.push(
    ...buildMetadataBlocks(
      data
    )
  );

  if (
    blocks.length >
    MAX_SLACK_BLOCKS
  ) {
    throw new Error(
      `Slack payload contains too many blocks: ${blocks.length}`
    );
  }

  return {
    text:
      `${severityEmoji(
        overall.severity
      )} QA Sentinel AI Review — ` +
      `${overall.severity} — ` +
      `${overall.shouldNotify
        ? 'Notify'
        : 'Observe'}`,

    blocks
  };
}


/*
 * ============================================================
 * SAVE PAYLOAD
 * ============================================================
 */

function savePayload(
  payload
) {
  ensureOutputDirectory();

  const archivedFile =
    path.join(
      OUTPUT_DIRECTORY,
      `slack-ai-payload-${createTimestamp()}.json`
    );

  writeJsonFile(
    LATEST_PAYLOAD_FILE,
    payload
  );

  writeJsonFile(
    archivedFile,
    payload
  );

  return {
    latest:
      LATEST_PAYLOAD_FILE,

    archived:
      archivedFile
  };
}


/*
 * ============================================================
 * DUPLICATE PROTECTION
 * ============================================================
 */

function isAlreadySent(
  data
) {
  const responseId =
    data.metadata?.responseId;

  if (!responseId) {
    return false;
  }

  const lastSent =
    readJsonFile(
      LAST_SENT_FILE,
      null
    );

  return (
    lastSent?.responseId ===
    responseId
  );
}


function saveLastSent(
  data
) {
  ensureOutputDirectory();

  writeJsonFile(
    LAST_SENT_FILE,
    {
      responseId:
        data.metadata
          ?.responseId || null,

      sentAtUtc:
        new Date().toISOString(),

      validationScore:
        data.validation
          ?.score ?? null,

      severity:
        data.review
          ?.overallAssessment
          ?.severity || null,

      classification:
        data.review
          ?.overallAssessment
          ?.classification || null
    }
  );
}


/*
 * ============================================================
 * CONSOLE PREVIEW
 * ============================================================
 */

function printPayloadPreview(
  data,
  payload,
  outputPaths,
  dryRun
) {
  const overall =
    data.review
      .overallAssessment;

  const metrics =
    normalizeMetrics(
      data.review.metrics
    );

  console.log(
    '\n💬 QA Sentinel Slack AI Reporter'
  );

  console.log(
    '✅ Validated AI review loaded'
  );

  console.log(
    `🚦 Severity: ${overall.severity}`
  );

  console.log(
    `📌 Classification: ` +
    `${overall.classification}`
  );

  /*
   * Confidence intentionally omitted from
   * producer-facing Slack output and preview.
   */

  console.log(
    `📊 Metrics rendered: ` +
    `${metrics.length}`
  );

  console.log(
  `🔎 Findings rendered: ` +
  `${Math.min(
    data.review.findings
      .filter(Boolean)
      .filter(
        finding =>
          normalizeClassification(
            finding.classification
          ) !== 'normal_variation'
      )
      .length,
    MAX_FINDINGS
  )}`
);

  console.log(
    `🧱 Slack blocks: ` +
    `${payload.blocks.length}`
  );

  console.log(
    `📄 Latest payload: ` +
    `${outputPaths.latest}`
  );

  console.log(
    `📦 Archived payload: ` +
    `${outputPaths.archived}`
  );

  if (dryRun) {
    console.log(
      '🧪 Dry run enabled — message was not sent.'
    );
  }
}


/*
 * ============================================================
 * MAIN
 * ============================================================
 */

async function main() {
  const enabled =
    parseBoolean(
      process.env
        .SLACK_AI_REVIEW_ENABLED,
      false
    );

  if (!enabled) {
    console.log(
      '\n⏭ SLACK_AI_REVIEW_ENABLED is not true.'
    );

    return;
  }

  assertFileExists(
    VALIDATED_REVIEW_FILE,
    'Validated AI review'
  );

  ensureOutputDirectory();

  const data =
    readJsonFile(
      VALIDATED_REVIEW_FILE
    );

  validateInput(
    data
  );

  const overall =
    data.review
      .overallAssessment;

  if (
    overall.shouldNotify !== true
  ) {
    console.log(
      '\n⏭ AI review has shouldNotify=false.'
    );

    return;
  }

  /*
   * Keep reading usage summary for backward compatibility.
   * It is intentionally not rendered in Producer-facing Slack.
   */
  readJsonFile(
    USAGE_SUMMARY_FILE,
    null
  );

  const payload =
    buildSlackPayload(
      data
    );

  const outputPaths =
    savePayload(
      payload
    );

  const dryRun =
    parseBoolean(
      process.env
        .SLACK_AI_DRY_RUN,
      true
    );

  printPayloadPreview(
    data,
    payload,
    outputPaths,
    dryRun
  );

  if (dryRun) {
    return;
  }

  if (
    isAlreadySent(data)
  ) {
    console.log(
      '⏭ This AI review was already sent to Slack.'
    );

    return;
  }

  console.log(
    `📡 Sending AI review via ` +
    `${SLACK_WEBHOOK_ENV_KEY}...`
  );

  const result =
    await sendSlackMessage({
      webhookEnvKey:
        SLACK_WEBHOOK_ENV_KEY,

      text:
        payload.text,

      blocks:
        payload.blocks
    });

  saveLastSent(
    data
  );

  console.log(
    '✅ AI review sent to Slack.'
  );

  console.log(
    `🧱 Blocks sent: ` +
    `${
      result.blockCount ??
      payload.blocks.length
    }`
  );
}


main().catch(error => {
  console.error(
    '\n❌ Slack AI Reporter failed.'
  );

  console.error(
    `Message: ${error.message}`
  );

  process.exit(1);
});