const { chromium } = require('playwright');
const fs = require('fs');

const AUTH_FILE = 'playwright/.auth/splunk.json';
const SPLUNK_URL =
  'https://playstudios.splunkcloud.com/en-US/app/search/search';

(async () => {
  if (!fs.existsSync(AUTH_FILE)) {
    throw new Error(`Không tìm thấy file đăng nhập: ${AUTH_FILE}`);
  }

  const browser = await chromium.launch({
    headless: false
  });

  const context = await browser.newContext({
    storageState: AUTH_FILE
  });

  const page = await context.newPage();

  await page.goto(SPLUNK_URL, {
    waitUntil: 'domcontentloaded',
    timeout: 60000
  });

  await page.waitForTimeout(5000);

  console.log('URL hiện tại:', page.url());
  console.log('Tiêu đề trang:', await page.title());

  if (page.url().includes('/account/login')) {
    console.log('❌ Phiên đăng nhập chưa được tái sử dụng.');
  } else {
    console.log('✅ Đã mở Splunk bằng phiên đăng nhập đã lưu.');
  }

  await page.waitForTimeout(15000);
  await browser.close();
})().catch(error => {
  console.error('❌ Lỗi:', error.message);
  process.exit(1);
});
