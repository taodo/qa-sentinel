const { spawn } = require('child_process');
const path = require('path');

const ROOT = __dirname;

const queryName =
  process.argv[2] || 'spin_event';

const windows = [
  'current',
  'previous',
  'yesterday',
  'two_days_ago'
];

const RANGE_MODE = 'scheduler_4h';

function runWindow(windowName) {
  return new Promise((resolve, reject) => {
    console.log('\n');
    console.log(
      '=================================================='
    );
    console.log(
      `▶ ${queryName} | ${windowName}`
    );
    console.log(
      '=================================================='
    );

    const child = spawn(
  process.execPath,
  [
    path.join(ROOT, 'run-and-extract.js'),
    queryName,
    windowName,
    RANGE_MODE
  ],
  {
    cwd: ROOT,
    stdio: 'inherit'
  }
);

    child.on('error', error => {
      reject(
        new Error(
          `Không thể chạy window ${windowName}: ` +
          error.message
        )
      );
    });

    child.on('close', exitCode => {
      if (exitCode === 0) {
        resolve();
        return;
      }

      reject(
        new Error(
          `Window ${windowName} thất bại ` +
          `(exit code ${exitCode})`
        )
      );
    });
  });
}

async function main() {
  console.log('\n🛡️ QA Sentinel Multi-window');
  console.log(`Monitor: ${queryName}`);
  console.log(`Tổng windows: ${windows.length}`);

  const startedAt = Date.now();

  for (const windowName of windows) {
    await runWindow(windowName);
  }

  const durationSeconds =
    Math.round((Date.now() - startedAt) / 1000);

  console.log('\n');
  console.log(
    '=================================================='
  );
  console.log('✅ HOÀN THÀNH TẤT CẢ WINDOWS');
  console.log(`Monitor: ${queryName}`);
  console.log(`Thời gian chạy: ${durationSeconds} giây`);
  console.log(
    '=================================================='
  );

  console.log('\nCác file mới nhất:');

  for (const windowName of windows) {
    console.log(
      `reports/raw/${queryName}-${windowName}.json`
    );
  }
}

main().catch(error => {
  console.error(`\n❌ ${error.message}`);
  process.exit(1);
});
