const path = require('path');
const { spawn } = require('child_process');

const ROOT = __dirname;

const MONITOR_SCRIPT = path.join(
  ROOT,
  'run-all-monitors.js'
);

const TIME_ZONE =
  'Asia/Ho_Chi_Minh';

const RUN_HOURS = [
  10,
  14
];

const CHECK_INTERVAL_MS =
  30 * 1000;

let isRunning = false;
let runNumber = 0;
let lastRunKey = null;

function formatTime(
  date = new Date()
) {
  return new Intl.DateTimeFormat(
    'en-GB',
    {
      timeZone: TIME_ZONE,
      dateStyle: 'medium',
      timeStyle: 'medium'
    }
  ).format(date);
}

function getLocalDateParts(
  date = new Date()
) {
  const parts =
    new Intl.DateTimeFormat(
      'en-CA',
      {
        timeZone: TIME_ZONE,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23'
      }
    ).formatToParts(date);

  const values = {};

  for (const part of parts) {
    if (part.type !== 'literal') {
      values[part.type] =
        Number(part.value);
    }
  }

  return values;
}

function getRunKey(parts) {
  return [
    parts.year,
    String(parts.month)
      .padStart(2, '0'),
    String(parts.day)
      .padStart(2, '0'),
    String(parts.hour)
      .padStart(2, '0')
  ].join('-');
}

function runMonitor() {
  if (isRunning) {
    console.log(
      `\n⏭ ${formatTime()} ICT — ` +
      'Previous monitor is still running.'
    );

    return;
  }

  isRunning = true;
  runNumber += 1;

  const currentRunNumber =
    runNumber;

  const startedAt =
    new Date();

  console.log('\n');
  console.log(
    '=================================================='
  );
  console.log(
    `🚀 QA Sentinel Scheduler — Run #${currentRunNumber}`
  );
  console.log(
    `🕒 Started: ${formatTime(startedAt)} ICT`
  );
  console.log(
    '=================================================='
  );

  const child = spawn(
    process.execPath,
    [MONITOR_SCRIPT],
    {
      cwd: ROOT,
      env: process.env,
      stdio: 'inherit'
    }
  );

  child.on(
    'error',
    error => {
      console.error(
        `\n❌ Failed to start monitor: ${error.message}`
      );

      isRunning = false;
    }
  );

  child.on(
    'close',
    exitCode => {
      const finishedAt =
        new Date();

      const durationSeconds =
        Math.round(
          (
            finishedAt.getTime() -
            startedAt.getTime()
          ) / 1000
        );

      if (exitCode === 0) {
        console.log(
          `\n✅ Run #${currentRunNumber} completed successfully.`
        );
      } else {
        console.error(
          `\n❌ Run #${currentRunNumber} failed with exit code ${exitCode}.`
        );
      }

      console.log(
        `⏱ Duration: ${durationSeconds} seconds`
      );

      console.log(
        `🕒 Finished: ${formatTime(finishedAt)} ICT`
      );

      isRunning = false;
    }
  );
}

function checkSchedule() {
  const now =
    new Date();

  const parts =
    getLocalDateParts(now);

  const isScheduledHour =
    RUN_HOURS.includes(
      parts.hour
    );

  /*
   * Allow the scheduler to trigger during
   * the first 2 minutes of the scheduled hour.
   *
   * This protects against small timer delays.
   */
  const isWithinRunWindow =
    parts.minute <= 1;

  if (
    !isScheduledHour ||
    !isWithinRunWindow
  ) {
    return;
  }

  const runKey =
    getRunKey(parts);

  /*
   * Prevent duplicate execution while polling
   * every 30 seconds.
   */
  if (
    lastRunKey === runKey
  ) {
    return;
  }

  if (isRunning) {
    console.log(
      `\n⏭ ${formatTime()} ICT — ` +
      'Scheduled time reached, but previous run is still active.'
    );

    return;
  }

  lastRunKey =
    runKey;

  runMonitor();
}

function shutdown(signal) {
  console.log(
    `\n🛑 Received ${signal}. ` +
    'QA Sentinel Scheduler stopped.'
  );

  process.exit(0);
}

console.log(
  '\n🛡 QA Sentinel Scheduler'
);

console.log(
  'Schedule: 10:00, 14:00 ICT'
);

console.log(
  `Monitor: ${path.basename(
    MONITOR_SCRIPT
  )}`
);

console.log(
  'Schedule check: every 30 seconds'
);

console.log(
  'The scheduler does not run immediately when started.'
);

console.log(
  'Keep this Terminal window open while monitoring.'
);

process.on(
  'SIGINT',
  () =>
    shutdown('SIGINT')
);

process.on(
  'SIGTERM',
  () =>
    shutdown('SIGTERM')
);

/*
 * Check immediately, then every 30 seconds.
 */
checkSchedule();

setInterval(
  checkSchedule,
  CHECK_INTERVAL_MS
);