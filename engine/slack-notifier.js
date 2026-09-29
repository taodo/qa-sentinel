const fs = require('fs');
const path = require('path');
const { WebClient } = require('@slack/web-api');

require('dotenv').config({
  path: path.join(
    __dirname,
    '..',
    '.env'
  )
});

const MAX_SLACK_BLOCKS = 50;

/**
 * Lấy Slack webhook URL từ tên biến trong .env.
 *
 * Ví dụ:
 * SLACK_WEBHOOK_SPINS
 * SLACK_WEBHOOK_PURCHASES
 * SLACK_WEBHOOK_AI_REVIEW
 */
function getWebhookUrl(webhookEnvKey) {
  if (!webhookEnvKey) {
    throw new Error(
      'Slack webhook environment key is required.'
    );
  }

  const webhookUrl =
    process.env[webhookEnvKey];

  if (!webhookUrl) {
    throw new Error(
      `Missing ${webhookEnvKey} in .env`
    );
  }

  if (
    !webhookUrl.startsWith(
      'https://hooks.slack.com/services/'
    )
  ) {
    throw new Error(
      `${webhookEnvKey} is not a valid Slack Incoming Webhook URL.`
    );
  }

  return webhookUrl;
}

/**
 * Validate Slack Block Kit blocks.
 *
 * @param {Array|undefined} blocks
 */
function validateSlackBlocks(blocks) {
  if (blocks === undefined) {
    return;
  }

  if (!Array.isArray(blocks)) {
    throw new Error(
      'Slack blocks must be an array.'
    );
  }

  if (blocks.length > MAX_SLACK_BLOCKS) {
    throw new Error(
      `Slack message contains ${blocks.length} blocks. ` +
      `Maximum supported is ${MAX_SLACK_BLOCKS}.`
    );
  }

  for (
    let index = 0;
    index < blocks.length;
    index += 1
  ) {
    const block =
      blocks[index];

    if (
      !block ||
      typeof block !== 'object'
    ) {
      throw new Error(
        `Slack block at index ${index} is invalid.`
      );
    }

    if (!block.type) {
      throw new Error(
        `Slack block at index ${index} has no type.`
      );
    }
  }
}

/**
 * Gửi message tới Slack Incoming Webhook.
 *
 * @param {Object} options
 * @param {string} options.webhookEnvKey
 * @param {string} [options.text]
 * @param {Array} [options.blocks]
 */
async function sendSlackMessage({
  webhookEnvKey,
  text,
  blocks
}) {
  if (!text && !blocks) {
    throw new Error(
      'Slack message must contain text or blocks.'
    );
  }

  validateSlackBlocks(blocks);

  const webhookUrl =
    getWebhookUrl(
      webhookEnvKey
    );

  const payload = {
    text:
      text ||
      'QA Sentinel notification'
  };

  if (
    Array.isArray(blocks) &&
    blocks.length > 0
  ) {
    payload.blocks =
      blocks;
  }

  const response =
    await fetch(
      webhookUrl,
      {
        method: 'POST',

        headers: {
          'Content-Type':
            'application/json'
        },

        body:
          JSON.stringify(
            payload
          )
      }
    );

  const responseBody =
    await response.text();

  if (!response.ok) {
    throw new Error(
      `Slack webhook failed: HTTP ` +
      `${response.status} — ` +
      responseBody
    );
  }

  if (
    responseBody.trim() !== 'ok'
  ) {
    throw new Error(
      `Unexpected Slack response: ` +
      responseBody
    );
  }

  return {
    success: true,
    webhookEnvKey,
    blockCount:
      Array.isArray(blocks)
        ? blocks.length
        : 0
  };
}

/**
 * Gửi AI Review tới channel Slack riêng.
 *
 * Webhook env:
 * SLACK_WEBHOOK_AI_REVIEW
 *
 * @param {Object} options
 * @param {string} [options.text]
 * @param {Array} options.blocks
 */
async function sendSlackAiReview({
  text,
  blocks
}) {
  return sendSlackMessage({
    webhookEnvKey:
      'SLACK_WEBHOOK_AI_REVIEW',

    text:
      text ||
      'QA Sentinel AI Review',

    blocks
  });
}

/**
 * Upload ảnh debug tới Slack channel.
 *
 * @param {Object} options
 * @param {string} options.channelId
 * @param {string} options.imagePath
 * @param {string} options.monitorName
 * @param {string} options.errorMessage
 * @param {string} options.windowName
 */
async function sendSlackDebugScreenshot({
  channelId,
  imagePath,
  monitorName,
  errorMessage,
  windowName
}) {
  const botToken =
    process.env.SLACK_BOT_TOKEN;

  if (!botToken) {
    throw new Error(
      'Missing SLACK_BOT_TOKEN in .env'
    );
  }

  if (!channelId) {
    throw new Error(
      'Slack debug channel ID is required.'
    );
  }

  if (!imagePath) {
    throw new Error(
      'Debug screenshot path is required.'
    );
  }

  if (!fs.existsSync(imagePath)) {
    throw new Error(
      `Debug screenshot not found: ${imagePath}`
    );
  }

  const slackClient =
    new WebClient(
      botToken
    );

  const safeMonitorName =
    monitorName ||
    'Unknown Monitor';

  const safeWindowName =
    windowName ||
    'Unknown';

  const safeErrorMessage =
    errorMessage ||
    'Unknown error';

  const initialComment = [
    '❌ *QA Sentinel — Monitor Failed*',
    '',
    `*Monitor:* ${safeMonitorName}`,
    `*Window:* ${safeWindowName}`,
    `*Reason:* ${safeErrorMessage}`
  ].join('\n');

  const result =
    await slackClient.filesUploadV2({
      channel_id:
        channelId,

      file:
        imagePath,

      filename:
        path.basename(
          imagePath
        ),

      title:
        `${safeMonitorName} Debug Screenshot`,

      initial_comment:
        initialComment
    });

  console.log(
    `✅ Debug screenshot sent for ${safeMonitorName}.`
  );

  return result;
}

/**
 * Gửi một Slack message và một reply vào thread của chính message đó.
 *
 * Dùng Slack Web API thay vì Incoming Webhook vì Web API
 * trả về message timestamp (ts), cần thiết để tạo thread.
 *
 * @param {Object} options
 * @param {string} options.botTokenEnvKey
 * @param {string} options.channelIdEnvKey
 * @param {string} [options.parentText]
 * @param {Array} [options.parentBlocks]
 * @param {string} [options.threadText]
 * @param {Array} [options.threadBlocks]
 */
async function sendSlackThreadedMessage({
  botTokenEnvKey = 'SLACK_BOT_TOKEN',
  channelIdEnvKey,
  parentText,
  parentBlocks,
  threadText,
  threadBlocks
}) {
  if (!channelIdEnvKey) {
    throw new Error(
      'Slack channel ID environment key is required.'
    );
  }

  const botToken =
    process.env[botTokenEnvKey];

  if (!botToken) {
    throw new Error(
      `Missing ${botTokenEnvKey} in .env`
    );
  }

  const channelId =
    process.env[channelIdEnvKey];

  if (!channelId) {
    throw new Error(
      `Missing ${channelIdEnvKey} in .env`
    );
  }

  if (!parentText && !parentBlocks) {
    throw new Error(
      'Parent Slack message must contain text or blocks.'
    );
  }

  if (!threadText && !threadBlocks) {
    throw new Error(
      'Thread Slack message must contain text or blocks.'
    );
  }

  validateSlackBlocks(
    parentBlocks
  );

  validateSlackBlocks(
    threadBlocks
  );

  const slackClient =
    new WebClient(
      botToken
    );

  /*
   * ----------------------------------------------------------
   * Parent message
   * ----------------------------------------------------------
   */

  const parentPayload = {
    channel:
      channelId,

    text:
      parentText ||
      'QA Sentinel notification'
  };

  if (
    Array.isArray(parentBlocks) &&
    parentBlocks.length > 0
  ) {
    parentPayload.blocks =
      parentBlocks;
  }

  const parentResult =
    await slackClient.chat.postMessage(
      parentPayload
    );

  if (
    !parentResult ||
    !parentResult.ok ||
    !parentResult.ts
  ) {
    throw new Error(
      'Slack parent message failed: ' +
      JSON.stringify(parentResult)
    );
  }

  console.log(
    `✅ Slack parent message sent. ts=${parentResult.ts}`
  );

  /*
   * ----------------------------------------------------------
   * Thread reply
   * ----------------------------------------------------------
   */

  const threadPayload = {
    channel:
      channelId,

    thread_ts:
      parentResult.ts,

    text:
      threadText ||
      'QA Sentinel thread'
  };

  if (
    Array.isArray(threadBlocks) &&
    threadBlocks.length > 0
  ) {
    threadPayload.blocks =
      threadBlocks;
  }

  const threadResult =
    await slackClient.chat.postMessage(
      threadPayload
    );

  if (
    !threadResult ||
    !threadResult.ok
  ) {
    throw new Error(
      'Slack thread message failed: ' +
      JSON.stringify(threadResult)
    );
  }

  console.log(
    `✅ Slack thread reply sent. ts=${threadResult.ts}`
  );

  return {
    success: true,

    channelId,

    parentTs:
      parentResult.ts,

    threadTs:
      threadResult.ts,

    parentResult,

    threadResult
  };
}
/**
 * Send a manual review message using the Slack Bot.
 *
 * Returns the message timestamp so files can be uploaded
 * into its thread.
 */
async function sendSlackManualReviewMessage({
  channelId,
  monitorName,
  comparisonFileName
}) {
  const botToken =
    process.env.SLACK_BOT_TOKEN;

  if (!botToken) {
    throw new Error(
      'Missing SLACK_BOT_TOKEN in .env'
    );
  }

  if (!channelId) {
    throw new Error(
      'Slack channel ID is required.'
    );
  }

  const slackClient =
    new WebClient(botToken);

  const result =
    await slackClient.chat.postMessage({
      channel: channelId,

      text:
        `QA Sentinel - ${monitorName} Manual Review`,

      blocks: [
        {
          type: 'header',
          text: {
            type: 'plain_text',
            text:
              `📊 QA Sentinel - ${monitorName}`
          }
        },

        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text:
              '*Manual Review Required*\n' +
              'Comparison results have been generated. ' +
              'Please review the comparison file in this thread.'
          }
        },

        {
          type: 'context',
          elements: [
            {
              type: 'mrkdwn',
              text:
                `📎 ${comparisonFileName}`
            }
          ]
        }
      ]
    });

  return {
    channelId: result.channel,
    threadTs: result.ts
  };
}

/**
 * Upload a comparison file into an existing Slack thread.
 */
async function sendSlackComparisonFile({
  channelId,
  threadTs,
  filePath,
  monitorName
}) {
  const botToken =
    process.env.SLACK_BOT_TOKEN;

  if (!botToken) {
    throw new Error(
      'Missing SLACK_BOT_TOKEN in .env'
    );
  }

  if (!channelId || !threadTs) {
    throw new Error(
      'Slack channel ID and thread timestamp are required.'
    );
  }

  if (!fs.existsSync(filePath)) {
    throw new Error(
      `Comparison file not found: ${filePath}`
    );
  }

  const slackClient =
    new WebClient(botToken);

  const result =
    await slackClient.filesUploadV2({
      channel_id: channelId,

      thread_ts: threadTs,

      file: filePath,

      filename:
        path.basename(filePath),

      title:
        `${monitorName} Comparison`,

      initial_comment:
        '📎 *Comparison data for manual review*'
    });

  return result;
}
/**
 * Send a parent Slack message and optionally a reply in its thread.
 * Uses the Slack Bot API because Incoming Webhooks do not reliably
 * return the parent message timestamp needed for thread replies.
 */

module.exports = {
  getWebhookUrl,
  validateSlackBlocks,
  sendSlackMessage,
  sendSlackThreadedMessage,
  sendSlackAiReview,
  sendSlackDebugScreenshot,
  sendSlackManualReviewMessage,
  sendSlackComparisonFile
};
/**
 * Cho phép test trực tiếp:
 *
 * node engine/slack-notifier.js
 * node engine/slack-notifier.js SLACK_WEBHOOK_SPINS
 * node engine/slack-notifier.js SLACK_WEBHOOK_AI_REVIEW
 */
if (require.main === module) {
  const webhookEnvKey =
    process.argv[2] ||
    'SLACK_WEBHOOK_SPINS';

  const testMessage = [
    '✅ *QA Sentinel Slack Test*',
    '',
    `Channel config: \`${webhookEnvKey}\``,
    'Slack Incoming Webhook is working.'
  ].join('\n');

  sendSlackMessage({
    webhookEnvKey,
    text:
      testMessage
  })
    .then(() => {
      console.log(
        `✅ Slack test sent successfully via ${webhookEnvKey}.`
      );
    })
    .catch(error => {
      console.error(
        `❌ Slack test failed: ${error.message}`
      );

      process.exitCode = 1;
    });
}