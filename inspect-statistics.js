const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const AUTH_FILE = path.join(
  ROOT,
  'playwright',
  '.auth',
  'splunk.json'
);

const SPLUNK_URL =
  'https://playstudios.splunkcloud.com/en-US/app/search/search';

const queryName = process.argv[2] || 'spin_event';
const queryFile = path.join(ROOT, 'queries', `${queryName}.spl`);

function addTimeRange(query) {
  const lines = query.split('\n');

  const indexLine = lines.findIndex(line =>
    line.trim().startsWith('index=')
  );

  if (indexLine === -1) {
    throw new Error('Query không có dòng index=');
  }

  lines[indexLine] += ' earliest=-1h@h latest=@h';
  return lines.join('\n');
}

async function setAceEditorValue(page, query) {
  await page.locator('.ace_editor').first().waitFor({
    state: 'visible',
    timeout: 30000
  });

  await page.evaluate(searchQuery => {
    const editorElement =
      document.querySelector('.ace_editor');

    if (!editorElement || !window.ace) {
      throw new Error('Không tìm thấy Ace Editor');
    }

    const editor = window.ace.edit(editorElement);
    editor.setValue(searchQuery, -1);
    editor.clearSelection();
    editor.focus();
  }, query);
}

(async () => {
  const query = addTimeRange(
    fs.readFileSync(queryFile, 'utf8').trim()
  );

  const browser = await chromium.launch({
    headless: false
  });

  const context = await browser.newContext({
    storageState: AUTH_FILE
  });

  const page = await context.newPage();

  console.log(`Đang chạy: ${queryName}`);

  await page.goto(SPLUNK_URL, {
    waitUntil: 'domcontentloaded',
    timeout: 60000
  });

  await page.locator(
    'textarea.ace_text-input[aria-label="Search"]'
  ).waitFor({
    state: 'visible',
    timeout: 30000
  });

  await setAceEditorValue(page, query);

  await page.locator(
    'textarea.ace_text-input[aria-label="Search"]'
  ).focus();

  await page.keyboard.press('Alt+Enter');

  console.log('Đang chờ kết quả...');
  await page.waitForTimeout(15000);

  const statisticsTab = page.getByText(
    /^Statistics(?:\s*\(\d+\))?$/,
    { exact: false }
  ).first();

  if (await statisticsTab.count()) {
    await statisticsTab.click().catch(() => {});
    await page.waitForTimeout(3000);
  }

  const inspection = await page.evaluate(() => {
    function isVisible(element) {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);

      return (
        rect.width > 0 &&
        rect.height > 0 &&
        style.display !== 'none' &&
        style.visibility !== 'hidden'
      );
    }

    function describe(element, index) {
      const text = (element.innerText || '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 1000);

      return {
        index,
        tag: element.tagName,
        id: element.id || '',
        className:
          typeof element.className === 'string'
            ? element.className
            : '',
        role: element.getAttribute('role') || '',
        ariaLabel:
          element.getAttribute('aria-label') || '',
        rowCount:
          element.querySelectorAll(
            'tr, [role="row"]'
          ).length,
        headerCount:
          element.querySelectorAll(
            'th, [role="columnheader"]'
          ).length,
        cellCount:
          element.querySelectorAll(
            'td, [role="gridcell"], [role="cell"]'
          ).length,
        text
      };
    }

    const selectors = [
      'table',
      '[role="table"]',
      '[role="grid"]',
      '[role="treegrid"]',
      '.results-table',
      '.statistics-table',
      '.search-results'
    ];

    const seen = new Set();
    const candidates = [];

    selectors.forEach(selector => {
      document.querySelectorAll(selector).forEach(element => {
        if (!seen.has(element) && isVisible(element)) {
          seen.add(element);
          candidates.push(element);
        }
      });
    });

    return candidates.map(describe);
  });

  console.log('\n=== VISIBLE RESULT CANDIDATES ===');

  inspection.forEach(item => {
    console.log('\n---------------------------');
    console.log(JSON.stringify(item, null, 2));
  });

  const htmlPath = path.join(
    ROOT,
    'reports',
    'statistics-page.html'
  );

  fs.writeFileSync(
    htmlPath,
    await page.content()
  );

  await page.screenshot({
    path: path.join(
      ROOT,
      'reports',
      'statistics-inspection.png'
    ),
    fullPage: true
  });

  console.log(`\n✅ HTML: ${htmlPath}`);
  console.log(
    '✅ Screenshot: reports/statistics-inspection.png'
  );
  console.log(
    'Cửa sổ giữ mở trong 60 giây để bạn kiểm tra.'
  );

  await page.waitForTimeout(60000);
  await browser.close();
})().catch(error => {
  console.error(`❌ ${error.message}`);
  process.exit(1);
});
