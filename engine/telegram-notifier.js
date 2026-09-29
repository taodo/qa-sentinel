require("dotenv").config();

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

async function sendTelegramMessage(message) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!botToken) {
    throw new Error("Missing TELEGRAM_BOT_TOKEN in .env");
  }

  if (!chatId) {
    throw new Error("Missing TELEGRAM_CHAT_ID in .env");
  }

  const url =
    `https://api.telegram.org/bot${botToken}/sendMessage`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      chat_id: chatId,
      text: message,
      parse_mode: "HTML",
      disable_web_page_preview: true,
    }),
  });

  const result = await response.json();

  if (!response.ok || !result.ok) {
    throw new Error(
      `Telegram API error: ${JSON.stringify(result)}`
    );
  }

  console.log("✅ Telegram notification sent");

  return result;
}

function getSeverityEmoji(severity) {
  const emojis = {
    NORMAL: "🟢",
    ATTENTION: "🟡",
    WARNING: "🟠",
    CRITICAL: "🔴",
  };

  return (
    emojis[String(severity ?? "").toUpperCase()] ??
    "⚪️"
  );
}

function formatNumber(value) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return "N/A";
  }

  const number = Number(value);

  if (!Number.isFinite(number)) {
    return escapeHtml(value);
  }

  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 2,
  }).format(number);
}

function formatLabel(value) {
  return String(value ?? "")
    .replaceAll("_", " ")
    .replaceAll("-", " ")
    .replace(/\b\w/g, (character) =>
      character.toUpperCase()
    );
}

function getCheckedAt() {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Ho_Chi_Minh",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date());
}

function getWindowLabel(windowName) {
  const labels = {
    previous: "previous hour",
    previous_hour: "previous hour",
    yesterday: "same hour yesterday",
    two_days_ago: "same hour two days ago",
    baseline: "comparison baseline",
  };

  return (
    labels[windowName] ??
    formatLabel(windowName || "comparison baseline")
  );
}

function getMonitorTitle(alert) {
  return (
    alert.monitor_title ??
    alert.monitor_name ??
    alert.title ??
    formatLabel(alert.monitor_id ?? "Generic Monitor")
  );
}

function getMetricLabel(metricName, metric = {}) {
  return (
    metric.label ??
    metric.display_name ??
    formatLabel(metricName)
  );
}

function getMetricWindowValue(metric, windowName) {
  const aliases = {
    current: [
      "current",
      "current_value",
      "currentValue",
    ],

    previous: [
      "previous",
      "previous_hour",
      "previous_value",
      "previousValue",
    ],

    yesterday: [
      "yesterday",
      "yesterday_value",
      "yesterdayValue",
    ],

    two_days_ago: [
      "two_days_ago",
      "twoDaysAgo",
      "two_days_ago_value",
      "twoDaysAgoValue",
    ],
  };

  for (const key of aliases[windowName] ?? []) {
    if (
      Object.prototype.hasOwnProperty.call(metric, key)
    ) {
      return metric[key];
    }
  }

  return undefined;
}

function formatDimensionBlock(dimensions = {}) {
  const entries = Object.entries(dimensions).filter(
    ([, value]) =>
      value !== null &&
      value !== undefined &&
      value !== ""
  );

  if (entries.length === 0) {
    return [
      "<b>Scope:</b> All traffic",
    ];
  }

  return entries.map(([key, value]) => {
    const label = formatLabel(key);

    return (
      `<b>${escapeHtml(label)}:</b> ` +
      `${escapeHtml(value)}`
    );
  });
}

function formatMetricBlock(metrics = {}) {
  const entries = Object.entries(metrics);

  if (entries.length === 0) {
    return [
      "📊 <b>Metrics</b>",
      "No metric data available.",
      "",
    ];
  }

  const sections = [];

  for (const [metricName, metricValue] of entries) {
    const metric =
      metricValue &&
      typeof metricValue === "object" &&
      !Array.isArray(metricValue)
        ? metricValue
        : {
            current: metricValue,
          };

    const label =
      getMetricLabel(metricName, metric);

    const current =
      getMetricWindowValue(metric, "current");

    const previous =
      getMetricWindowValue(metric, "previous");

    const yesterday =
      getMetricWindowValue(metric, "yesterday");

    const twoDaysAgo =
      getMetricWindowValue(
        metric,
        "two_days_ago"
      );

    sections.push(
      `📊 <b>${escapeHtml(label)}</b>`,
      `<b>Current:</b> ${formatNumber(current)}`,
      `<b>Previous hour:</b> ${formatNumber(
        previous
      )}`,
      `<b>Yesterday:</b> ${formatNumber(
        yesterday
      )}`,
      `<b>Two days ago:</b> ${formatNumber(
        twoDaysAgo
      )}`,
      ""
    );
  }

  return sections;
}

function getPrimaryMetric(alert) {
  const metrics = alert.metrics ?? {};
  const primaryMetricName =
    alert.primary_metric ??
    alert.primaryMetric ??
    Object.keys(metrics)[0];

  if (!primaryMetricName) {
    return {
      name: "metric",
      label: "Metric",
      data: {},
    };
  }

  const rawMetric =
    metrics[primaryMetricName];

  const metric =
    rawMetric &&
    typeof rawMetric === "object" &&
    !Array.isArray(rawMetric)
      ? rawMetric
      : {
          current: rawMetric,
        };

  return {
    name: primaryMetricName,
    label: getMetricLabel(
      primaryMetricName,
      metric
    ),
    data: metric,
  };
}

function getDropPercentage(alert, primaryMetric) {
  const candidates = [
    alert.drop_percentage,
    alert.dropPercentage,
    primaryMetric?.data?.drop_percentage,
    primaryMetric?.data?.dropPercentage,
    primaryMetric?.data?.percentage_change,
    primaryMetric?.data?.percentageChange,
  ];

  for (const value of candidates) {
    const number = Number(value);

    if (Number.isFinite(number)) {
      return number;
    }
  }

  return null;
}

function buildDetectionText(alert) {
  const primaryMetric =
    getPrimaryMetric(alert);

  const dropPercentage =
    getDropPercentage(alert, primaryMetric);

  const dropText =
    dropPercentage === null
      ? "N/A"
      : `${Math.abs(dropPercentage).toFixed(1)}%`;

  const dropWindow =
    getWindowLabel(
      alert.drop_window ??
      alert.dropWindow ??
      primaryMetric.data.drop_window ??
      primaryMetric.data.dropWindow ??
      "baseline"
    );

  const direction =
    String(
      alert.direction ??
      primaryMetric.data.direction ??
      "dropped"
    ).toLowerCase();

  const supportedDirections = {
    drop: "dropped",
    dropped: "dropped",
    decrease: "decreased",
    decreased: "decreased",
    increase: "increased",
    increased: "increased",
    spike: "spiked",
    spiked: "spiked",
  };

  const directionLabel =
    supportedDirections[direction] ??
    direction;

  return (
    `<b>${escapeHtml(primaryMetric.label)}</b> ` +
    `${escapeHtml(directionLabel)} ` +
    `<b>${escapeHtml(dropText)}</b> compared with ` +
    `${escapeHtml(dropWindow)}.`
  );
}

function buildAlertMessage(alert = {}) {
  const severity =
    String(alert.severity ?? "ATTENTION")
      .toUpperCase();

  const emoji =
    getSeverityEmoji(severity);

  const monitorTitle =
    getMonitorTitle(alert);

  const dimensions =
    alert.dimensions ?? {};

  const metrics =
    alert.metrics ?? {};

  const reason =
    alert.reason ??
    alert.message ??
    "An abnormal metric change was detected.";

  const recommendation =
    alert.recommendation ??
    alert.suggested_check ??
    alert.suggestedCheck ??
    "Review the related traffic, errors, and recent changes in Splunk.";

  const checkedAt =
    alert.checked_at ??
    alert.checkedAt ??
    getCheckedAt();

  return [
    "🛡 <b>QA Sentinel</b>",
    "",
    `${emoji} <b>${escapeHtml(severity)}</b>`,
    `<b>${escapeHtml(monitorTitle)}</b>`,
    "",
    "━━━━━━━━━━━━━━",
    "",
    ...formatDimensionBlock(dimensions),
    "",
    "━━━━━━━━━━━━━━",
    "",
    ...formatMetricBlock(metrics),
    "━━━━━━━━━━━━━━",
    "",
    "📉 <b>Detected</b>",
    buildDetectionText(alert),
    "",
    `<b>Reason:</b> ${escapeHtml(reason)}`,
    "",
    "🔎 <b>Suggested check</b>",
    escapeHtml(recommendation),
    "",
    `🕒 ${escapeHtml(checkedAt)} ICT`,
  ].join("\n");
}

async function sendAlert(alert) {
  const message =
    buildAlertMessage(alert);

  return sendTelegramMessage(message);
}

/*
 * Backward-compatible aliases.
 *
 * These can be removed later after confirming
 * no other file still imports the old Spin functions.
 */
function buildSpinAlertMessage(alert) {
  return buildAlertMessage(alert);
}

async function sendSpinAlert(alert) {
  return sendAlert(alert);
}

module.exports = {
  sendTelegramMessage,
  buildAlertMessage,
  sendAlert,

  formatDimensionBlock,
  formatMetricBlock,
  formatNumber,
  formatLabel,
  escapeHtml,

  // Backward compatibility
  buildSpinAlertMessage,
  sendSpinAlert,
};