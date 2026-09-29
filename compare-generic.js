const fs = require('fs');
const path = require('path');

const ROOT = __dirname;

const RAW_DIRECTORY = path.join(
  ROOT,
  'reports',
  'raw'
);

const REPORT_DIRECTORY = path.join(
  ROOT,
  'reports',
  'comparison'
);

const CONFIG_FILE = path.join(
  ROOT,
  'monitor-config.json'
);

const WINDOWS = [
  'current',
  'previous',
  'yesterday',
  'two_days_ago'
];

function loadConfig() {
  if (!fs.existsSync(CONFIG_FILE)) {
    throw new Error(
      `Không tìm thấy config: ${CONFIG_FILE}`
    );
  }

  const content = fs
    .readFileSync(CONFIG_FILE, 'utf8')
    .trim();

  if (!content) {
    throw new Error(
      'monitor-config.json đang rỗng'
    );
  }

  const config = JSON.parse(content);

  if (!Array.isArray(config.monitors)) {
    throw new Error(
      'monitor-config.json phải có field "monitors" dạng array'
    );
  }

  return config;
}

function getMonitorConfig(config, monitorName) {
  const monitor = config.monitors.find(
    item => item.name === monitorName
  );

  if (!monitor) {
    throw new Error(
      `Không tìm thấy config cho monitor "${monitorName}"`
    );
  }

  if (
    !Array.isArray(monitor.dimensions) ||
    monitor.dimensions.length === 0
  ) {
    throw new Error(
      `Monitor "${monitorName}" chưa khai báo dimensions`
    );
  }

  if (
    !Array.isArray(monitor.metrics) ||
    monitor.metrics.length === 0
  ) {
    throw new Error(
      `Monitor "${monitorName}" chưa khai báo metrics`
    );
  }

  return monitor;
}

function ensureDirectories() {
  fs.mkdirSync(REPORT_DIRECTORY, {
    recursive: true
  });
}

function loadWindow(monitorName, windowName) {
  const filePath = path.join(
    RAW_DIRECTORY,
    `${monitorName}-${windowName}.json`
  );

  if (!fs.existsSync(filePath)) {
    throw new Error(
      `Không tìm thấy file: ${filePath}`
    );
  }

  let content;

  try {
    content = JSON.parse(
      fs.readFileSync(filePath, 'utf8')
    );
  } catch (error) {
    throw new Error(
      `JSON không hợp lệ trong ${filePath}: ${error.message}`
    );
  }

  if (!Array.isArray(content.records)) {
    throw new Error(
      `File ${filePath} không có records hợp lệ`
    );
  }

  return {
    metadata: content.metadata || {},
    records: content.records
  };
}

function createKey(record, dimensions) {
  return dimensions
    .map(dimension =>
      String(record[dimension] ?? 'unknown')
    )
    .join('||');
}

function createEmptyRecordFromKey(
  key,
  dimensions
) {
  const values = key.split('||');
  const record = {};

  dimensions.forEach(
    (dimension, index) => {
      record[dimension] = values[index];
    }
  );

  return record;
}

function toNumber(value) {
  const number = Number(value);

  return Number.isFinite(number)
    ? number
    : 0;
}

function calculateChange(current, baseline) {
  current = toNumber(current);
  baseline = toNumber(baseline);

  if (baseline === 0 && current === 0) {
    return {
      percent: 0,
      status: 'NO_DATA'
    };
  }

  if (baseline === 0 && current > 0) {
    return {
      percent: null,
      status: 'NEW_TRAFFIC'
    };
  }

  const percent =
    ((current - baseline) / baseline) * 100;

  return {
    percent: Number(percent.toFixed(2)),
    status: 'COMPARABLE'
  };
}

function getThresholds(monitor) {
  const thresholds =
    monitor.comparisonThresholds || {};

  return {
    attention:
      Number(thresholds.attention) || 20,

    warning:
      Number(thresholds.warning) || 40,

    critical:
      Number(thresholds.critical) || 60
  };
}

function getSeverity(
  currentValue,
  comparisonResults,
  thresholds
) {
  const current = toNumber(currentValue);

  if (current === 0) {
    return {
      level: 'CRITICAL',
      reason: 'Current value is zero'
    };
  }

  const validDrops = comparisonResults
    .filter(result =>
      result.status === 'COMPARABLE' &&
      result.percent < 0
    )
    .map(result =>
      Math.abs(result.percent)
    );

  if (validDrops.length === 0) {
    return {
      level: 'NORMAL',
      reason: 'No decrease detected'
    };
  }

  const worstDrop = Math.max(
    ...validDrops
  );

  if (worstDrop > thresholds.critical) {
    return {
      level: 'CRITICAL',
      reason: `Worst drop: ${worstDrop}%`
    };
  }

  if (worstDrop >= thresholds.warning) {
    return {
      level: 'WARNING',
      reason: `Worst drop: ${worstDrop}%`
    };
  }

  if (worstDrop >= thresholds.attention) {
    return {
      level: 'ATTENTION',
      reason: `Worst drop: ${worstDrop}%`
    };
  }

  return {
    level: 'NORMAL',
    reason: `Worst drop: ${worstDrop}%`
  };
}

function severityRank(level) {
  const ranks = {
    CRITICAL: 4,
    WARNING: 3,
    ATTENTION: 2,
    NORMAL: 1
  };

  return ranks[level] || 0;
}

function formatPercent(change) {
  if (change.status === 'NEW_TRAFFIC') {
    return 'NEW';
  }

  if (change.status === 'NO_DATA') {
    return 'N/A';
  }

  if (change.percent === null) {
    return 'N/A';
  }

  const prefix =
    change.percent > 0
      ? '+'
      : '';

  return `${prefix}${change.percent}%`;
}

function formatLabel(value) {
  return String(value)
    .replace(/_/g, ' ')
    .replace(/\b\w/g, character =>
      character.toUpperCase()
    );
}

function getMetricLabel(
  monitor,
  metricName
) {
  return (
    monitor.metricLabels?.[metricName] ||
    formatLabel(metricName)
  );
}

function getReportSlug(monitor) {
  return (
    monitor.slug ||
    monitor.name
      .replace(/_event$/, '')
      .replace(/_response$/, '')
      .replace(/_/g, '-')
  );
}

function compare(monitorName) {
  ensureDirectories();

  const config = loadConfig();

  const monitor = getMonitorConfig(
    config,
    monitorName
  );

  const dimensions = monitor.dimensions;
  const metrics = monitor.metrics;

  const primaryMetric =
    monitor.primaryMetric ||
    metrics[0];

  if (!metrics.includes(primaryMetric)) {
    throw new Error(
      `primaryMetric "${primaryMetric}" không nằm trong metrics`
    );
  }

  const thresholds =
    getThresholds(monitor);

  const slug =
    getReportSlug(monitor);

  const displayName =
    monitor.displayName ||
    monitor.name;

  const data = {};

  for (const windowName of WINDOWS) {
    data[windowName] = loadWindow(
      monitorName,
      windowName
    );
  }

  const allKeys = new Set();

  for (const windowName of WINDOWS) {
    for (
      const record of
      data[windowName].records
    ) {
      allKeys.add(
        createKey(record, dimensions)
      );
    }
  }

  const indexed = {};

  for (const windowName of WINDOWS) {
    indexed[windowName] = new Map();

    for (
      const record of
      data[windowName].records
    ) {
      indexed[windowName].set(
        createKey(record, dimensions),
        record
      );
    }
  }

  const comparisons = [];

  for (const key of allKeys) {
    const dimensionValues =
      createEmptyRecordFromKey(
        key,
        dimensions
      );

    const currentRecord =
      indexed.current.get(key) || {};

    const previousRecord =
      indexed.previous.get(key) || {};

    const yesterdayRecord =
      indexed.yesterday.get(key) || {};

    const twoDaysRecord =
      indexed.two_days_ago.get(key) || {};

    const metricResults = {};

    for (const metric of metrics) {
      const current =
        toNumber(currentRecord[metric]);

      const previous =
        toNumber(previousRecord[metric]);

      const yesterday =
        toNumber(yesterdayRecord[metric]);

      const twoDaysAgo =
        toNumber(twoDaysRecord[metric]);

      const vsPrevious =
        calculateChange(
          current,
          previous
        );

      const vsYesterday =
        calculateChange(
          current,
          yesterday
        );

      const vsTwoDaysAgo =
        calculateChange(
          current,
          twoDaysAgo
        );

      const severity = getSeverity(
        current,
        [
          vsPrevious,
          vsYesterday,
          vsTwoDaysAgo
        ],
        thresholds
      );

      metricResults[metric] = {
        current,
        previous,
        yesterday,
        two_days_ago: twoDaysAgo,

        change: {
          vs_previous: vsPrevious,
          vs_yesterday: vsYesterday,
          vs_two_days_ago: vsTwoDaysAgo
        },

        severity
      };
    }

    const overallSeverity = metrics
      .map(metric =>
        metricResults[metric].severity
      )
      .sort(
        (a, b) =>
          severityRank(b.level) -
          severityRank(a.level)
      )[0];

    comparisons.push({
      ...dimensionValues,
      overall_severity: overallSeverity,
      metrics: metricResults
    });
  }

  comparisons.sort((a, b) => {
    const severityDifference =
      severityRank(
        b.overall_severity.level
      ) -
      severityRank(
        a.overall_severity.level
      );

    if (severityDifference !== 0) {
      return severityDifference;
    }

    return (
      b.metrics[primaryMetric].current -
      a.metrics[primaryMetric].current
    );
  });

  const summary = {
    total_rows: comparisons.length,

    critical: comparisons.filter(
      item =>
        item.overall_severity.level ===
        'CRITICAL'
    ).length,

    warning: comparisons.filter(
      item =>
        item.overall_severity.level ===
        'WARNING'
    ).length,

    attention: comparisons.filter(
      item =>
        item.overall_severity.level ===
        'ATTENTION'
    ).length,

    normal: comparisons.filter(
      item =>
        item.overall_severity.level ===
        'NORMAL'
    ).length
  };

  const output = {
    metadata: {
      monitor: monitorName,
      slug,
      displayName,
      generatedAtUtc:
        new Date().toISOString(),

      dimensions,
      metrics,
      primaryMetric,

      thresholds: {
        attention:
          `${thresholds.attention}% to below ` +
          `${thresholds.warning}% drop`,

        warning:
          `${thresholds.warning}% to ` +
          `${thresholds.critical}% drop`,

        critical:
          `Above ${thresholds.critical}% drop ` +
          'or current = 0'
      }
    },

    summary,
    comparisons
  };

  const timestamp = new Date()
    .toISOString()
    .replace(/[:.]/g, '-');

  const historyPath = path.join(
    REPORT_DIRECTORY,
    `${slug}-comparison-${timestamp}.json`
  );

  const latestPath = path.join(
    REPORT_DIRECTORY,
    `${slug}-comparison-latest.json`
  );

  fs.writeFileSync(
    historyPath,
    JSON.stringify(output, null, 2)
  );

  fs.writeFileSync(
    latestPath,
    JSON.stringify(output, null, 2)
  );

  console.log('');
  console.log(
    `🛡️ QA Sentinel — ${displayName} Comparison`
  );
  console.log(
    '=============================================='
  );
  console.log(
    `Total combinations: ${summary.total_rows}`
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
    `🟢 Normal: ${summary.normal}`
  );
  console.log(
    '=============================================='
  );

  const problems = comparisons.filter(
    item =>
      item.overall_severity.level !==
      'NORMAL'
  );

  if (problems.length === 0) {
    console.log(
      '\n✅ Không phát hiện bất thường.'
    );
  } else {
    console.log(
      '\nCác bất thường chính:\n'
    );

    for (const item of problems.slice(0, 20)) {
      const dimensionText = dimensions
        .map(dimension =>
          item[dimension]
        )
        .join(' | ');

      console.log(
        `${item.overall_severity.level} | ` +
        dimensionText
      );

      for (const metric of metrics) {
        const result =
          item.metrics[metric];

        const label =
          getMetricLabel(
            monitor,
            metric
          );

        console.log(
          `  ${label}: ${result.current} | ` +
          `Prev ${result.previous} ` +
          `(${formatPercent(
            result.change.vs_previous
          )}) | ` +
          `Yesterday ${result.yesterday} ` +
          `(${formatPercent(
            result.change.vs_yesterday
          )}) | ` +
          `2 days ${result.two_days_ago} ` +
          `(${formatPercent(
            result.change.vs_two_days_ago
          )})`
        );
      }

      console.log('');
    }
  }

  console.log(
    `✅ Report: ${latestPath}`
  );
}

const monitorName =
  process.argv[2];

if (!monitorName) {
  console.error(
    '\n❌ Thiếu monitor name.'
  );

  console.error(
    'Ví dụ: node compare-generic.js spin_event'
  );

  process.exit(1);
}

try {
  compare(monitorName);
} catch (error) {
  console.error(
    `\n❌ ${error.message}`
  );

  process.exit(1);
}