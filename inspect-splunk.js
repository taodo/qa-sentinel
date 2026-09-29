const { chromium } = require('playwright');
const fs = require('fs');

const AUTH_FILE = 'playwright/.auth/splunk.json';
const SPLUNK_URL =
  'https://playstudios.splunkcloud.com/en-US/app/search/search';

(async () => {
  if (!fs.existsSync(AUTH_FILE)) {
    throw new Error(`Không tìm thấy session: ${AUTH_FILE}`);
  }

  const browser = await chromium.launch({
    headless: false
  });

  const context = await browser.newContext({
    storageState: AUTH_FILE
  });

  const page = await context.newPage();

  console.log('Đang mở Splunk...');

  await page.goto(SPLUNK_URL, {
    waitUntil: 'domcontentloaded',
    timeout: 60000
  });

  await page.waitForTimeout(10000);

  console.log('\nURL:', page.url());
  console.log('Title:', await page.title());

  const elements = await page.locator(
    'textarea, input, [contenteditable="true"], [role="textbox"], .CodeMirror, .monaco-editor'
  ).evaluateAll(nodes =>
    nodes.map((element, index) => {
      const rect = element.getBoundingClientRect();

      return {
        index,
        tag: element.tagName,
        id: element.id || '',
        className:
          typeof element.className === 'string'
            ? element.className
            : '',
        role: element.getAttribute('role') || '',
        ariaLabel: element.getAttribute('aria-label') || '',
        contenteditable:
          element.getAttribute('contenteditable') || '',
        placeholder:
          element.getAttribute('placeholder') || '',
        visible:
          rect.width > 0 &&
          rect.height > 0 &&
          getComputedStyle(element).visibility !== 'hidden',
        width: Math.round(rect.width),
        height: Math.round(rect.height)
      };
    })
  );

  console.log('\n=== Các ô có thể nhập liệu ===');

  for (const element of elements) {
    console.log(JSON.stringify(element, null, 2));
  }

  console.log(`\nTổng cộng tìm thấy: ${elements.length} element`);

  await page.screenshot({
    path: 'reports/splunk-inspection.png',
    fullPage: true
  });

  console.log('\n✅ Đã lưu screenshot: reports/splunk-inspection.png');
  console.log('Cửa sổ sẽ giữ mở trong 60 giây.');

  await page.waitForTimeout(60000);
  await browser.close();
})().catch(error => {
  console.error('❌ Lỗi:', error.message);
  process.exit(1);
});
