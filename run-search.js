const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const AUTH_FILE = 'playwright/.auth/splunk.json';
const SPLUNK_URL =
  'https://playstudios.splunkcloud.com/en-US/app/search/search';

const queryName = process.argv[2] || 'spin_event';
const queryFile = path.join('queries', `${queryName}.spl`);

function addTimeRange(query) {
  const lines = query.split('\n');

  // Add the time range to the first index search line.
  const indexLine = lines.findIndex(line =>
    line.trim().startsWith('index=')
  );

  if (indexLine === -1) {
    throw new Error('Query không có dòng bắt đầu bằng index=');
  }

  lines[indexLine] =
    `${lines[indexLine]} earliest=-1h@h latest=@h`;

  return lines.join('\n');
}

async function setAceEditorValue(page, query) {
  const aceEditor = page.locator('.ace_editor').first();

  await aceEditor.waitFor({
    state: 'visible',
    timeout: 30000
  });

  const result = await page.evaluate(searchQuery => {
    const editorElement = document.querySelector('.ace_editor');

    if (!editorElement) {
      return {
        success: false,
        reason: 'Không tìm thấy .ace_editor'
      };
    }

    if (!window.ace) {
      return {
        success: false,
        reason: 'Không tìm thấy window.ace'
      };
    }

    const editor = window.ace.edit(editorElement);

    editor.setValue(searchQuery, -1);
    editor.clearSelection();
    editor.focus();

    return {
      success: true,
      valueLength: editor.getValue().length
    };
  }, query);

  if (!result.success) {
    throw new Error(result.reason);
  }

  console.log(`✅ Đã nhập ${result.valueLength} ký tự vào Ace Editor.`);
}

async function clickSearchButton(page) {
  const candidates = [
    page.getByRole('button', {
      name: /^Search$/i
    }),

    page.getByRole('button', {
      name: /run search/i
    }),

    page.locator(
      'button[data-test="search-button"]'
    ),

    page.locator(
      'button[aria-label="Search"]'
    ),

    page.locator(
      '.search-button button'
    ),

    page.locator(
      'button.btn-primary'
    )
  ];

  for (const candidate of candidates) {
    const button = candidate.first();

    if (await button.count() === 0) {
      continue;
    }

    try {
      await button.waitFor({
        state: 'visible',
        timeout: 3000
      });

      const text = await button
        .innerText()
        .catch(() => '');

      console.log(
        `Đã tìm thấy nút Search: "${text.trim() || 'không có text'}"`
      );

      await button.click();

      return;
    } catch {
      // Try next candidate.
    }
  }

  console.log(
    'Không tìm thấy nút Search bằng selector. Thử phím tắt Alt+Enter...'
  );

  const searchInput = page.locator(
    'textarea.ace_text-input[aria-label="Search"]'
  );

  await searchInput.focus();
  await page.keyboard.press('Alt+Enter');
}

async function waitForSearchToStart(page) {
  const possibleStatusElements = [
    '.search-job-status',
    '[data-test="search-job-status"]',
    '.search-results',
    '.results-table',
    '.event-count'
  ];

  for (const selector of possibleStatusElements) {
    try {
      await page.locator(selector).first().waitFor({
        state: 'visible',
        timeout: 5000
      });

      console.log(`✅ Splunk đã phản hồi: ${selector}`);
      return;
    } catch {
      // Continue checking.
    }
  }

  console.log(
    '⚠️ Chưa xác nhận được trạng thái search, hãy kiểm tra trên Chromium.'
  );
}

(async () => {
  if (!fs.existsSync(AUTH_FILE)) {
    throw new Error(
      `Không tìm thấy phiên đăng nhập: ${AUTH_FILE}`
    );
  }

  if (!fs.existsSync(queryFile)) {
    throw new Error(
      `Không tìm thấy file query: ${queryFile}`
    );
  }

  const baseQuery = fs
    .readFileSync(queryFile, 'utf8')
    .trim();

  const query = addTimeRange(baseQuery);

  console.log(`Đang chạy query: ${queryName}`);
  console.log(
    'Khoảng thời gian: 1 giờ hoàn chỉnh gần nhất'
  );

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

  console.log('Đang chờ Splunk Search Editor tải...');

  await page.locator(
    'textarea.ace_text-input[aria-label="Search"]'
  ).waitFor({
    state: 'visible',
    timeout: 30000
  });

  await page.waitForTimeout(2000);

  await setAceEditorValue(page, query);

  await page.screenshot({
    path: `reports/${queryName}-query-entered.png`,
    fullPage: true
  });

  await clickSearchButton(page);
  await waitForSearchToStart(page);

  console.log('✅ Đã gửi query lên Splunk.');
  console.log(
    'Cửa sổ sẽ giữ mở trong 60 giây để kiểm tra.'
  );

  await page.waitForTimeout(60000);

  await page.screenshot({
    path: `reports/${queryName}-result.png`,
    fullPage: true
  });

  await browser.close();
})().catch(error => {
  console.error(`❌ ${error.message}`);
  process.exit(1);
});
