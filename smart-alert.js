const fs = require('fs');
const path = require('path');

const {
  sendSlackMessage
} = require('./engine/slack-notifier');

const {
  shouldSendAlert,
  recordAlert
} = require('./engine/alert-history');

const ROOT = __dirname;

const SEVERITY_RANK = {
  CRITICAL: 4,
  WARNING: 3,
  ATTENTION: 2,
  NORMAL: 1
};

/**
 * Read and parse a JSON file.
 */
function readJson(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(
      `Không tìm thấy file: ${filePath}`
    );
  }

  try {
    return JSON.parse(
      fs.readFileSync(filePath, 'utf8')
    );
  } catch (error) {
    throw new Error(
      `Không thể đọc JSON ${filePath}: ` +
      `${error.message}`
    );
  }
}

/**
 * Create a directory if it does not exist.
 */
function ensureDirectory(directoryPath) {
  fs.mkdirSync(directoryPath, {
    recursive: true
  });
}

/**
 * Safely convert a value to a number.
 */
function toNumber(value) {
  const number = Number(value);

  return Number.isFinite(number)
    ? number
    : 0;
}

/**
 * Normalize a text value for comparison.
 */
function normalizeText(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase();
}

/**
 * Convert snake_case text into a readable label.
 */
function formatName(value) {
  return String(value ?? 'unknown')
    .replaceAll('_', ' ')
    .replace(/\b\w/g, character =>
      character.toUpperCase()
    );
}

/**
 * Get the requested monitor configuration.
 */
function getMonitorConfig(
  config,
  monitorName
) {
  const monitorConfig =
    Array.isArray(config.monitors)
      ? config.monitors.find(
          monitor =>
            monitor.name === monitorName
        )
      : config[monitorName];

  if (!monitorConfig) {
    throw new Error(
      `Không tìm thấy config cho monitor ` +
      `"${monitorName}"`
    );
  }

  if (monitorConfig.enabled === false) {
    throw new Error(
      `Monitor "${monitorName}" đang bị disabled`
    );
  }

  if (!monitorConfig.slug) {
    throw new Error(
      `Monitor "${monitorName}" chưa có slug`
    );
  }

  if (
    !Array.isArray(monitorConfig.metrics) ||
    monitorConfig.metrics.length === 0
  ) {
    throw new Error(
      `Monitor "${monitorName}" chưa có metrics`
    );
  }

  return monitorConfig;
}

/**
 * Build the comparison report path from monitor slug.
 */
function getComparisonFile(monitorConfig) {
  return path.join(
    ROOT,
    'reports',
    'comparison',
    `${monitorConfig.slug}-comparison-latest.json`
  );
}

/**
 * Build the alert report filename from monitor slug.
 */
function getAlertOutputName(
  monitorConfig
) {
  return `${monitorConfig.slug}-alerts`;
}

/**
 * Read severity thresholds from monitor config.
 */
function getDropThresholds(config) {
  const thresholds =
    config.comparisonThresholds ||
    config.drop_thresholds ||
    {};

  return {
    attention: toNumber(
      thresholds.attention ?? 20
    ),

    warning: toNumber(
      thresholds.warning ?? 40
    ),

    critical: toNumber(
      thresholds.critical ?? 60
    )
  };
}

/**
 * Calculate alert severity from a drop percentage.
 */
function calculateSeverity(
  dropPercent,
  thresholds
) {
  if (
    dropPercent >= thresholds.critical
  ) {
    return 'CRITICAL';
  }

  if (
    dropPercent >= thresholds.warning
  ) {
    return 'WARNING';
  }

  if (
    dropPercent >= thresholds.attention
  ) {
    return 'ATTENTION';
  }

  return 'NORMAL';
}

/**
 * Get all valid negative comparison changes.
 */
function getValidComparisonChanges(
  metric
) {
  const comparisons = [
    {
      name: 'previous',
      label: 'previous 2 hours',
      baseline: toNumber(
        metric.previous
      ),
      change:
        metric.change?.vs_previous
    },
    {
      name: 'yesterday',
      label: 'same 2 hours yesterday',
      baseline: toNumber(
        metric.yesterday
      ),
      change:
        metric.change?.vs_yesterday
    },
    {
      name: 'two_days_ago',
      label:
        'same 2 hours two days ago',
      baseline: toNumber(
        metric.two_days_ago
      ),
      change:
        metric.change?.vs_two_days_ago
    }
  ];

  return comparisons.filter(item => {
    return (
      item.change?.status ===
        'COMPARABLE' &&
      typeof item.change?.percent ===
        'number' &&
      item.change.percent < 0
    );
  });
}

/**
 * Find the worst valid drop for one metric.
 */
function getWorstValidDrop(
  metric,
  minimumBaseline
) {
  const validChanges =
    getValidComparisonChanges(metric)
      .filter(item =>
        item.baseline >= minimumBaseline
      )
      .map(item => ({
        ...item,

        dropPercent: Math.abs(
          item.change.percent
        )
      }))
      .sort(
        (a, b) =>
          b.dropPercent -
          a.dropPercent
      );

  return validChanges[0] || null;
}

/**
 * Get a readable label for a metric.
 */
function getMetricLabel(
  metricName,
  config
) {
  return (
    config.metricLabels?.[metricName] ||
    formatName(metricName)
  );
}

/**
 * Get minimum baseline for an individual metric.
 */
function getMinimumBaseline(
  metricName,
  config
) {
  const configuredMinimum =
    config.minimumBaselines?.[
      metricName
    ];

  if (
    configuredMinimum !== undefined
  ) {
    return toNumber(
      configuredMinimum
    );
  }

  /*
   * Backward compatibility with the old
   * Spin monitor configuration.
   */
  if (
    metricName === 'unique_users'
  ) {
    return toNumber(
      config.minimum_baseline_users ??
      config.minimum_users ??
      5
    );
  }

  return toNumber(
    config.minimum_baseline ??
    config.minimum_baseline_spins ??
    10
  );
}

/**
 * Get minimum current value for one metric.
 */
function getMinimumCurrentValue(
  metricName,
  config
) {
  const configuredMinimum =
    config.minimumCurrentValues?.[
      metricName
    ];

  if (
    configuredMinimum !== undefined
  ) {
    return toNumber(
      configuredMinimum
    );
  }

  /*
   * Backward compatibility with the old
   * Spin monitor configuration.
   */
  if (
    metricName === 'unique_users'
  ) {
    return toNumber(
      config.minimum_users ?? 5
    );
  }

  if (
    metricName === 'total_spins'
  ) {
    return toNumber(
      config.minimum_current_spins ??
      10
    );
  }

  return 0;
}

/**
 * Analyze one configured metric.
 */
function analyzeMetric(
  metricName,
  metric,
  config
) {
  if (!metric) {
    return null;
  }

  const minimumBaseline =
    getMinimumBaseline(
      metricName,
      config
    );

  const worstDrop =
    getWorstValidDrop(
      metric,
      minimumBaseline
    );

  if (!worstDrop) {
    return null;
  }

  return {
    name: metricName,

    label: getMetricLabel(
      metricName,
      config
    ),

    current: toNumber(
      metric.current
    ),

    previous: toNumber(
      metric.previous
    ),

    yesterday: toNumber(
      metric.yesterday
    ),

    two_days_ago: toNumber(
      metric.two_days_ago
    ),

    worst_drop_percent:
      worstDrop.dropPercent,

    worst_drop_window:
      worstDrop.name,

    worst_drop_label:
      worstDrop.label
  };
}

/**
 * Extract configured dimensions from comparison.
 */
function buildDimensions(
  comparison,
  config
) {
  const dimensions = {};

  for (
    const dimensionName
    of config.dimensions || []
  ) {
    dimensions[dimensionName] =
      comparison[dimensionName];
  }

  return dimensions;
}

/**
 * Build an alert title using configured dimensions.
 */
function buildTitle(
  comparison,
  config
) {
  const titleParts =
    (config.dimensions || [])
      .map(dimensionName => {
        const value =
          comparison[dimensionName];

        if (
          value === undefined ||
          value === null ||
          value === ''
        ) {
          return null;
        }

        return formatName(value);
      })
      .filter(Boolean);

  if (titleParts.length > 0) {
    return titleParts.join(' · ');
  }

  return (
    config.displayName ||
    config.name ||
    config.slug ||
    'Unknown Monitor'
  );
}

/**
 * Check whether a value exists in an ignore list.
 */
function isIgnoredValue(
  value,
  ignoredValues = []
) {
  const normalizedValue =
    normalizeText(value);

  return ignoredValues
    .map(normalizeText)
    .includes(normalizedValue);
}

/**
 * Support old Spin-specific ignore configuration.
 */
function getLegacyIgnoreReason(
  comparison,
  config
) {
  const spinType =
    comparison.spin_type;

  const provider =
    comparison.provider;

  const unitName =
    comparison.unit_name;

  if (
    isIgnoredValue(
      spinType,
      config.ignore_spin_types
    )
  ) {
    return (
      `Ignored spin type: ${spinType}`
    );
  }

  if (
    isIgnoredValue(
      provider,
      config.ignore_providers
    )
  ) {
    return (
      `Ignored provider: ${provider}`
    );
  }

  if (
    isIgnoredValue(
      unitName,
      config.ignore_unit_names
    )
  ) {
    return (
      `Ignored unit: ${unitName}`
    );
  }

  return null;
}

/**
 * Generic ignore rules.
 *
 * Supported config example:
 *
 * "ignoreValues": {
 *   "client_type": ["unknown"],
 *   "payment_type": ["test"]
 * }
 */
function getGenericIgnoreReason(
  comparison,
  config
) {
  const ignoreValues =
    config.ignoreValues || {};

  for (
    const [
      dimensionName,
      ignoredValues
    ] of Object.entries(ignoreValues)
  ) {
    if (
      isIgnoredValue(
        comparison[dimensionName],
        ignoredValues
      )
    ) {
      return (
        `Ignored ${formatName(
          dimensionName
        )}: ` +
        `${comparison[dimensionName]}`
      );
    }
  }

  return null;
}

/**
 * Support old provider zero-history rule.
 */
function shouldIgnoreProviderZeroHistory(
  comparison,
  config
) {
  const providers =
    (
      config.ignore_when_zero_for_days ||
      []
    ).map(normalizeText);

  const provider =
    normalizeText(
      comparison.provider
    );

  if (
    !providers.includes(provider)
  ) {
    return false;
  }

  const primaryMetricName =
    config.primaryMetric ||
    config.metrics?.[0];

  const primaryMetric =
    comparison.metrics?.[
      primaryMetricName
    ] || {};

  return (
    toNumber(primaryMetric.current) === 0 &&
    toNumber(primaryMetric.previous) === 0 &&
    toNumber(primaryMetric.yesterday) === 0
  );
}

/**
 * Determine whether one comparison should be ignored.
 */
function getIgnoreReason(
  comparison,
  config
) {
  const genericReason =
    getGenericIgnoreReason(
      comparison,
      config
    );

  if (genericReason) {
    return genericReason;
  }

  const legacyReason =
    getLegacyIgnoreReason(
      comparison,
      config
    );

  if (legacyReason) {
    return legacyReason;
  }

  if (
    shouldIgnoreProviderZeroHistory(
      comparison,
      config
    )
  ) {
    return (
      `${comparison.provider} has had ` +
      'zero traffic for multiple ' +
      'comparison windows'
    );
  }

  for (
    const metricName
    of config.metrics || []
  ) {
    const metric =
      comparison.metrics?.[
        metricName
      ];

    if (!metric) {
      continue;
    }

    const currentValue =
      toNumber(metric.current);

    const minimumCurrentValue =
      getMinimumCurrentValue(
        metricName,
        config
      );

    if (
      minimumCurrentValue > 0 &&
      currentValue > 0 &&
      currentValue <
        minimumCurrentValue
    ) {
      return (
        `${getMetricLabel(
          metricName,
          config
        )} current volume is too low: ` +
        `${currentValue}`
      );
    }
  }

  return null;
}

/**
 * Build a generic recommendation.
 */
function buildRecommendation(
  config,
  analyzedMetrics
) {
  const metricResults =
    Object.values(analyzedMetrics);

  const allCurrentValuesAreZero =
    metricResults.length > 0 &&
    metricResults.every(
      metric => metric.current === 0
    );

  if (allCurrentValuesAreZero) {
    return (
      `Check whether ` +
      `${config.displayName || config.name} ` +
      'traffic or its related service is unavailable.'
    );
  }

  const severeMetrics =
    metricResults.filter(
      metric =>
        metric.worst_drop_percent >= 60
    );

  if (severeMetrics.length >= 2) {
    return (
      'Multiple metrics dropped significantly. ' +
      'Check service health, client errors, ' +
      'traffic and recent deployments.'
    );
  }

  return (
    `Review ` +
    `${config.displayName || config.name} ` +
    'traffic in Splunk and check related errors.'
  );
}

/**
 * Build one generic alert.
 */
function buildAlert(
  comparison,
  config
) {
  const configuredMetrics =
    config.metrics || [];

  const analyzedMetrics = {};

  for (
    const metricName
    of configuredMetrics
  ) {
    const metric =
      comparison.metrics?.[
        metricName
      ];

    const analysis =
      analyzeMetric(
        metricName,
        metric,
        config
      );

    if (analysis) {
      analyzedMetrics[metricName] =
        analysis;
    }
  }

  const validMetrics =
    Object.values(analyzedMetrics);

  if (validMetrics.length === 0) {
    return null;
  }

  validMetrics.sort(
    (a, b) =>
      b.worst_drop_percent -
      a.worst_drop_percent
  );

  const worstMetric =
    validMetrics[0];

  const thresholds =
    getDropThresholds(config);

  const severity =
    calculateSeverity(
      worstMetric.worst_drop_percent,
      thresholds
    );

  if (severity === 'NORMAL') {
    return null;
  }

  const configuredPrimaryMetric =
    config.primaryMetric;

  /*
   * Use configured primary metric when it has
   * a valid drop. Otherwise use the worst metric.
   */
  const primaryMetric =
    analyzedMetrics[
      configuredPrimaryMetric
    ] || worstMetric;

  return {
    severity,

    title: buildTitle(
      comparison,
      config
    ),

    dimensions: buildDimensions(
      comparison,
      config
    ),

    primary_metric:
      primaryMetric.name,

    reason:
      `${primaryMetric.label} dropped ` +
      `${primaryMetric.worst_drop_percent}% ` +
      `compared with ` +
      `${primaryMetric.worst_drop_label}`,

    recommendation:
      buildRecommendation(
        config,
        analyzedMetrics
      ),

    metrics: analyzedMetrics,

    worst_drop_percent:
      worstMetric.worst_drop_percent,

    worst_drop_metric:
      worstMetric.name
  };
}

/**
 * Sort alerts by severity and worst drop.
 */
function sortAlerts(alerts) {
  return alerts.sort((a, b) => {
    const severityDifference =
      SEVERITY_RANK[b.severity] -
      SEVERITY_RANK[a.severity];

    if (severityDifference !== 0) {
      return severityDifference;
    }

    return (
      toNumber(
        b.worst_drop_percent
      ) -
      toNumber(
        a.worst_drop_percent
      )
    );
  });
}

/**
 * Print one alert in the terminal.
 */
function printAlert(alert) {
  const iconMap = {
    CRITICAL: '🔴',
    WARNING: '🟠',
    ATTENTION: '🟡'
  };

  const icon =
    iconMap[alert.severity] ||
    '⚪';

  console.log(
    `${icon} ${alert.severity} | ` +
    `${alert.title}`
  );

  console.log(
    `   ${alert.reason}`
  );

  for (
    const metric
    of Object.values(alert.metrics)
  ) {
    console.log(
      `   ${metric.label}: ` +
      `${metric.current} current | ` +
      `${metric.previous} previous | ` +
      `${metric.yesterday} yesterday | ` +
      `${metric.two_days_ago} two days ago`
    );
  }

  console.log(
    `   Recommendation: ` +
    `${alert.recommendation}`
  );

  console.log('');
}

/**
 * Escape text for Slack mrkdwn.
 */
function escapeSlackText(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

/**
 * Format a numeric value for Slack.
 */
function formatNumber(value) {
  return new Intl.NumberFormat(
    'en-US',
    {
      maximumFractionDigits: 2
    }
  ).format(
    toNumber(value)
  );
}

/**
 * Return the icon for one severity.
 */
function getSeverityIcon(severity) {
  const iconMap = {
    CRITICAL: '🔴',
    WARNING: '🟠',
    ATTENTION: '🟡'
  };

  return iconMap[severity] || '⚪';
}

/**
 * Build readable Slack text from alert dimensions.
 */
function buildSlackDimensionText(alert) {
  const entries = Object.entries(
    alert.dimensions || {}
  ).filter(([, value]) => {
    return (
      value !== undefined &&
      value !== null &&
      value !== ''
    );
  });

  if (entries.length === 0) {
    return null;
  }

  return entries
    .map(([name, value]) => {
      return (
        `*${escapeSlackText(formatName(name))}:* ` +
        `${escapeSlackText(formatName(value))}`
      );
    })
    .join('\n');
}

/**
 * Build readable Slack text from alert metrics.
 */
function buildSlackMetricText(alert) {
  const metrics =
    Object.values(alert.metrics || {});

  if (metrics.length === 0) {
    return '_No metric details available._';
  }

  return metrics
    .map(metric => {
      return [
        `*${escapeSlackText(metric.label)}*`,
        `Current: *${formatNumber(metric.current)}*`,
        `Previous: ${formatNumber(metric.previous)}`,
        `Yesterday: ${formatNumber(metric.yesterday)}`,
        `Two days ago: ${formatNumber(
          metric.two_days_ago
        )}`,
        `Worst drop: *${formatNumber(
          metric.worst_drop_percent
        )}%* vs ${escapeSlackText(
          metric.worst_drop_label
        )}`
      ].join(' · ');
    })
    .join('\n');
}

/**
 * Build Slack Block Kit payload for one alert.
 */
function buildSlackBlocks(
  alert,
  monitorConfig
) {
  const severityIcon =
    getSeverityIcon(alert.severity);

  const monitorLabel =
    monitorConfig.notificationName ||
    monitorConfig.displayName ||
    monitorConfig.name ||
    monitorConfig.slug ||
    'Unknown Monitor';

  const dimensionText =
    buildSlackDimensionText(alert);

  const blocks = [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text:
          `${severityIcon} QA Sentinel — ` +
          `${alert.severity}`,
        emoji: true
      }
    },
    {
      type: 'section',
      fields: [
        {
          type: 'mrkdwn',
          text:
            `*Monitor*\n` +
            `${escapeSlackText(
              monitorLabel
            )}`
        },
        {
          type: 'mrkdwn',
          text:
            `*Target*\n` +
            `${escapeSlackText(
              alert.title
            )}`
        }
      ]
    }
  ];

  if (dimensionText) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: dimensionText
      }
    });
  }

  blocks.push(
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text:
          `*Reason*\n` +
          `${escapeSlackText(
            alert.reason
          )}`
      }
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text:
          `*Metrics*\n` +
          `${buildSlackMetricText(
            alert
          )}`
      }
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text:
          `*Recommendation*\n` +
          `${escapeSlackText(
            alert.recommendation
          )}`
      }
    },
    {
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text:
            `QA Sentinel · ` +
            `${new Date().toISOString()}`
        }
      ]
    }
  );

  return blocks;
}

/**
 * Send alerts to the Slack channel configured
 * for the current monitor.
 */
async function sendSlackAlerts(
  alerts,
  monitorName,
  monitorConfig
) {
  if (alerts.length === 0) {
    console.log(
      '📭 Không gửi Slack vì không có alert.'
    );

    return;
  }

  const webhookEnvKey =
    monitorConfig.notificationChannel;

  if (!webhookEnvKey) {
    throw new Error(
      `Monitor "${monitorName}" chưa có ` +
      'notificationChannel'
    );
  }

  const maximumSlackAlerts = 5;

  const alertsToSend =
    alerts.slice(
      0,
      maximumSlackAlerts
    );

  console.log(
    `\n📲 Đang kiểm tra ` +
    `${alertsToSend.length} alert ` +
    `để gửi Slack qua ` +
    `${webhookEnvKey}...`
  );

  let sentCount = 0;
  let skippedCount = 0;
  let failedCount = 0;

  for (const alert of alertsToSend) {
    try {
      const alertWithMonitor = {
        ...alert,
        monitor: monitorName
      };

      const shouldSend =
        shouldSendAlert(
          alertWithMonitor
        );

      if (!shouldSend) {
        skippedCount += 1;

        console.log(
          `⏭ Duplicate skipped: ` +
          `${alert.title}`
        );

        continue;
      }

      const severityIcon =
        getSeverityIcon(
          alert.severity
        );

      const fallbackText =
        `${severityIcon} QA Sentinel — ` +
        `${monitorConfig.displayName ||
          monitorName}: ` +
        `${alert.reason}`;

      await sendSlackMessage({
        webhookEnvKey,
        text: fallbackText,
        blocks: buildSlackBlocks(
          alert,
          monitorConfig
        )
      });

      recordAlert(
        alertWithMonitor
      );

      sentCount += 1;

      console.log(
        `✅ Slack sent: ` +
        `${alert.title}`
      );
    } catch (error) {
      failedCount += 1;

      console.error(
        `❌ Không gửi được Slack alert: ` +
        `${alert.title}`
      );

      console.error(
        `   ${error.message}`
      );
    }
  }

  if (
    alerts.length >
    maximumSlackAlerts
  ) {
    console.log(
      `ℹ️ Có thêm ` +
      `${
        alerts.length -
        maximumSlackAlerts
      } alert chỉ được lưu ` +
      'trong report JSON.'
    );
  }

  console.log(
    `📲 Slack result: ` +
    `${sentCount} sent, ` +
    `${skippedCount} skipped, ` +
    `${failedCount} failed`
  );
}
/**
 * Main application.
 */
async function main() {
  const monitorName =
    process.argv[2] ||
    'spin_event';

  const configPath =
    path.join(
      ROOT,
      'monitor-config.json'
    );

  const configFile =
    readJson(configPath);

  const monitorConfig =
    getMonitorConfig(
      configFile,
      monitorName
    );

  const comparisonPath =
    getComparisonFile(
      monitorConfig
    );

  const comparisonReport =
    readJson(
      comparisonPath
    );

  if (
    !Array.isArray(
      comparisonReport.comparisons
    )
  ) {
    throw new Error(
      'Comparison report không có ' +
      'mảng comparisons'
    );
  }

  const alerts = [];
  const ignored = [];

  for (
    const comparison
    of comparisonReport.comparisons
  ) {
    const ignoreReason =
      getIgnoreReason(
        comparison,
        monitorConfig
      );

    if (ignoreReason) {
      ignored.push({
        dimensions:
          buildDimensions(
            comparison,
            monitorConfig
          ),

        title:
          buildTitle(
            comparison,
            monitorConfig
          ),

        reason:
          ignoreReason
      });

      continue;
    }

    const alert =
      buildAlert(
        comparison,
        monitorConfig
      );

    if (alert) {
      alerts.push(alert);
    }
  }

  sortAlerts(alerts);

  const summary = {
    total_comparisons:
      comparisonReport
        .comparisons.length,

    total_alerts:
      alerts.length,

    critical:
      alerts.filter(
        alert =>
          alert.severity ===
          'CRITICAL'
      ).length,

    warning:
      alerts.filter(
        alert =>
          alert.severity ===
          'WARNING'
      ).length,

    attention:
      alerts.filter(
        alert =>
          alert.severity ===
          'ATTENTION'
      ).length,

    ignored:
      ignored.length
  };

  const output = {
    metadata: {
      monitor:
        monitorName,

      generatedAtUtc:
        new Date().toISOString(),

      sourceComparison:
        path.relative(
          ROOT,
          comparisonPath
        ),

      config:
        monitorConfig
    },

    summary,
    alerts,
    ignored
  };

  const alertDirectory =
    path.join(
      ROOT,
      'reports',
      'alerts'
    );

  ensureDirectory(
    alertDirectory
  );

  const outputName =
    getAlertOutputName(
      monitorConfig
    );

  const latestPath =
    path.join(
      alertDirectory,
      `${outputName}-latest.json`
    );

  const timestamp =
    new Date()
      .toISOString()
      .replace(
        /[:.]/g,
        '-'
      );

  const historyPath =
    path.join(
      alertDirectory,
      `${outputName}-${timestamp}.json`
    );

  fs.writeFileSync(
    latestPath,
    JSON.stringify(
      output,
      null,
      2
    )
  );

  fs.writeFileSync(
    historyPath,
    JSON.stringify(
      output,
      null,
      2
    )
  );

  console.log(
    '\n🧠 QA Sentinel — Smart Alert Engine'
  );

  console.log(
    '=================================================='
  );

  console.log(
    `Monitor: ${monitorName}`
  );

  console.log(
    `Total comparisons: ` +
    `${summary.total_comparisons}`
  );

  console.log(
    `🔴 Critical: ${summary.critical}`
  );

  console.log(
    `🟠 Warning: ${summary.warning}`
  );

  console.log(
    `🟡 Attention: ${summary.attention}`
  );

  console.log(
    `⚪ Ignored: ${summary.ignored}`
  );

  console.log(
    '=================================================='
  );

  if (alerts.length === 0) {
    console.log(
      '\n✅ Không có alert đáng chú ý.'
    );
  } else {
    console.log(
      '\nCác alert cần kiểm tra:\n'
    );

    alerts
      .slice(0, 20)
      .forEach(printAlert);
  }

  console.log(
    `✅ Latest report: ` +
    `${path.relative(
      ROOT,
      latestPath
    )}`
  );

await sendSlackAlerts(
  alerts,
  monitorName,
  monitorConfig
);
}

main().catch(error => {
  console.error(
    `\n❌ ${error.message}`
  );

  process.exit(1);
});