const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
require('dotenv').config({
  path: path.join(
    __dirname,
    '.env'
  )
});

const ROOT = __dirname;

const CONFIG_FILE = path.join(
  ROOT,
  'monitor-config.json'
);

const AI_REVIEW_SKIP_EXIT_CODE = 10;

/*
 * Knowledge JSON is intentionally not rebuilt here.
 *
 * Run this manually only when the Excel knowledge base changes:
 *
 * node engine/build-knowledge.js
 */
const AI_PIPELINE = [
  {
    name: 'Build AI Review Input',
    script: 'engine/build-ai-review-input.js'
  },
  {
    name: 'Build AI Prompt',
    script: 'engine/prompt-builder.js'
  },
  {
    name: 'AI Reviewer',
    script: 'engine/ai-reviewer.js',
    allowSkipExitCode: true
  },
  {
    name: 'AI Validator',
    script: 'engine/ai-validator.js'
  },
  {
    name: 'AI Memory',
    script: 'engine/ai-memory.js'
  },
  {
    name: 'Slack AI Reporter',
    script: 'engine/slack-ai-reporter.js'
  }
];

function sleep(ms) {
  return new Promise(resolve =>
    setTimeout(resolve, ms)
  );
}

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

function loadConfig() {
  if (!fs.existsSync(CONFIG_FILE)) {
    throw new Error(
      'Không tìm thấy monitor-config.json'
    );
  }

  const rawContent = fs
    .readFileSync(
      CONFIG_FILE,
      'utf8'
    )
    .trim();

  if (!rawContent) {
    throw new Error(
      'monitor-config.json đang rỗng'
    );
  }

  let config;

  try {
    config = JSON.parse(
      rawContent
    );
  } catch (error) {
    throw new Error(
      `monitor-config.json không hợp lệ: ${error.message}`
    );
  }

  if (!Array.isArray(config.monitors)) {
    throw new Error(
      'monitor-config.json phải có field "monitors" dạng array'
    );
  }

  return config;
}

function getMonitorSlug(monitor) {
  if (monitor.slug) {
    return monitor.slug;
  }

  return monitor.name
    .replace(/_event$/, '')
    .replace(/_response$/, '')
    .replace(/_/g, '-');
}

function buildPipeline(
  config,
  monitor
) {
  const defaults =
    config.defaults || {};

  return {
    collector: {
      enabled:
        monitor.collectorEnabled !== false,

      script:
        monitor.collectorScript ||
        defaults.collectorScript ||
        'run-multi-window.js',

      args:
        monitor.collectorArgs ||
        [monitor.name]
    },

    comparator: {
      enabled:
        monitor.compareEnabled !== false,

      script:
        monitor.compareScript ||
        defaults.compareScript ||
        'compare-generic.js',

      args:
        monitor.compareArgs ||
        [monitor.name]
    },

    alert: {
      enabled:
        monitor.alertEnabled === true,

      script:
        monitor.alertScript ||
        defaults.alertScript ||
        'smart-alert.js',

      args:
        monitor.alertArgs ||
        [monitor.name]
    },

    report: {
      enabled:
        monitor.reportEnabled === true,

      script:
        monitor.reportScript ||
        defaults.reportScript ||
        'report-client-error.js',

      args:
        monitor.reportArgs ||
        [monitor.name]
    }
  };
}

function runScript({
  scriptName,
  args = [],
  monitorName,
  stepName,
  required = true
}) {
  return new Promise(
    (resolve, reject) => {
      const scriptPath =
        path.join(
          ROOT,
          scriptName
        );

      if (!fs.existsSync(scriptPath)) {
        const message =
          `Không tìm thấy ${stepName} script: ${scriptName}`;

        if (required) {
          reject(
            new Error(message)
          );
        } else {
          console.log(
            `⏭ ${message}. Bỏ qua bước này.`
          );

          resolve({
            skipped: true,
            reason: message
          });
        }

        return;
      }

      console.log('');
      console.log(
        '--------------------------------------------------'
      );
      console.log(
        `▶ ${monitorName} · ${stepName}`
      );
      console.log(
        `node ${scriptName} ${args.join(' ')}`
      );
      console.log(
        '--------------------------------------------------'
      );

      const child = spawn(
        process.execPath,
        [scriptPath, ...args],
        {
          cwd: ROOT,
          env: process.env,
          stdio: 'inherit'
        }
      );

      child.on(
        'error',
        error => {
          reject(
            new Error(
              `Không thể chạy ${scriptName}: ${error.message}`
            )
          );
        }
      );

      child.on(
        'close',
        exitCode => {
          if (exitCode === 0) {
            resolve({
              skipped: false
            });

            return;
          }

          reject(
            new Error(
              `${scriptName} thất bại với exit code ${exitCode}`
            )
          );
        }
      );
    }
  );
}

/*
 * AI scripts need slightly different exit handling.
 *
 * Exit code:
 *
 * 0  = successful step
 * 10 = AI review intentionally skipped
 *      because the configured review condition was not met
 * other = failure
 */
function runAiScript({
  stepName,
  scriptName,
  allowSkipExitCode = false
}) {
  return new Promise(
    (resolve, reject) => {
      const scriptPath =
        path.join(
          ROOT,
          scriptName
        );

      if (!fs.existsSync(scriptPath)) {
        reject(
          new Error(
            `Không tìm thấy AI script: ${scriptName}`
          )
        );

        return;
      }

      console.log('');
      console.log(
        '--------------------------------------------------'
      );
      console.log(
        `🤖 AI Pipeline · ${stepName}`
      );
      console.log(
        `node ${scriptName}`
      );
      console.log(
        '--------------------------------------------------'
      );

      const child = spawn(
        process.execPath,
        [scriptPath],
        {
          cwd: ROOT,
          env: process.env,
          stdio: 'inherit'
        }
      );

      child.on(
        'error',
        error => {
          reject(
            new Error(
              `Không thể chạy ${scriptName}: ${error.message}`
            )
          );
        }
      );

      child.on(
        'close',
        exitCode => {
          if (exitCode === 0) {
            resolve({
              success: true,
              skipped: false,
              exitCode
            });

            return;
          }

          if (
            allowSkipExitCode &&
            exitCode ===
              AI_REVIEW_SKIP_EXIT_CODE
          ) {
            resolve({
              success: true,
              skipped: true,
              exitCode,
              reason:
                'AI review condition was not met.'
            });

            return;
          }

          reject(
            new Error(
              `${scriptName} thất bại với exit code ${exitCode}`
            )
          );
        }
      );
    }
  );
}

async function runMonitor(
  config,
  monitor
) {
  const startedAt =
    Date.now();

  const monitorName =
    monitor.displayName ||
    monitor.name;

  const pipeline =
    buildPipeline(
      config,
      monitor
    );

  console.log('');
  console.log(
    '=================================================='
  );
  console.log(
    `🛡️ BẮT ĐẦU MONITOR: ${monitorName}`
  );
  console.log(
    `Query: ${monitor.name}`
  );
  console.log(
    '=================================================='
  );

  /*
   * 1. Collector
   */
  if (pipeline.collector.enabled) {
    await runScript({
      scriptName:
        pipeline.collector.script,

      args:
        pipeline.collector.args,

      monitorName,

      stepName:
        'Collector',

      required:
        true
    });
  } else {
    console.log(
      '⏭ Collector disabled.'
    );
  }

  /*
   * 2. Comparator
   */
  let comparisonSkipped =
    false;

  if (pipeline.comparator.enabled) {
  const comparisonResult =
    await runScript({
      scriptName:
        pipeline.comparator.script,

      args:
        pipeline.comparator.args,

      monitorName,

      stepName:
        'Comparator',

      /*
       * Monitor mới có thể chưa có comparator.
       * Khi đó hệ thống chỉ export dữ liệu
       * và không dừng toàn bộ run.
       */
      required:
        false
    });

  comparisonSkipped =
    comparisonResult.skipped === true;
} else {
  comparisonSkipped =
    true;

  console.log(
    '⏭ Comparator disabled.'
  );
}

/*
 * Manual Review
 *
 * Only send the comparison artifact when the
 * comparator actually ran successfully.
 */


  /*
   * 3. Smart Alert
   */
  if (!pipeline.alert.enabled) {
    console.log(
      '⏭ Smart Alert disabled.'
    );
  } else if (comparisonSkipped) {
    console.log(
      '⏭ Smart Alert skipped vì chưa có comparison report.'
    );
  } else {
    await runScript({
      scriptName:
        pipeline.alert.script,

      args:
        pipeline.alert.args,

      monitorName,

      stepName:
        'Smart Alert',

      required:
        true
    });
  }

  /*
   * 4. Report
   *
   * Report độc lập với Comparator và Smart Alert.
   * Ví dụ Client Error:
   *
   * Collector current window
   * → Report
   * → Slack / Telegram
   */
  if (!pipeline.report.enabled) {
    console.log(
      '⏭ Report disabled.'
    );
  } else {
    await runScript({
      scriptName:
        pipeline.report.script,

      args:
        pipeline.report.args,

      monitorName,

      stepName:
        'Report',

      required:
        true
    });
  }

  const durationSeconds =
    Math.round(
      (
        Date.now() -
        startedAt
      ) / 1000
    );

  console.log('');
  console.log(
    `✅ ${monitorName} hoàn thành trong ${durationSeconds} giây`
  );
}

async function runMonitorWithRetry(
  config,
  monitor,
  maxAttempts = 2,
  retryDelayMs = 10000
) {
  const monitorName =
    monitor.displayName ||
    monitor.name;

  let lastError =
    null;

  for (
    let attempt = 1;
    attempt <= maxAttempts;
    attempt += 1
  ) {
    try {
      if (attempt > 1) {
        console.log('');
        console.log(
          `🔄 Retry ${attempt}/${maxAttempts} cho ${monitorName}...`
        );
      }

      await runMonitor(
        config,
        monitor
      );

      return {
        success: true,
        attempts: attempt
      };
    } catch (error) {
      lastError =
        error;

      console.error('');
      console.error(
        `⚠️ ${monitorName} lỗi ở lần chạy ${attempt}/${maxAttempts}: ${error.message}`
      );

      if (attempt < maxAttempts) {
        console.log('');
        console.log(
          `⏳ Waiting ${retryDelayMs / 1000} seconds before retry...`
        );

        await sleep(
          retryDelayMs
        );
      }
    }
  }

  return {
    success: false,
    attempts: maxAttempts,
    error: lastError
  };
}

/*
 * Runs after all deterministic monitors finish.
 *
 * This pipeline is optional and must never
 * break the primary monitoring workflow.
 */
async function runAiPipeline({
  totalMonitorCount,
  successfulMonitorCount,
  failedMonitorCount
}) {
  const enabled =
    parseBoolean(
      process.env
        .AI_REVIEW_ENABLED,
      false
    );

  console.log('');
  console.log(
    '=================================================='
  );
  console.log(
    '🤖 QA SENTINEL AI PIPELINE'
  );
  console.log(
    '=================================================='
  );

  if (!enabled) {
    console.log(
      '⏭ AI_REVIEW_ENABLED is not true. AI pipeline skipped.'
    );

    return {
      status: 'skipped',
      reason:
        'AI review is disabled.'
    };
  }

  /*
   * Failed monitors may leave stale latest artifacts.
   * Do not allow AI to review incomplete/stale data.
   */
  const minimumSuccessfulMonitors =
  Math.max(
    1,
    Math.ceil(totalMonitorCount * 0.8)
  );

if (
  successfulMonitorCount <
  minimumSuccessfulMonitors
) {

  console.log(
    `⏭ AI pipeline skipped because only ${successfulMonitorCount}/${totalMonitorCount} monitors completed successfully.`
  );

  console.log(
    `   Minimum required: ${minimumSuccessfulMonitors}/${totalMonitorCount}.`
  );

  return {
    status: 'skipped',
    reason:
      'Insufficient deterministic monitor coverage.'
  };

}

if (failedMonitorCount > 0) {

  console.log(
    `⚠️ Continuing AI review with ${successfulMonitorCount}/${totalMonitorCount} monitors.`
  );

  console.log(
    '   Failed monitors will be excluded from the AI assessment.'
  );

}

  const startedAt =
    Date.now();

  try {
    for (
      const step
      of AI_PIPELINE
    ) {
      const result =
        await runAiScript({
          stepName:
            step.name,

          scriptName:
            step.script,

          allowSkipExitCode:
            step.allowSkipExitCode === true
        });

      /*
       * ai-reviewer.js exit code 10:
       * no Critical or configured condition not met.
       *
       * Stop here so Validator and Slack do not
       * consume the previous latest AI output.
       */
      if (result.skipped) {
        const durationSeconds =
          Math.round(
            (
              Date.now() -
              startedAt
            ) / 1000
          );

        console.log('');
        console.log(
          '⏭ AI Reviewer skipped this monitoring run.'
        );
        console.log(
          '⏭ Validator and Slack AI Reporter were not executed.'
        );
        console.log(
          `⏱ AI pipeline duration: ${durationSeconds} seconds`
        );

        return {
          status: 'skipped',
          reason:
            result.reason,
          durationSeconds
        };
      }
    }

    const durationSeconds =
      Math.round(
        (
          Date.now() -
          startedAt
        ) / 1000
      );

    console.log('');
    console.log(
      '✅ AI pipeline completed successfully.'
    );
    console.log(
      `⏱ AI pipeline duration: ${durationSeconds} seconds`
    );

    return {
      status: 'success',
      durationSeconds
    };
  } catch (error) {
    const durationSeconds =
      Math.round(
        (
          Date.now() -
          startedAt
        ) / 1000
      );

    console.error('');
    console.error(
      `⚠️ AI pipeline failed: ${error.message}`
    );

    console.error(
      '⚠️ Deterministic monitor results remain valid and unaffected.'
    );

    console.error(
      `⏱ AI pipeline duration before failure: ${durationSeconds} seconds`
    );

    return {
      status: 'failed',
      error:
        error.message,
      durationSeconds
    };
  }
}
/**
 * Remove report artifacts from previous days.
 *
 * Uses the local date/time of the machine.
 * Files modified before the start of today are deleted.
 *
 * Example:
 * Today = Aug 25
 * - Keep files from Aug 25
 * - Remove files from Aug 24 and earlier
 */
function cleanupOldReportArtifacts() {
  const folders = [
    'reports/raw',
    'reports/downloads',
    'reports/comparison',
    'reports/alerts'
  ];

  const todayStart = new Date();

  todayStart.setHours(
    0,
    0,
    0,
    0
  );

  console.log('');
  console.log(
    '=================================================='
  );
  console.log(
    '🧹 CLEANING OLD REPORT ARTIFACTS'
  );
  console.log(
    `Keeping files from ${todayStart.toLocaleDateString()} onwards.`
  );
  console.log(
    '=================================================='
  );

  let totalRemoved = 0;

  for (const relativeFolder of folders) {
    const folderPath =
      path.join(
        ROOT,
        relativeFolder
      );

    const folderName =
      relativeFolder.replace(
        'reports/',
        ''
      );

    if (!fs.existsSync(folderPath)) {
      console.log(
        `⏭ ${folderName}: folder not found, skipped.`
      );

      continue;
    }

    let removedCount = 0;

    try {
      const entries =
        fs.readdirSync(
          folderPath,
          {
            withFileTypes: true
          }
        );

      for (const entry of entries) {
        /*
         * Only delete files in the target folder.
         * Do not recursively delete directories.
         */
        if (!entry.isFile()) {
          continue;
        }

        const filePath =
          path.join(
            folderPath,
            entry.name
          );

        try {
          const stats =
            fs.statSync(filePath);

          if (
            stats.mtime < todayStart
          ) {
            fs.unlinkSync(filePath);

            removedCount++;
            totalRemoved++;
          }
        } catch (error) {
          console.warn(
            `⚠️ Could not process ${relativeFolder}/${entry.name}: ${error.message}`
          );
        }
      }

      console.log(
        `  🗑 ${folderName}: ${removedCount} file(s) removed`
      );
    } catch (error) {
      /*
       * Cleanup must never fail the monitoring run.
       */
      console.warn(
        `⚠️ Could not clean ${relativeFolder}: ${error.message}`
      );
    }
  }

  console.log('');
  console.log(
    `✅ Cleanup completed. ${totalRemoved} old file(s) removed.`
  );
}

async function main() {
  const startedAt =
    Date.now();

  console.log('');
  console.log(
    '🧠 QA Sentinel — All Monitors'
  );

  const config =
    loadConfig();

  const enabledMonitors =
    config.monitors.filter(
      monitor =>
        monitor.enabled === true
    );

  console.log(
    `Configured monitors: ${config.monitors.length}`
  );

  console.log(
    `Enabled monitors: ${enabledMonitors.length}`
  );

  if (
    enabledMonitors.length === 0
  ) {
    console.log(
      '⚠️ Không có monitor nào đang được bật.'
    );

    return;
  }

  const results = {
    success: [],
    failed: []
  };

  const MONITOR_DELAY_MS =
    10000;

  const RETRY_DELAY_MS =
    10000;

  const MAX_ATTEMPTS =
    2;

  for (
    let index = 0;
    index < enabledMonitors.length;
    index += 1
  ) {
    const monitor =
      enabledMonitors[index];

    const result =
      await runMonitorWithRetry(
        config,
        monitor,
        MAX_ATTEMPTS,
        RETRY_DELAY_MS
      );

    const monitorName =
      monitor.displayName ||
      monitor.name;

    if (result.success) {
      results.success.push(
        monitorName
      );

      if (result.attempts > 1) {
        console.log('');
        console.log(
          `✅ ${monitorName} thành công sau ${result.attempts} lần chạy`
        );
      }
    } else {
      console.error('');
      console.error(
        `❌ ${monitorName} thất bại sau ${result.attempts} lần chạy: ${result.error.message}`
      );

      results.failed.push({
        name:
          monitorName,

        error:
          result.error.message
      });
    }

    const isLastMonitor =
      index ===
      enabledMonitors.length - 1;

    if (!isLastMonitor) {
      console.log('');
      console.log(
        `⏳ Waiting ${MONITOR_DELAY_MS / 1000} seconds before next monitor...`
      );

      await sleep(
        MONITOR_DELAY_MS
      );
    }
  }

  /*
   * Run AI only after all deterministic
   * monitor artifacts have been generated.
   */
  /*
 * Combined Manual Review
 *
 * Run once after all monitors have finished.
 *
 * This uploads comparison artifacts for successful
 * monitors to the shared Manual Review Slack thread.
 *
 * A failed monitor should not prevent the remaining
 * successful monitor comparisons from being reviewed.
 */
let manualReviewStatus = 'skipped';

try {

  await runScript({
    scriptName:
      'manual-review.js',

    args:
      [],

    monitorName:
      'QA Sentinel',

    stepName:
      'Combined Manual Review',

    required:
      true
  });

  manualReviewStatus = 'sent';

} catch (error) {

  /*
   * Manual Review is a notification step.
   * Do not mark the entire monitoring run as failed
   * if Slack upload has an issue.
   */
  manualReviewStatus = 'failed';

  console.error(
    `⚠️ Combined Manual Review failed: ${error.message}`
  );
}

/*
 * Run AI only after all deterministic
 * monitor artifacts have been generated.
 */
const aiResult =
  await runAiPipeline({
    totalMonitorCount:
      enabledMonitors.length,

    successfulMonitorCount:
      results.success.length,

    failedMonitorCount:
      results.failed.length
  });
cleanupOldReportArtifacts();
  const durationSeconds =
    Math.round(
      (
        Date.now() -
        startedAt
      ) / 1000
    );

  console.log('');
  console.log(
    '=================================================='
  );
  console.log(
    '📊 ALL MONITORS SUMMARY'
  );
  console.log(
    `✅ Success: ${results.success.length}`
  );
  console.log(
    `❌ Failed: ${results.failed.length}`
  );
  console.log(
    `🤖 AI Pipeline: ${aiResult.status}`
  );

  if (aiResult.reason) {
    console.log(
      `🤖 AI Reason: ${aiResult.reason}`
    );
  }

  if (aiResult.error) {
    console.log(
      `🤖 AI Error: ${aiResult.error}`
    );
  }

  console.log(
    `⏱ Total duration: ${durationSeconds} seconds`
  );
  console.log(
    '=================================================='
  );

  if (
    results.failed.length > 0
  ) {
    console.log('');
    console.log(
      'Các monitor bị lỗi:'
    );

    for (
      const failedMonitor
      of results.failed
    ) {
      console.log(
        `- ${failedMonitor.name}: ${failedMonitor.error}`
      );
    }

    /*
     * Primary monitor failures still determine
     * the run-all-monitors exit status.
     *
     * AI failure does not.
     */
    process.exitCode = 1;
  }
}

main().catch(error => {
  console.error(
    `\n❌ All Monitor Runner thất bại: ${error.message}`
  );

  process.exit(1);
});