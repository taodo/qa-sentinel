const fs = require('fs');
const path = require('path');

require('dotenv').config();

const {
  ZipArchive
} = require('archiver');

const {
  WebClient
} = require('@slack/web-api');

const ROOT = __dirname;

const config =
  require('./monitor-config.json');


function getCheckedTime() {
  return new Intl.DateTimeFormat(
    'en-GB',
    {
      timeZone: 'Asia/Ho_Chi_Minh',
      dateStyle: 'medium',
      timeStyle: 'short'
    }
  ).format(new Date());
}


/*
 * Collect files for Manual Review.
 *
 * - Standard monitors with compareEnabled:
 *   Upload the latest comparison artifact.
 *
 * - Client Error:
 *   No comparison is needed, so upload
 *   the latest raw result instead.
 */
function getReviewFiles() {
  const comparisonDir =
    path.join(
      ROOT,
      'reports',
      'comparison'
    );

  const rawDir =
    path.join(
      ROOT,
      'reports',
      'raw'
    );

  return config.monitors
    .filter(
      monitor =>
        monitor.enabled === true
    )
    .map(monitor => {
      const slug =
        monitor.slug ||
        monitor.name;

      /*
       * Standard monitors:
       * Upload the latest comparison artifact.
       */
      if (monitor.compareEnabled === true) {
        const filePath =
          path.join(
            comparisonDir,
            `${slug}-comparison-latest.json`
          );

        return {
          monitor,
          filePath,
          fileType: 'comparison',
          exists:
            fs.existsSync(filePath)
        };
      }

      /*
       * Client Error:
       * No comparison needed.
       * Upload the latest raw result instead.
       */
      if (monitor.name === 'client_error') {
        const filePath =
          path.join(
            rawDir,
            `${monitor.name}-current.json`
          );

        return {
          monitor,
          filePath,
          fileType: 'result',
          exists:
            fs.existsSync(filePath)
        };
      }

      /*
       * Other monitors without comparison
       * are not included in Manual Review.
       */
      return null;
    })
    .filter(Boolean);
}


/*
 * Create a ZIP archive containing all
 * available Manual Review artifacts.
 */
function createZipArchive(files, outputPath) {
  return new Promise((resolve, reject) => {
    const output =
      fs.createWriteStream(outputPath);

    const archive =
  new ZipArchive({
    zlib: {
      level: 9
    }
  });

    output.on(
      'close',
      () => {
        resolve();
      }
    );

    output.on(
      'error',
      error => {
        reject(error);
      }
    );

    archive.on(
      'error',
      error => {
        reject(error);
      }
    );

    archive.pipe(output);

    for (const item of files) {
      archive.file(
        item.filePath,
        {
          name:
            path.basename(item.filePath)
        }
      );
    }

    archive.finalize();
  });
}


async function main() {
  const botToken =
    process.env.SLACK_BOT_TOKEN;

  if (!botToken) {
    throw new Error(
      'Missing SLACK_BOT_TOKEN in .env'
    );
  }

  /*
   * Use the existing AI Review channel as the
   * central hub for manual monitor reviews.
   */
  const channelId =
    process.env.SLACK_CHANNEL_MANUAL_REVIEW;

  if (!channelId) {
    throw new Error(
      'Missing SLACK_CHANNEL_MANUAL_REVIEW in .env'
    );
  }

  const reviewFiles =
    getReviewFiles();

  const availableFiles =
    reviewFiles.filter(
      item => item.exists
    );

  if (availableFiles.length === 0) {
    console.log(
      '⏭ No review files available for manual review.'
    );

    return;
  }

  const slackClient =
    new WebClient(botToken);

  const monitorNames =
    availableFiles
      .map(
        item =>
          item.monitor.displayName ||
          item.monitor.name
      )
      .join(', ');

  console.log(
    '📊 Sending combined Manual Review summary...'
  );

  /*
   * Send the parent message first.
   * The ZIP will be uploaded into its thread.
   */
  const parentResult =
    await slackClient.chat.postMessage({
      channel: channelId,

      text:
        'QA Sentinel - Manual Review',

      blocks: [
        {
          type: 'header',

          text: {
            type: 'plain_text',

            text:
              '📊 QA Sentinel — Manual Review'
          }
        },

        {
          type: 'section',

          text: {
            type: 'mrkdwn',

            text:
              '*Automated monitoring completed.*\n' +
              'AI review is currently disabled. ' +
              'Please review the monitoring artifacts attached in this thread.'
          }
        },

        {
          type: 'section',

          fields: [
            {
              type: 'mrkdwn',

              text:
                `*Monitors:*\n${availableFiles.length}`
            },

            {
              type: 'mrkdwn',

              text:
                `*Files:*\n${availableFiles.length}`
            }
          ]
        },

        {
          type: 'context',

          elements: [
            {
              type: 'mrkdwn',

              text:
                `📋 ${monitorNames}`
            },

            {
              type: 'mrkdwn',

              text:
                `🕒 ${getCheckedTime()} ICT`
            }
          ]
        }
      ]
    });

  if (
    !parentResult ||
    !parentResult.ok ||
    !parentResult.ts
  ) {
    throw new Error(
      'Failed to send Manual Review parent message.'
    );
  }

  console.log(
    `✅ Manual Review summary sent. ts=${parentResult.ts}`
  );


  /*
   * Create a temporary ZIP containing all artifacts.
   */
  const timestamp =
    new Date()
      .toISOString()
      .replace(/[:.]/g, '-');

  const zipPath =
    path.join(
      ROOT,
      'reports',
      `qa-sentinel-manual-review-${timestamp}.zip`
    );

  try {
    console.log(
      `📦 Creating ZIP with ${availableFiles.length} files...`
    );

    await createZipArchive(
      availableFiles,
      zipPath
    );

    console.log(
      '📎 Uploading combined ZIP file...'
    );

    await slackClient.filesUploadV2({
      channel_id:
        channelId,

      thread_ts:
        parentResult.ts,

      file:
        zipPath,

      filename:
        path.basename(zipPath),

      title:
        'QA Sentinel Manual Review Files',

      initial_comment:
        `📦 *Manual review artifacts* (${availableFiles.length} files)`
    });

    console.log(
      '  ✅ Combined ZIP uploaded.'
    );

  } finally {
    /*
     * Always try to remove the temporary ZIP.
     * This prevents reports/ from accumulating
     * old ZIP files even if Slack upload fails.
     */
    if (fs.existsSync(zipPath)) {
      try {
        fs.unlinkSync(zipPath);

        console.log(
          '🧹 Temporary ZIP removed.'
        );

      } catch (error) {
        console.warn(
          `⚠️ Could not remove temporary ZIP: ${error.message}`
        );
      }
    }
  }


  /*
   * Report missing expected artifacts without
   * failing the entire Manual Review process.
   */
  const missingFiles =
    reviewFiles.filter(
      item => !item.exists
    );

  if (missingFiles.length > 0) {
    console.warn(
      `⚠️ ${missingFiles.length} review file(s) not found:`
    );

    for (const item of missingFiles) {
      console.warn(
        `   - ${item.monitor.displayName || item.monitor.name}`
      );
    }
  }

  console.log(
    '✅ Combined Manual Review sent.'
  );
}


main()
  .then(() => {
    process.exit(0);
  })
  .catch(error => {
    console.error(
      `❌ Manual Review failed: ${error.message}`
    );

    process.exit(1);
  });