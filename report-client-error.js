const fs = require("fs");
const path = require("path");

require("dotenv").config();

const {
  sendSlackMessage,
  sendSlackDebugScreenshot
} = require("./engine/slack-notifier");

const monitorName =
  process.argv[2] || "client_error";

const config = require("./monitor-config.json");

const monitorConfig = config.monitors.find(
  m => m.name === monitorName
);

if (!monitorConfig) {
  throw new Error(
    `Monitor "${monitorName}" not found in monitor-config.json`
  );
}

const channelIdEnvKey =
  monitorConfig.debugChannelIdEnvKey;

const channelId =
  process.env[channelIdEnvKey];

const ROOT = __dirname;

function escapeSlackText(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function formatNumber(value) {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return "0";
  }

  return new Intl.NumberFormat("en-US").format(number);
}

const DATA_FILE = path.join(
  ROOT,
  "reports",
  "raw",
  `${monitorName}-current.json`
);

function loadData() {
  if (!fs.existsSync(DATA_FILE)) {
    throw new Error(
      `Data file not found: ${DATA_FILE}`
    );
  }

  const raw = fs
    .readFileSync(DATA_FILE, "utf8")
    .trim();

  if (!raw) {
    return [];
  }

  let data;

  try {
    data = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `Invalid JSON in ${path.basename(DATA_FILE)}: ${error.message}`
    );
  }

  if (Array.isArray(data)) {
    return data;
  }

  if (Array.isArray(data.records)) {
    return data.records;
  }

  throw new Error(
    `${path.basename(DATA_FILE)} must contain a "records" array`
  );
}

function getCheckedTime() {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Ho_Chi_Minh",
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date());
}

function buildSlackBlocks(rows) {

  const blocks = [];

  blocks.push({
    type: "header",
    text: {
      type: "plain_text",
      text: "📱 QA Sentinel - Client Error Report"
    }
  });

  blocks.push({
    type: "section",
    text: {
      type: "mrkdwn",
      text: "*Window:*\nLast complete hour"
    }
  });

  if (rows.length === 0) {

    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: "✅ No client errors detected."
      }
    });

    blocks.push({
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `🕒 ${getCheckedTime()} ICT`
        }
      ]
    });

    return blocks;
  }

  rows.sort(
    (a, b) =>
      Number(b.total_errors) -
      Number(a.total_errors)
  );

  const top10 = rows.slice(0, 10);

  const totalErrors =
    rows.reduce(
      (sum, row) =>
        sum + Number(row.total_errors || 0),
      0
    );

  top10.forEach((row, index) => {

    blocks.push({

      type: "section",

      text: {
        type: "mrkdwn",

        text:
`*${index + 1}. ${escapeSlackText(row.client_type || "Unknown")}*

${escapeSlackText(row.message || "Unknown")}

*Errors:* ${formatNumber(row.total_errors)}`
      }

    });

  });

  blocks.push({
    type: "divider"
  });

  blocks.push({
    type: "section",
    text: {
      type: "mrkdwn",
      text:
`*Total Errors:* ${formatNumber(totalErrors)}`
    }
  });

  blocks.push({
    type: "context",
    elements: [
      {
        type: "mrkdwn",
        text: `🕒 ${getCheckedTime()} ICT`
      }
    ]
  });

  return blocks;
}

async function main() {

  console.log(
    "📱 Building Client Error Report..."
  );

  const rows = loadData();

  const blocks =
    buildSlackBlocks(rows);

  await sendSlackMessage({

    webhookEnvKey:
      monitorConfig.notificationChannel,

    text:
      "QA Sentinel - Client Error Report",

    blocks

  });

  console.log("✅ Client Error Report sent.");

  // ============================================================
  // Upload screenshot (nếu có)
  // ============================================================

  const screenshotPath = path.join(
    ROOT,
    "reports",
    "client_error-current-latest.png"
  );

  if (!channelId) {

    console.warn(
      `⚠️ Missing channel id from ${channelIdEnvKey}`
    );

  } else if (!fs.existsSync(screenshotPath)) {

    console.warn(
      `⚠️ Screenshot not found: ${screenshotPath}`
    );

  } else {

    await sendSlackDebugScreenshot({

      channelId,

      imagePath: screenshotPath,

      monitorName:
        monitorConfig.displayName,

      windowName: "Current",

      errorMessage:
        "Client Error Report Screenshot",

      isError: false

    });

    console.log(
      "✅ Screenshot uploaded."
    );

  }

}

main()
  .then(() => {
    process.exit(0);
  })
  .catch(error => {
    console.error(
      `❌ Client Error Report failed: ${error.message}`
    );

    process.exit(1);
  });