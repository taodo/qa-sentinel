const fs = require('fs');
const path = require('path');

const HISTORY_FILE = path.join(
  __dirname,
  '..',
  'history',
  'alert-history.json'
);

const DEFAULT_COOLDOWN_MINUTES = 60;

/**
 * Create the history directory and file
 * when they do not exist.
 */
function ensureHistoryFile() {
  const directory =
    path.dirname(HISTORY_FILE);

  fs.mkdirSync(directory, {
    recursive: true
  });

  if (!fs.existsSync(HISTORY_FILE)) {
    fs.writeFileSync(
      HISTORY_FILE,
      JSON.stringify({}, null, 2)
    );
  }
}

/**
 * Read alert history safely.
 */
function loadHistory() {
  ensureHistoryFile();

  try {
    return JSON.parse(
      fs.readFileSync(
        HISTORY_FILE,
        'utf8'
      )
    );
  } catch (error) {
    console.warn(
      '⚠️ Alert history is invalid. ' +
      'Starting with empty history.'
    );

    return {};
  }
}

/**
 * Save alert history.
 */
function saveHistory(history) {
  ensureHistoryFile();

  fs.writeFileSync(
    HISTORY_FILE,
    JSON.stringify(
      history,
      null,
      2
    )
  );
}

/**
 * Normalize a fingerprint value.
 */
function normalizeFingerprintValue(value) {
  return String(value ?? 'unknown')
    .trim()
    .toLowerCase();
}

/**
 * Sort dimensions to ensure that the same alert
 * always produces the same fingerprint.
 */
function buildDimensionFingerprint(
  dimensions = {}
) {
  const entries =
    Object.entries(dimensions)
      .filter(([, value]) => {
        return (
          value !== undefined &&
          value !== null &&
          value !== ''
        );
      })
      .sort(
        ([firstKey], [secondKey]) =>
          firstKey.localeCompare(
            secondKey
          )
      );

  if (entries.length === 0) {
    return 'no-dimensions';
  }

  return entries
    .map(([key, value]) => {
      return (
        `${normalizeFingerprintValue(key)}=` +
        `${normalizeFingerprintValue(value)}`
      );
    })
    .join('|');
}

/**
 * Build a unique fingerprint for a generic alert.
 *
 * Severity is intentionally excluded so that an
 * alert can be sent again immediately when its
 * severity changes.
 */
function buildFingerprint(alert) {
  const monitor =
    normalizeFingerprintValue(
      alert.monitor
    );

  const title =
    normalizeFingerprintValue(
      alert.title
    );

  const primaryMetric =
    normalizeFingerprintValue(
      alert.primary_metric
    );

  const dimensions =
    buildDimensionFingerprint(
      alert.dimensions
    );

  return [
    monitor,
    title,
    primaryMetric,
    dimensions
  ].join('|');
}

/**
 * Determine whether an alert should be sent.
 */
function shouldSendAlert(
  alert,
  cooldownMinutes =
    DEFAULT_COOLDOWN_MINUTES
) {
  const history =
    loadHistory();

  const key =
    buildFingerprint(alert);

  const previous =
    history[key];

  if (!previous) {
    return true;
  }

  /*
   * Send immediately when severity changes,
   * even during the cooldown period.
   */
  if (
    previous.severity !==
    alert.severity
  ) {
    return true;
  }

  const previousSentTime =
    new Date(
      previous.sentAt
    ).getTime();

  /*
   * Invalid historical timestamps should not
   * block a new alert.
   */
  if (
    !Number.isFinite(
      previousSentTime
    )
  ) {
    return true;
  }

  const elapsedMilliseconds =
    Date.now() -
    previousSentTime;

  const cooldownMilliseconds =
    cooldownMinutes *
    60 *
    1000;

  return (
    elapsedMilliseconds >
    cooldownMilliseconds
  );
}

/**
 * Save an alert after it has been sent.
 */
function recordAlert(alert) {
  const history =
    loadHistory();

  const key =
    buildFingerprint(alert);

  history[key] = {
    monitor:
      alert.monitor,

    title:
      alert.title,

    primaryMetric:
      alert.primary_metric,

    dimensions:
      alert.dimensions || {},

    severity:
      alert.severity,

    sentAt:
      new Date().toISOString()
  };

  saveHistory(history);
}

module.exports = {
  shouldSendAlert,
  recordAlert
};