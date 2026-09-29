const { chromium } = require('playwright');
const readline = require('readline');

const SPLUNK_URL =
  'https://playstudios.splunkcloud.com/en-US/app/search/search';

function waitForEnter() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise(resolve => {
    rl.question(
      '\nSau khi đăng nhập hoàn tất và thấy trang Search, quay lại Terminal rồi nhấn Enter...',
      () => {
        rl.close();
        resolve();
      }
    );
  });
}

(async () => {
  const browser = await chromium.launch({
    headless: false
  });

  const context = await browser.newContext();
  const page = await context.newPage();

  console.log('Đang mở Splunk...');
  await page.goto(SPLUNK_URL, {
    waitUntil: 'domcontentloaded',
    timeout: 60000
  });

  await waitForEnter();

  await context.storageState({
    path: 'playwright/.auth/splunk.json'
  });

  console.log('✅ Đã lưu phiên đăng nhập vào playwright/.auth/splunk.json');

  await browser.close();
})().catch(error => {
  console.error('❌ Không thể lưu phiên đăng nhập:', error.message);
  process.exit(1);
});
