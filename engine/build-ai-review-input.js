const fs = require('fs');
const path = require('path');

const ROOT = path.join(
  __dirname,
  '..'
);

const ALERTS_DIR = path.join(
  ROOT,
  'reports',
  'alerts'
);

const RAW_DIR = path.join(
  ROOT,
  'reports',
  'raw'
);

const OUTPUT_DIR = path.join(
  ROOT,
  'reports',
  'ai'
);

const OUTPUT_FILE = path.join(
  OUTPUT_DIR,
  'ai-review-input-latest.json'
);

/*
 * Deterministic alert inputs.
 *
 * NOTE:
 * Alert filtering is intentionally separate from
 * Overall Metrics aggregation.
 *
 * For example, Spin alerts only include regular spins,
 * but Overall Spin Metrics include ALL spin types.
 */
const ALERT_FILES = [
  'spin-alerts-latest.json',
  'purchase-alerts-latest.json',
  'login-alerts-latest.json',
  'signup-alerts-latest.json',
  'redemption-alerts-latest.json',
  'quest-alerts-latest.json'
];

/*
 * Overall Metrics configuration.
 *
 * Each monitor has one authoritative primary metric.
 *
 * The values are calculated by summing that metric
 * across ALL rows in the corresponding raw report.
 *
 * AI must NOT recalculate these values.
 */
const OVERALL_METRICS = [
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

const HISTORICAL_WINDOWS = [
  'current',
  'previous',
  'yesterday',
  'two_days_ago'
];

const CLIENT_ERROR_FILE =
  'client_error-current.json';

function ensureOutputDirectory() {
  fs.mkdirSync(
    OUTPUT_DIR,
    {
      recursive: true
    }
  );
}

function loadJson(filePath) {
  if (!fs.existsSync(filePath)) {
    console.warn(
      `⚠️ File not found: ${filePath}`
    );

    return null;
  }

  try {
    return JSON.parse(
      fs.readFileSync(
        filePath,
        'utf8'
      )
    );
  } catch (error) {
    console.warn(
      `⚠️ Failed to parse ` +
      `${path.basename(filePath)}: ` +
      `${error.message}`
    );

    return null;
  }
}

function getRecords(json) {
  if (Array.isArray(json)) {
    return json;
  }

  if (
    json &&
    Array.isArray(json.records)
  ) {
    return json.records;
  }

  return [];
}

function normalizeSeverity(value) {
  return String(value || 'UNKNOWN')
    .trim()
    .toUpperCase();
}

function shouldIncludeAlert(
  monitorName,
  alert
) {
  /*
   * Spin monitoring is intentionally limited
   * to regular spins to reduce noise from
   * free_spin and buy_bonus traffic.
   *
   * IMPORTANT:
   * This rule applies ONLY to alerts.
   * Overall Spin Metrics still include ALL spin types.
   */
  if (monitorName === 'spin_event') {
    const spinType =
      alert.dimensions?.spin_type;

    return spinType === 'regular';
  }

  return true;
}

function extractMetricValues(alert) {
  const metrics =
    alert.metrics || {};

  const primaryMetricName =
    alert.primary_metric ||
    alert.worst_drop_metric ||
    Object.keys(metrics)[0] ||
    null;

  const primaryMetric =
    primaryMetricName
      ? metrics[primaryMetricName]
      : null;

  const alertWorstMetricName =
    alert.worst_drop_metric ||
    primaryMetricName;

  const alertWorstMetric =
    alertWorstMetricName
      ? metrics[alertWorstMetricName]
      : null;

  const normalizedMetrics = {};

  for (
    const [metricName, metric]
    of Object.entries(metrics)
  ) {
    normalizedMetrics[metricName] = {
      label:
        metric.label ||
        metricName,

      current:
        metric.current ?? null,

      previous:
        metric.previous ?? null,

      yesterday:
        metric.yesterday ?? null,

      two_days_ago:
        metric.two_days_ago ?? null,

      worst_drop_percent:
        metric.worst_drop_percent ?? null,

      worst_drop_window:
        metric.worst_drop_window ?? null,

      worst_drop_label:
        metric.worst_drop_label ?? null
    };
  }

  const current =
    primaryMetric?.current ?? null;

  const previous =
    primaryMetric?.previous ?? null;

  const yesterday =
    primaryMetric?.yesterday ?? null;

  const twoDaysAgo =
    primaryMetric?.two_days_ago ?? null;

  const baselineValues = [
    previous,
    yesterday,
    twoDaysAgo
  ]
    .map(value => Number(value))
    .filter(Number.isFinite);

  const maxBaseline =
    baselineValues.length > 0
      ? Math.max(...baselineValues)
      : 0;

  /*
   * Low-volume heuristic for AI context only.
   * This does not change deterministic severity.
   */
  const lowVolume =
    maxBaseline < 50;

  return {
    primaryMetricName,

    primaryMetricLabel:
      primaryMetric?.label ||
      primaryMetricName,

    current,
    previous,
    yesterday,
    twoDaysAgo,

    primaryMetricDropPercent:
      primaryMetric
        ?.worst_drop_percent ??
      null,

    primaryMetricDropWindow:
      primaryMetric
        ?.worst_drop_window ??
      null,

    primaryMetricDropLabel:
      primaryMetric
        ?.worst_drop_label ??
      null,

    alertWorstMetricName,

    alertWorstMetricLabel:
      alertWorstMetric?.label ||
      alertWorstMetricName,

    alertWorstDropPercent:
      alert.worst_drop_percent ??
      alertWorstMetric
        ?.worst_drop_percent ??
      null,

    alertWorstDropWindow:
      alertWorstMetric
        ?.worst_drop_window ??
      null,

    alertWorstDropLabel:
      alertWorstMetric
        ?.worst_drop_label ??
      null,

    volumeContext: {
      current:
        Number.isFinite(
          Number(current)
        )
          ? Number(current)
          : null,

      maxBaseline,

      lowVolume,

      baselineValues: {
        previous:
          Number.isFinite(
            Number(previous)
          )
            ? Number(previous)
            : null,

        yesterday:
          Number.isFinite(
            Number(yesterday)
          )
            ? Number(yesterday)
            : null,

        twoDaysAgo:
          Number.isFinite(
            Number(twoDaysAgo)
          )
            ? Number(twoDaysAgo)
            : null
      }
    },

    metrics:
      normalizedMetrics
  };
}

function buildAlertRecord(
  alert,
  monitorMetadata
) {
  const metricData =
    extractMetricValues(alert);

  return {
    monitor:
      monitorMetadata.name,

    monitorSlug:
      monitorMetadata.slug,

    monitorDisplayName:
      monitorMetadata.displayName,

    severity:
      normalizeSeverity(
        alert.severity
      ),

    title:
      alert.title || null,

    dimensions: {
      ...(alert.dimensions || {})
    },

    primaryMetric:
      metricData.primaryMetricName,

    primaryMetricLabel:
      metricData.primaryMetricLabel,

    current:
      metricData.current,

    previous:
      metricData.previous,

    yesterday:
      metricData.yesterday,

    twoDaysAgo:
      metricData.twoDaysAgo,

    primaryMetricDropPercent:
      metricData
        .primaryMetricDropPercent,

    primaryMetricDropWindow:
      metricData
        .primaryMetricDropWindow,

    primaryMetricDropLabel:
      metricData
        .primaryMetricDropLabel,

    alertWorstMetric:
      metricData
        .alertWorstMetricName,

    alertWorstMetricLabel:
      metricData
        .alertWorstMetricLabel,

    alertWorstDropPercent:
      metricData
        .alertWorstDropPercent,

    alertWorstDropWindow:
      metricData
        .alertWorstDropWindow,

    alertWorstDropLabel:
      metricData
        .alertWorstDropLabel,

    volumeContext:
      metricData.volumeContext,

    reason:
      alert.reason || null,

    recommendation:
      alert.recommendation || null,

    metrics:
      metricData.metrics
  };
}

function collectAlerts() {
  const alerts = [];

  const severityCounts = {
    critical: 0,
    warning: 0,
    attention: 0
  };

  const affectedMonitors =
    new Set();

  const affectedProviders =
    new Set();

  const affectedPlatforms =
    new Set();

  const affectedUnits =
    new Set();

  const excludedAlerts = [];

  let ignoredByRule = 0;

  for (const fileName of ALERT_FILES) {
    const filePath = path.join(
      ALERTS_DIR,
      fileName
    );

    const json =
      loadJson(filePath);

    if (!json) {
      continue;
    }

    const config =
      json.metadata?.config || {};

    const monitorMetadata = {
      name:
        json.metadata?.monitor ||
        config.name ||
        fileName.replace(
          '-alerts-latest.json',
          ''
        ),

      slug:
        config.slug ||
        fileName.replace(
          '-alerts-latest.json',
          ''
        ),

      displayName:
        config.displayName ||
        config.name ||
        fileName.replace(
          '-alerts-latest.json',
          ''
        )
    };

    const items =
      Array.isArray(json.alerts)
        ? json.alerts
        : [];

    ignoredByRule +=
      Array.isArray(json.ignored)
        ? json.ignored.length
        : 0;

    for (const alert of items) {
      if (
        !shouldIncludeAlert(
          monitorMetadata.name,
          alert
        )
      ) {
        excludedAlerts.push({
          monitor:
            monitorMetadata.name,

          title:
            alert.title || null,

          dimensions:
            alert.dimensions || {},

          reason:
            'Excluded from AI review because ' +
            'spin_type is not regular.'
        });

        continue;
      }

      const normalizedAlert =
        buildAlertRecord(
          alert,
          monitorMetadata
        );

      alerts.push(
        normalizedAlert
      );

      affectedMonitors.add(
        monitorMetadata.slug
      );

      const provider =
        normalizedAlert
          .dimensions
          .provider;

      const clientType =
        normalizedAlert
          .dimensions
          .client_type;

      const unitName =
        normalizedAlert
          .dimensions
          .unit_name;

      if (provider) {
        affectedProviders.add(
          provider
        );
      }

      if (clientType) {
        affectedPlatforms.add(
          clientType
        );
      }

      if (unitName) {
        affectedUnits.add(
          unitName
        );
      }

      switch (
        normalizedAlert
          .severity
          .toLowerCase()
      ) {
        case 'critical':
          severityCounts.critical += 1;
          break;

        case 'warning':
          severityCounts.warning += 1;
          break;

        case 'attention':
          severityCounts.attention += 1;
          break;

        default:
          break;
      }
    }
  }

  alerts.sort((first, second) => {
    const severityRank = {
      CRITICAL: 3,
      WARNING: 2,
      ATTENTION: 1
    };

    const firstRank =
      severityRank[first.severity] || 0;

    const secondRank =
      severityRank[second.severity] || 0;

    if (firstRank !== secondRank) {
      return secondRank - firstRank;
    }

    return (
      Number(
        second.alertWorstDropPercent || 0
      ) -
      Number(
        first.alertWorstDropPercent || 0
      )
    );
  });

  return {
    alerts,

    excludedAlerts,

    summary: {
      critical:
        severityCounts.critical,

      warning:
        severityCounts.warning,

      attention:
        severityCounts.attention,

      totalAlerts:
        alerts.length,

      ignoredByThresholdRules:
        ignoredByRule,

      excludedFromAiReview:
        excludedAlerts.length,

      affectedMonitors:
        Array.from(
          affectedMonitors
        ),

      affectedProviders:
        Array.from(
          affectedProviders
        ),

      affectedPlatforms:
        Array.from(
          affectedPlatforms
        ),

      affectedUnits:
        Array.from(
          affectedUnits
        )
    }
  };
}

/*
 * ============================================================
 * OVERALL METRICS
 * ============================================================
 *
 * Build one deterministic TOTAL for each major monitor
 * across Current / Previous / Yesterday / 2 Days Ago.
 *
 * IMPORTANT:
 * - This is NOT alert-driven.
 * - A monitor is included even when it has zero alerts.
 * - AI does NOT calculate these values.
 * - Slack Reporter does NOT calculate these values.
 * - Missing files / invalid data remain null.
 */

function aggregateMetricFromFile(
  fileName,
  metricName
) {
  const filePath = path.join(
    RAW_DIR,
    fileName
  );

  const json =
    loadJson(filePath);

  if (!json) {
    return null;
  }

  const records =
    getRecords(json);

  if (records.length === 0) {
    return 0;
  }

  let total = 0;

  for (const row of records) {
    const value =
      Number(
        row?.[metricName]
      );

    if (Number.isFinite(value)) {
      total += value;
    }
  }

  return total;
}

function collectOverallMetrics() {
  return OVERALL_METRICS.map(
    metricConfig => {
      const result = {
        monitor:
          metricConfig.monitor,

        slug:
          metricConfig.slug,

        metric:
          metricConfig.metric,

        current: null,
        previous: null,
        yesterday: null,
        twoDaysAgo: null
      };

      for (
        const windowName
        of HISTORICAL_WINDOWS
      ) {
        const fileName =
          `${metricConfig.slug}-${windowName}.json`;

        const total =
          aggregateMetricFromFile(
            fileName,
            metricConfig.metric
          );

        if (
          windowName === 'current'
        ) {
          result.current = total;
        }

        if (
          windowName === 'previous'
        ) {
          result.previous = total;
        }

        if (
          windowName === 'yesterday'
        ) {
          result.yesterday = total;
        }

        if (
          windowName === 'two_days_ago'
        ) {
          result.twoDaysAgo = total;
        }
      }

      return result;
    }
  );
}

function collectClientErrors() {
  const filePath = path.join(
    RAW_DIR,
    CLIENT_ERROR_FILE
  );

  const json =
    loadJson(filePath);

  if (!json) {
    return {
      totalErrors: 0,
      totalRows: 0,
      topErrors: []
    };
  }

  const records =
    Array.isArray(json)
      ? json
      : Array.isArray(json.records)
        ? json.records
        : [];

  const sortedRecords = [
    ...records
  ].sort(
    (first, second) =>
      Number(
        second.total_errors || 0
      ) -
      Number(
        first.total_errors || 0
      )
  );

  const totalErrors =
    sortedRecords.reduce(
      (sum, row) =>
        sum +
        Number(
          row.total_errors || 0
        ),
      0
    );

  const topErrors =
    sortedRecords
      .slice(0, 10)
      .map(row => ({
        client_type:
          row.client_type || 'unknown',

        message:
          row.message || 'Unknown error',

        total_errors:
          Number(
            row.total_errors || 0
          ),

        unique_users:
          Number(
            row.unique_users || 0
          )
      }));

  return {
    totalErrors,

    totalRows:
      records.length,

    topErrors
  };
}

function buildOutput() {
  const alertData =
    collectAlerts();

  const overallMetrics =
    collectOverallMetrics();

  const clientErrorData =
    collectClientErrors();

  return {
    generatedAt:
      new Date().toISOString(),

    reviewPolicy: {
      windowHours: 4,

      spinTypesIncluded: [
        'regular'
      ],

      aiRole:
        'Review deterministic alerts and assess ' +
        'whether they likely represent a real incident.',

      safetyRule:
        'AI must not suppress deterministic critical alerts.',

      overallMetricsRule:
        'Overall Metrics are deterministic TOTAL values ' +
        'aggregated from the raw monitor reports. AI must ' +
        'copy these values exactly and must not recalculate them.'
    },

    /*
     * IMPORTANT:
     * overallMetrics is independent from alerts.
     *
     * Therefore all six major monitors are always present:
     * Spin, Purchase, Signup, Login, Redemption, Quest.
     */
    overallMetrics,

    summary:
      alertData.summary,

    alerts:
      alertData.alerts,

    excludedAlerts:
      alertData.excludedAlerts,

    clientErrors:
      clientErrorData
  };
}

function saveOutput(data) {
  ensureOutputDirectory();

  fs.writeFileSync(
    OUTPUT_FILE,
    JSON.stringify(
      data,
      null,
      2
    )
  );
}

function formatMetricValue(value) {
  if (value === null) {
    return 'null';
  }

  return Number(
    value
  ).toLocaleString('en-US');
}

function main() {
  console.log(
    '\n🤖 Building AI Review Input...'
  );

  const output =
    buildOutput();

  saveOutput(output);

  console.log(
    '✅ AI Review Input created'
  );

  console.log(
    `📄 ${OUTPUT_FILE}`
  );

  console.log(
    `🔴 Critical: ` +
    `${output.summary.critical}`
  );

  console.log(
    `🟠 Warning: ` +
    `${output.summary.warning}`
  );

  console.log(
    `🟡 Attention: ` +
    `${output.summary.attention}`
  );

  console.log(
    `🚫 Excluded from AI review: ` +
    `${output.summary.excludedFromAiReview}`
  );

  console.log(
    '\n📊 Overall Metrics:'
  );

  for (
    const metric
    of output.overallMetrics
  ) {
    console.log(
      `   ${metric.monitor.padEnd(12)} ` +
      `Current=${formatMetricValue(metric.current)} ` +
      `Previous=${formatMetricValue(metric.previous)} ` +
      `Yesterday=${formatMetricValue(metric.yesterday)} ` +
      `2DaysAgo=${formatMetricValue(metric.twoDaysAgo)}`
    );
  }

  console.log('');
}

main();