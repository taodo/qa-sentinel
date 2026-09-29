const { spawn } = require('child_process');
const path = require('path');

const ROOT = __dirname;

function runScript(scriptName, args = []) {
  return new Promise((resolve, reject) => {
    console.log('\n');
    console.log(
      '=================================================='
    );
    console.log(
      `▶ Chạy: node ${scriptName} ${args.join(' ')}`
    );
    console.log(
      '=================================================='
    );

    const child = spawn(
      process.execPath,
      [
        path.join(ROOT, scriptName),
        ...args
      ],
      {
        cwd: ROOT,
        stdio: 'inherit'
      }
    );

    child.on('error', error => {
      reject(
        new Error(
          `Không thể chạy ${scriptName}: ${error.message}`
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
          `${scriptName} thất bại với exit code ${exitCode}`
        )
      );
    });
  });
}

async function main() {
  const startedAt = Date.now();

  console.log('\n🛡️ QA Sentinel — Spin Monitor');
  console.log(
    'Chạy 4 time windows và tạo comparison report.'
  );

  await runScript(
    'run-multi-window.js',
    ['spin_event']
  );

  await runScript(
    'compare-spin.js'
  );
  await runScript(
  'smart-alert.js',
  ['spin_event']
);

  const durationSeconds = Math.round(
    (Date.now() - startedAt) / 1000
  );

  console.log('\n');
  console.log(
    '=================================================='
  );
  console.log('✅ SPIN MONITOR HOÀN THÀNH');
  console.log(
    `Thời gian chạy: ${durationSeconds} giây`
  );
  console.log(
    'Report: reports/comparison/spin-comparison-latest.json'
  );
  console.log(
    '=================================================='
  );
}

main().catch(error => {
  console.error(`\n❌ ${error.message}`);
  process.exit(1);
});
