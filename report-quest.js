const fs = require("fs");
const path = require("path");

require("dotenv").config();

const {
  sendSlackThreadedMessage
} = require("./engine/slack-notifier");

const monitorName =
  process.argv[2] || "quest";

const config =
  require("./monitor-config.json");

const monitorConfig =
  config.monitors.find(
    m => m.name === monitorName
  );

if (!monitorConfig) {
  throw new Error(
    `Monitor "${monitorName}" not found in monitor-config.json`
  );
}

const ROOT = __dirname;

const RAW_DIRECTORY =
  path.join(
    ROOT,
    "reports",
    "raw"
  );

function escapeSlackText(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function formatNumber(value) {
  const number =
    Number(value);

  if (!Number.isFinite(number)) {
    return "0";
  }

  return new Intl.NumberFormat(
    "en-US"
  ).format(number);
}

function formatPercent(
  current,
  previous
) {
  const currentNumber =
    Number(current || 0);

  const previousNumber =
    Number(previous || 0);

  if (
    !Number.isFinite(currentNumber) ||
    !Number.isFinite(previousNumber)
  ) {
    return "N/A";
  }

  if (previousNumber === 0) {
    if (currentNumber === 0) {
      return "0.0%";
    }

    return "NEW";
  }

  const change =
    (
      (currentNumber - previousNumber) /
      previousNumber
    ) * 100;

  const sign =
    change > 0
      ? "+"
      : "";

  return `${sign}${change.toFixed(1)}%`;
}

function getCheckedTime() {
  return new Intl.DateTimeFormat(
    "en-GB",
    {
      timeZone:
        "Asia/Ho_Chi_Minh",

      dateStyle:
        "medium",

      timeStyle:
        "short"
    }
  ).format(
    new Date()
  );
}

/*
 * ------------------------------------------------------------
 * Load raw monitor data
 * ------------------------------------------------------------
 */

function loadWindow(
  windowName
) {
  const filePath =
    path.join(
      RAW_DIRECTORY,
      `${monitorName}-${windowName}.json`
    );

  if (!fs.existsSync(filePath)) {
    console.warn(
      `⚠️ Missing ${windowName} data: ${filePath}`
    );

    return null;
  }

  const raw =
    fs.readFileSync(
      filePath,
      "utf8"
    ).trim();

  if (!raw) {
    return [];
  }

  let data;

  try {
    data =
      JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `Invalid JSON in ${path.basename(filePath)}: ${error.message}`
    );
  }

  if (Array.isArray(data)) {
    return data;
  }

  if (
    Array.isArray(
      data.records
    )
  ) {
    return data.records;
  }

  throw new Error(
    `${path.basename(filePath)} must contain a "records" array`
  );
}

/*
 * ------------------------------------------------------------
 * Normalize Quest rows
 * ------------------------------------------------------------
 */

function getQuestIndex(row) {
  return (
    row.quest_index ??
    row.quest ??
    row.quest_id ??
    "Unknown"
  );
}

function getVipTier(row) {
  return (
    row.vip_tier ??
    row.vip ??
    "Unknown"
  );
}

function getCompleted(row) {
  return Number(
    row.completed_quests ??
    row.completed ??
    0
  );
}

function getUsers(row) {
  return Number(
    row.unique_users ??
    row.users ??
    0
  );
}

function normalizeRows(
  rows
) {
  if (!Array.isArray(rows)) {
    return [];
  }

  return rows
    .map(row => ({
      questIndex:
        String(
          getQuestIndex(row)
        ),

      vipTier:
        String(
          getVipTier(row)
        ),

      completed:
        getCompleted(row),

      users:
        getUsers(row)
    }))
    .filter(row =>
      row.completed !== 0 ||
      row.users !== 0
    );
}

/*
 * ------------------------------------------------------------
 * Summary
 * ------------------------------------------------------------
 *
 * completed_quests can safely be summed.
 *
 * unique_users cannot be globally deduplicated from the
 * current Quest query because each row represents a
 * Quest x VIP combination.
 *
 * Therefore Users below means sum of unique_users
 * across combinations.
 */

function calculateSummary(
  rows
) {
  if (!Array.isArray(rows)) {
    return null;
  }

  return rows.reduce(
    (summary, row) => {
      summary.completed +=
        Number(
          row.completed || 0
        );

      summary.usersByCombo +=
        Number(
          row.users || 0
        );

      return summary;
    },
    {
      completed: 0,
      usersByCombo: 0
    }
  );
}

/*
 * ------------------------------------------------------------
 * Current Quest detail
 * ------------------------------------------------------------
 */

function sortRows(
  rows
) {
  return [...rows].sort(
    (a, b) => {
      const questCompare =
        Number(a.questIndex) -
        Number(b.questIndex);

      if (
        Number.isFinite(
          questCompare
        ) &&
        questCompare !== 0
      ) {
        return questCompare;
      }

      if (
        a.questIndex !==
        b.questIndex
      ) {
        return String(
          a.questIndex
        ).localeCompare(
          String(
            b.questIndex
          )
        );
      }

      const completedDifference =
        b.completed -
        a.completed;

      if (
        completedDifference !== 0
      ) {
        return completedDifference;
      }

      return (
        Number(b.vipTier) -
        Number(a.vipTier)
      );
    }
  );
}

function groupRowsByQuest(
  rows
) {
  const groups =
    new Map();

  const sortedRows =
    sortRows(rows);

  sortedRows.forEach(row => {
    if (
      !groups.has(
        row.questIndex
      )
    ) {
      groups.set(
        row.questIndex,
        []
      );
    }

    groups
      .get(row.questIndex)
      .push(row);
  });

  return groups;
}

function buildQuestDetailText(
  rows
) {
  if (
    !rows ||
    rows.length === 0
  ) {
    return [
      "🎯 *Current Quest Activity*",
      "",
      "No Quest activity detected."
    ].join("\n");
  }

  const groups =
    groupRowsByQuest(rows);

  const lines = [];

  lines.push(
    "🎯 *Current Quest Activity*"
  );

  lines.push("");

  for (
    const [
      questIndex,
      questRows
    ] of groups
  ) {
    lines.push(
      `*Quest ${escapeSlackText(questIndex)}*`
    );

    questRows.forEach(row => {
      const userLabel =
        row.users === 1
          ? "user"
          : "users";

      const completedLabel =
        row.completed === 1
          ? "completed"
          : "completed";

      lines.push(
        `• \`VIP ${escapeSlackText(row.vipTier)}\`  ` +
        `${formatNumber(row.completed)} ${completedLabel} ` +
        `• ${formatNumber(row.users)} ${userLabel}`
      );
    });

    lines.push("");
  }

  lines.push(
    "_Users are unique within each Quest/VIP combination._"
  );

  return lines.join(
    "\n"
  );
}

/*
 * ------------------------------------------------------------
 * Overall parent message
 * ------------------------------------------------------------
 */

function summaryValue(
  summary,
  field
) {
  if (!summary) {
    return "N/A";
  }

  return formatNumber(
    summary[field]
  );
}

function buildOverallBlocks({
  currentRows,
  previousRows,
  yesterdayRows,
  twoDaysAgoRows
}) {
  const current =
    calculateSummary(
      currentRows
    );

  const previous =
    calculateSummary(
      previousRows
    );

  const yesterday =
    calculateSummary(
      yesterdayRows
    );

  const twoDaysAgo =
    calculateSummary(
      twoDaysAgoRows
    );

  const currentCompleted =
    summaryValue(
      current,
      "completed"
    );

  const previousCompleted =
    summaryValue(
      previous,
      "completed"
    );

  const yesterdayCompleted =
    summaryValue(
      yesterday,
      "completed"
    );

  const twoDaysAgoCompleted =
    summaryValue(
      twoDaysAgo,
      "completed"
    );

  const currentUsers =
    summaryValue(
      current,
      "usersByCombo"
    );

  const previousUsers =
    summaryValue(
      previous,
      "usersByCombo"
    );

  const yesterdayUsers =
    summaryValue(
      yesterday,
      "usersByCombo"
    );

  const twoDaysAgoUsers =
    summaryValue(
      twoDaysAgo,
      "usersByCombo"
    );

  const completedChange =
    current && previous
      ? formatPercent(
          current.completed,
          previous.completed
        )
      : "N/A";

  const usersChange =
    current && previous
      ? formatPercent(
          current.usersByCombo,
          previous.usersByCombo
        )
      : "N/A";

  return [
    {
      type: "header",

      text: {
        type: "plain_text",

        text:
          "🎯 QA Sentinel - Quest Activity"
      }
    },

    {
      type: "section",

      text: {
        type: "mrkdwn",

        text:
          "*📊 Overall Quest Activity*"
      }
    },

    {
  type: "section",

  text: {
    type: "mrkdwn",

    text:
`\`\`\`
Metric              Current   Previous   Yesterday   2d Ago
------------------------------------------------------------
Completed           ${currentCompleted.padStart(7)}   ${previousCompleted.padStart(8)}   ${yesterdayCompleted.padStart(9)}   ${twoDaysAgoCompleted.padStart(7)}
Users               ${currentUsers.padStart(7)}   ${previousUsers.padStart(8)}   ${yesterdayUsers.padStart(9)}   ${twoDaysAgoUsers.padStart(7)}
\`\`\``
  }
},
    {
      type: "section",

      text: {
        type: "mrkdwn",

        text:
`*📉 vs Previous*

*Completed:* ${completedChange}
*Users:* ${usersChange}`
      }
    },

    {
      type: "section",

      text: {
        type: "mrkdwn",

        text:
          "💬 *View thread for Current Quest Activity.*"
      }
    },

    {
      type: "context",

      elements: [
        {
          type: "mrkdwn",

          text:
            `🕒 ${getCheckedTime()} ICT`
        }
      ]
    }
  ];
}

/*
 * ------------------------------------------------------------
 * Main
 * ------------------------------------------------------------
 */

async function main() {
  console.log(
    "🎯 Building Quest Report..."
  );

  const currentRows =
    normalizeRows(
      loadWindow(
        "current"
      )
    );

  const previousRows =
    normalizeRows(
      loadWindow(
        "previous"
      )
    );

  const yesterdayRows =
    normalizeRows(
      loadWindow(
        "yesterday"
      )
    );

  const twoDaysAgoRows =
    normalizeRows(
      loadWindow(
        "two_days_ago"
      )
    );

  console.log(
    `📊 Current combinations: ${currentRows.length}`
  );

  console.log(
    `📊 Previous combinations: ${previousRows.length}`
  );

  console.log(
    `📊 Yesterday combinations: ${yesterdayRows.length}`
  );

  console.log(
    `📊 2 days ago combinations: ${twoDaysAgoRows.length}`
  );

  /*
   * ----------------------------------------------------------
   * Parent
   * ----------------------------------------------------------
   */

  const parentBlocks =
    buildOverallBlocks({
      currentRows,
      previousRows,
      yesterdayRows,
      twoDaysAgoRows
    });

  /*
   * ----------------------------------------------------------
   * Thread
   * ----------------------------------------------------------
   */

  const threadText =
    buildQuestDetailText(
      currentRows
    );

  /*
   * ----------------------------------------------------------
   * Send parent + thread
   * ----------------------------------------------------------
   *
   * IMPORTANT:
   *
   * Quest uses:
   * SLACK_BOT_TOKEN
   * +
   * SLACK_CHANNEL_QUEST
   *
   * The notificationChannel webhook is intentionally
   * not used here because Incoming Webhooks do not expose
   * the message timestamp required for thread replies.
   */

  const result =
    await sendSlackThreadedMessage({
      botTokenEnvKey:
        "SLACK_BOT_TOKEN",

      channelIdEnvKey:
        monitorConfig.debugChannelIdEnvKey,

      parentText:
        "QA Sentinel - Quest Activity",

      parentBlocks,

      threadText,

      threadBlocks: undefined
    });

  console.log(
    "=============================================="
  );

  console.log(
    "🎯 Quest Report sent successfully."
  );

  console.log(
    `📌 Parent TS: ${result.parentTs}`
  );

  console.log(
    `🧵 Thread TS: ${result.threadTs}`
  );

  console.log(
    "=============================================="
  );
}

main()
  .then(() => {
    process.exit(0);
  })
  .catch(error => {
    console.error(
      `❌ Quest Report failed: ${error.message}`
    );

    process.exit(1);
  });