const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

require('dotenv').config();

const {
  sendSlackDebugScreenshot
} = require('./engine/slack-notifier');

const ROOT = __dirname;

const reportsDirectory = path.join(
  ROOT,
  'reports'
);

const AUTH_FILE = path.join(
  ROOT,
  'playwright',
  '.auth',
  'splunk.json'
);

const SPLUNK_URL =
  'https://playstudios.splunkcloud.com/en-US/app/search/search';

const queryName =
  process.argv[2] || 'spin_event';

const windowName =
  process.argv[3] || 'current';

/*
 * Backward-compatible argument contract:
 *
 * argv[4] can be either:
 *   - a numeric Player ID (new player-scoped check), or
 *   - a legacy range mode such as scheduler_4h (run-multi-window).
 *
 * argv[5] remains the execution mode.
 * argv[6] remains the optional test flag.
 */
const rawArg4 =
  String(
    process.argv[4] || ''
  ).trim();

const playerId =
  /^\d+$/.test(rawArg4)
    ? rawArg4
    : '';

const rangeMode =
  rawArg4 === 'scheduler_4h'
    ? 'scheduler_4h'
    : 'default';

const executionMode =
  process.argv[5] || 'monitor';

/* Optional test-only flag. Keep disabled for normal execution. */
const forceNoData =
  process.argv[6] === 'force_no_data';

if (
  executionMode !== 'monitor' &&
  executionMode !== 'natural_query'
) {
  console.error(
    `Execution mode không hợp lệ: ${executionMode}\n` +
    `Các giá trị hợp lệ: monitor, natural_query`
  );

  process.exit(1);
}
  

const WINDOWS = {
  current: {
    earliest: '-1h@h',
    latest: '@h',
    description:
      '1 giờ hoàn chỉnh gần nhất'
  },

  previous: {
    earliest: '-2h@h',
    latest: '-1h@h',
    description:
      'Giờ hoàn chỉnh trước đó'
  },

  yesterday: {
    earliest: '-25h@h',
    latest: '-24h@h',
    description:
      'Cùng giờ ngày hôm qua'
  },

  two_days_ago: {
    earliest: '-49h@h',
    latest: '-48h@h',
    description:
      'Cùng giờ hai ngày trước'
  }
};

/*
 * Scheduler 4-hour windows used by run-multi-window.js.
 * Keep these separate from the normal command-bot 1-hour windows.
 */
const SCHEDULER_4H_WINDOWS = {
  current: {
    earliest: '-4h@h',
    latest: '@h',
    description: '4 giờ hoàn chỉnh gần nhất'
  },

  previous: {
    earliest: '-8h@h',
    latest: '-4h@h',
    description: '4 giờ hoàn chỉnh trước đó'
  },

  yesterday: {
    earliest: '-28h@h',
    latest: '-24h@h',
    description: 'Cùng 4 giờ ngày hôm qua'
  },

  two_days_ago: {
    earliest: '-52h@h',
    latest: '-48h@h',
    description: 'Cùng 4 giờ hai ngày trước'
  }
};

function parseRelativeWindow(
  value
) {

  const normalized =
    String(value || '')
      .trim()
      .toLowerCase();

  const match =
    normalized.match(
      /^last_(\d+(?:\.\d+)?)_(minutes?|mins?|hours?|hrs?|days?|weeks?)$/
    );

  if (!match) {
    return null;
  }

  const amount =
    Number(match[1]);

  const rawUnit =
    match[2];

  let unit;

  if (
    [
      'minute',
      'minutes',
      'min',
      'mins'
    ].includes(rawUnit)
  ) {
    unit = 'minutes';
  } else if (
    [
      'hour',
      'hours',
      'hr',
      'hrs'
    ].includes(rawUnit)
  ) {
    unit = 'hours';
  } else if (
    [
      'day',
      'days'
    ].includes(rawUnit)
  ) {
    unit = 'days';
  } else if (
    [
      'week',
      'weeks'
    ].includes(rawUnit)
  ) {
    unit = 'weeks';
  }

  if (
    !Number.isFinite(amount) ||
    amount <= 0 ||
    !unit
  ) {
    return null;
  }

  const unitInMinutes = {
    minutes: 1,
    hours: 60,
    days: 24 * 60,
    weeks: 7 * 24 * 60
  };

  const minutes =
    amount *
    unitInMinutes[unit];

  return {
    earliest:
      `-${minutes}m`,

    latest:
      'now',

    description:
      `Last ${amount} ${unit}`
  };
}

function resolveWindow(
  value,
  mode = 'default'
) {

  if (
    mode === 'scheduler_4h' &&
    SCHEDULER_4H_WINDOWS[value]
  ) {
    return SCHEDULER_4H_WINDOWS[value];
  }

  if (
    WINDOWS[value]
  ) {
    return WINDOWS[value];
  }

  const relativeWindow =
    parseRelativeWindow(
      value
    );

  if (
    relativeWindow
  ) {
    return relativeWindow;
  }

  console.error(
    `Window không hợp lệ: ${value}\n` +
    `Các giá trị cố định: ${Object.keys(WINDOWS).join(', ')}\n` +
    `Hoặc dùng dynamic format: last_<number>_<unit>`
  );

  process.exit(1);
}

if (
  rangeMode !== 'default' &&
  rangeMode !== 'scheduler_4h'
) {
  console.error(
    `Range mode không hợp lệ: ${rangeMode}`
  );

  process.exit(1);
}

const selectedWindow =
  resolveWindow(
    windowName,
    rangeMode
  );

const queryFile = path.join(
  ROOT,
  'queries',
  `${queryName}.spl`
);

const downloadDirectory = path.join(
  ROOT,
  'reports',
  'downloads'
);

const rawDirectory = path.join(
  ROOT,
  'reports',
  'raw'
);

function ensureDirectories() {

  fs.mkdirSync(reportsDirectory, {
    recursive: true
  });

  fs.mkdirSync(downloadDirectory, {
    recursive: true
  });

  fs.mkdirSync(rawDirectory, {
    recursive: true
  });

}

function addTimeRange(
  query,
  earliest = '-1h@h',
  latest = '@h'
) {
  const lines = query.split('\n');

  const indexLine = lines.findIndex(line =>
    line.trim().startsWith('index=')
  );

  if (indexLine === -1) {
    throw new Error(
      'Query không có dòng bắt đầu bằng index='
    );
  }

  // Prevent duplicate time parameters when rerunning.
  lines[indexLine] = lines[indexLine]
    .replace(/\s+earliest=\S+/g, '')
    .replace(/\s+latest=\S+/g, '');

  lines[indexLine] =
    `${lines[indexLine]} earliest=${earliest} latest=${latest}`;

  return lines.join('\n');
}


function addPlayerFilter(
  query,
  playerId
) {
  const normalizedPlayerId =
    String(playerId || '').trim();

  if (!normalizedPlayerId) {
    return query;
  }

  if (!/^\d+$/.test(normalizedPlayerId)) {
    throw new Error(
      `Player ID không hợp lệ: ${normalizedPlayerId}`
    );
  }

  /*
   * Player filtering is currently supported for spin_event.
   * The command router only supplies this argument for player-scoped
   * checks, and the query must use game_user_id.
   */
  if (
    queryName === 'spin_event'
  ) {
    if (
      /Payload\.ClientPayload\.game_user_id\s*=/.test(
        query
      )
    ) {
      return query;
    }

    const lines = query.split('\n');

    const indexLine =
      lines.findIndex(line =>
        line.trim().startsWith('index=')
      );

    if (indexLine === -1) {
      throw new Error(
        'Query không có dòng bắt đầu bằng index='
      );
    }

    lines[indexLine] =
      `${lines[indexLine]} ` +
      `Payload.ClientPayload.game_user_id=${normalizedPlayerId}`;

    return lines.join('\n');
  }

  return query;
}

function normalizeValue(value) {
  if (value === null || value === undefined) {
    return null;
  }

  const trimmed = String(value).trim();

  if (trimmed === '') {
    return null;
  }

  const withoutCommas = trimmed.replace(/,/g, '');

  if (/^-?\d+(\.\d+)?$/.test(withoutCommas)) {
    return Number(withoutCommas);
  }

  return trimmed;
}

function parseCsv(csvText) {
  const rows = [];

  let currentRow = [];
  let currentValue = '';
  let insideQuotes = false;

  for (
    let index = 0;
    index < csvText.length;
    index += 1
  ) {
    const character = csvText[index];
    const nextCharacter = csvText[index + 1];

    if (character === '"') {
      if (insideQuotes && nextCharacter === '"') {
        currentValue += '"';
        index += 1;
      } else {
        insideQuotes = !insideQuotes;
      }

      continue;
    }

    if (character === ',' && !insideQuotes) {
      currentRow.push(currentValue);
      currentValue = '';
      continue;
    }

    if (
      (character === '\n' || character === '\r') &&
      !insideQuotes
    ) {
      if (
        character === '\r' &&
        nextCharacter === '\n'
      ) {
        index += 1;
      }

      currentRow.push(currentValue);

      if (
        currentRow.some(
          value => String(value).trim() !== ''
        )
      ) {
        rows.push(currentRow);
      }

      currentRow = [];
      currentValue = '';
      continue;
    }

    currentValue += character;
  }

  if (
    currentValue !== '' ||
    currentRow.length > 0
  ) {
    currentRow.push(currentValue);

    if (
      currentRow.some(
        value => String(value).trim() !== ''
      )
    ) {
      rows.push(currentRow);
    }
  }

  if (rows.length === 0) {
    return [];
  }

  const headers = rows[0].map(
    (header, index) => {
      const normalized = String(header)
        .replace(/^\uFEFF/, '')
        .trim()
        .replace(/\s+/g, '_')
        .toLowerCase();

      return normalized || `column_${index + 1}`;
    }
  );

  return rows
    .slice(1)
    .filter(row =>
      row.some(
        value => String(value).trim() !== ''
      )
    )
    .map(row => {
      const record = {};

      headers.forEach((header, index) => {
        record[header] = normalizeValue(
          row[index]
        );
      });

      return record;
    });
}

function createTimestamp() {
  return new Date()
    .toISOString()
    .replace(/[:.]/g, '-');
}

async function setAceEditorValue(page, query) {
  await page.locator('.ace_editor').first().waitFor({
    state: 'visible',
    timeout: 30000
  });

  const result = await page.evaluate(
    searchQuery => {
      const editorElement =
        document.querySelector('.ace_editor');

      if (!editorElement || !window.ace) {
        return {
          success: false,
          reason: 'Không tìm thấy Ace Editor'
        };
      }

      const editor = window.ace.edit(editorElement);

      editor.setValue(searchQuery, -1);
      editor.clearSelection();
      editor.focus();

      return {
        success: true,
        length: editor.getValue().length
      };
    },
    query
  );

  if (!result.success) {
    throw new Error(result.reason);
  }

  console.log(
    `✅ Đã nhập ${result.length} ký tự vào SPL Editor.`
  );
}

async function runSearch(page) {
  const searchInput = page.locator(
    'textarea.ace_text-input[aria-label="Search"]'
  );

  await searchInput.focus();
  await page.keyboard.press('Alt+Enter');

  console.log('✅ Đã gửi lệnh chạy query.');
}

async function waitForSearchCompletion(
  page,
  { allowGenericTable = false } = {}
) {
  const startedWaitingAt =
    Date.now();

  const NO_DATA_GRACE_PERIOD_MS =
    10000;

  const REQUIRED_NO_DATA_DETECTIONS =
    2;

  let consecutiveNoDataDetections =
    0;

  console.log(
    'Đang chờ Splunk hoàn tất query...'
  );

  await page
    .locator('.search-results')
    .first()
    .waitFor({
      state: 'visible',
      timeout: 90000
    });

  for (
    let attempt = 1;
    attempt <= 60;
    attempt += 1
  ) {
    /*
     * Calculate this in the Node.js context.
     * The boolean is then passed into page.evaluate().
     */
    const gracePeriodPassed =
      Date.now() -
      startedWaitingAt >=
      NO_DATA_GRACE_PERIOD_MS;

    const result =
      await page.evaluate(
        ({ hasGracePeriodPassed, allowGenericTable }) => {
          const expectedMetrics = [
            'total_spins',
            'unique_users',
            'total_responses',
            'completed',
            'purchasing_users',
            'total_logins',
            'total_signups',
            'total_signup_events',
            'total_redemptions',
            'total_events',
            'total_errors'
          ];

          function normalizeText(value) {
            return String(value || '')
              .replace(/\s+/g, ' ')
              .trim()
              .toLowerCase();
          }

          function isVisible(element) {
            if (!element) {
              return false;
            }

            const rect =
              element.getBoundingClientRect();

            const style =
              window.getComputedStyle(
                element
              );

            return (
              rect.width > 0 &&
              rect.height > 0 &&
              style.display !== 'none' &&
              style.visibility !== 'hidden'
            );
          }

          /*
           * 1. Check for a valid result table first.
           *
           * A valid table always takes precedence over
           * any temporary "No results found" message.
           */
          const tables =
            Array.from(
              document.querySelectorAll(
                'table'
              )
            );

          for (const table of tables) {
            if (!isVisible(table)) {
              continue;
            }

            const className =
              typeof table.className ===
              'string'
                ? table.className
                : '';

            if (
              className.includes(
                'search-bar'
              )
            ) {
              continue;
            }

            const headers =
              Array.from(
                table.querySelectorAll(
                  'thead th'
                )
              ).map(cell =>
                normalizeText(
                  cell.innerText ||
                  cell.textContent
                )
              );

            const rowCount =
              table.querySelectorAll(
                'tbody tr'
              ).length;

            const hasExpectedMetric =
              headers.some(header =>
                expectedMetrics.includes(
                  header
                )
              );

            if (
              headers.length > 0 &&
              rowCount > 0 &&
              (
                hasExpectedMetric ||
                allowGenericTable
              )
            ) {
              return {
                status:
                  'success',

                headers,

                rowCount
              };
            }
          }

          const pageText =
            normalizeText(
              document.body?.innerText
            );

          /*
           * 2. Detect explicit Splunk errors.
           */
          const errorMessages = [
            'error in',
            'search job failed',
            'unable to parse the search',
            'unknown search command',
            'invalid argument'
          ];

          const matchedError =
            errorMessages.find(message =>
              pageText.includes(message)
            );

          if (matchedError) {
            return {
              status:
                'error',

              reason:
                `Splunk displayed an error: ${matchedError}`
            };
          }

          /*
           * 3. Detect an explicit no-results state.
           *
           * Do not use "0 events" or "Statistics (0)".
           * Those may appear temporarily while a query
           * is still running.
           */
          const noResultMessages = [
            'no results found',
            'no results found. try expanding the time range'
          ];

          const hasNoResultMessage =
            noResultMessages.some(
              message =>
                pageText.includes(
                  message
                )
            );

          if (
            hasNoResultMessage &&
            hasGracePeriodPassed
          ) {
            return {
              status:
                'no_data_candidate',

              reason:
                'Splunk displayed No results found.'
            };
          }

          return {
            status:
              'waiting'
          };
        },

        /*
         * Argument passed from Node.js context
         * into the browser context.
         */
        {
          hasGracePeriodPassed: gracePeriodPassed,
          allowGenericTable
        }
      );

    if (
  result.status ===
  'success'
) {
  console.log(
    `✅ Kết quả đã sẵn sàng: ` +
    `${result.rowCount} dòng đang hiển thị.`
  );

  console.log(
    `Headers: ${result.headers.join(', ')}`
  );

  // =====================================================
// DEBUG: Monitor Splunk Export button state
// =====================================================

const exportSelector =
  'a[role="button"][aria-label="Export"][data-view="views/shared/jobstatus/buttons/ExportButton"]';

console.log(
  '\n🔎 DEBUG: Monitoring Export button state...'
);

for (let second = 0; second <= 30; second += 1) {
  const exportState = await page.evaluate(
    selector => {
      const element =
        document.querySelector(selector);

      if (!element) {
        return {
          exists: false
        };
      }

      const rect =
        element.getBoundingClientRect();

      const style =
        window.getComputedStyle(element);

      return {
        exists: true,

        visible:
          rect.width > 0 &&
          rect.height > 0 &&
          style.display !== 'none' &&
          style.visibility !== 'hidden',

        className:
          element.getAttribute('class'),

        ariaDisabled:
          element.getAttribute('aria-disabled'),

        disabledByClass:
          element.classList.contains('disabled')
      };
    },
    exportSelector
  );

  console.log(
    `   T+${second}s → ` +
    JSON.stringify(exportState)
  );

  if (
    exportState.exists &&
    !exportState.disabledByClass &&
    exportState.ariaDisabled !== 'true'
  ) {
    console.log(
      `✅ DEBUG: Export became ENABLED at T+${second}s`
    );

    break;
  }

  if (second < 30) {
    await page.waitForTimeout(1000);
  }
}

  await page.waitForTimeout(
    2000
  );

  return result;
}

    if (
      result.status ===
      'error'
    ) {
      throw new Error(
        result.reason
      );
    }

    if (
      result.status ===
      'no_data_candidate'
    ) {
      consecutiveNoDataDetections +=
        1;

      console.log(
        `⚪ No-results state detected ` +
        `(${consecutiveNoDataDetections}/` +
        `${REQUIRED_NO_DATA_DETECTIONS}).`
      );

      /*
       * Confirm the message twice consecutively
       * before treating the query as no_data.
       */
      if (
        consecutiveNoDataDetections >=
        REQUIRED_NO_DATA_DETECTIONS
      ) {
        console.log(
          '⚪ Splunk query completed: No results found.'
        );

        return {
          status:
            'no_data',

          reason:
            'Splunk search completed with no results.'
        };
      }
    } else {
      /*
       * The message disappeared, so the previous
       * no-data detection may have been temporary.
       */
      consecutiveNoDataDetections =
        0;
    }

    if (attempt % 5 === 0) {
      console.log(
        `Vẫn đang chờ kết quả... ` +
        `${attempt * 2} giây`
      );
    }

    await page.waitForTimeout(
      2000
    );
  }

  /*
   * Neither a valid table nor a confirmed
   * no-data state appeared within 120 seconds.
   * Treat this as a real timeout.
   */
  const screenshotPath =
    path.join(
      reportsDirectory,
      `${queryName}-search-timeout.png`
    );

  await page.screenshot({
    path:
      screenshotPath,

    fullPage:
      true
  });

  try {
    const config =
      require(
        './monitor-config.json'
      );

    const monitorConfig =
      config.monitors.find(
        monitor =>
          monitor.name ===
          queryName
      );

    if (!monitorConfig) {
      console.warn(
        `⚠️ Monitor config not found: ` +
        `${queryName}`
      );
    } else {
      const channelId =
        process.env[
          monitorConfig
            .debugChannelIdEnvKey
        ];

      if (!channelId) {
        console.warn(
          `⚠️ Missing channel id: ` +
          `${monitorConfig.debugChannelIdEnvKey}`
        );
      } else {
        await sendSlackDebugScreenshot({
          channelId,

          imagePath:
            screenshotPath,

          monitorName:
            monitorConfig
              .displayName,

          windowName,

          errorMessage:
            'Search timeout after 120 seconds',

          isError:
            true
        });

        console.log(
          '✅ Debug screenshot uploaded.'
        );
      }
    }
  } catch (uploadError) {
    console.warn(
      `⚠️ Upload screenshot failed: ` +
      `${uploadError.message}`
    );
  }

  throw new Error(
    'Splunk search timed out after 120 seconds. ' +
    `Ảnh debug: ${screenshotPath}`
  );
}

async function openExportDialog(page) {
  const clickResult = await page.evaluate(() => {
    function isVisible(element) {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);

      return (
        rect.width > 0 &&
        rect.height > 0 &&
        style.display !== 'none' &&
        style.visibility !== 'hidden'
      );
    }

    const candidates = Array.from(
      document.querySelectorAll(
        'a.export, ' +
        'button[aria-label*="Export"], ' +
        'a[aria-label*="Export"], ' +
        '[data-view*="ExportButton"], ' +
        '[data-test*="export"]'
      )
    );

    const exportButton = candidates.find(
      element => isVisible(element)
    );

    if (!exportButton) {
      return {
        success: false
      };
    }

    exportButton.click();

    return {
      success: true,
      tag: exportButton.tagName,
      className:
        typeof exportButton.className === 'string'
          ? exportButton.className
          : ''
    };
  });

  if (!clickResult.success) {
    throw new Error(
      'Không tìm thấy nút mở Export Results.'
    );
  }

  console.log('✅ Đã mở cửa sổ Export Results.');

  await page.waitForTimeout(1000);
}

async function getVisibleExportModal(page) {
  /*
   * Splunk renders Export Results as a real dialog:
   *
   *   <div role="dialog" ...>
   *     <h2>Export Results</h2>
   *     ...
   *     <a role="button">Export</a>
   *   </div>
   *
   * The previous implementation selected the smallest element
   * containing the text "Export Results", which was the H2 itself.
   * That made the dialog contain zero buttons and caused the
   * "Export button not found" failure.
   */
  const dialog = page
    .locator('[role="dialog"]:visible')
    .filter({
      hasText: /Export Results/i
    })
    .last();

  if (await dialog.count() === 0) {
    throw new Error(
      'Visible Export Results dialog was not found.'
    );
  }

  await dialog.waitFor({
    state: 'visible',
    timeout: 10000
  });

  console.log(
    '✅ Export Results container detected: role=dialog'
  );

  return dialog;
}

async function configureExportDialog(page) {
  const modal = await getVisibleExportModal(page);

  const formatSelects = modal.locator('select');
  const selectCount = await formatSelects.count();

  for (
    let index = 0;
    index < selectCount;
    index += 1
  ) {
    const select = formatSelects.nth(index);

    if (!await select.isVisible().catch(() => false)) {
      continue;
    }

    const options = await select.locator('option')
      .allTextContents()
      .catch(() => []);

    const csvOption = options.find(
      option => option.trim().toLowerCase() === 'csv'
    );

    if (csvOption) {
      await select.selectOption({
        label: csvOption
      }).catch(() => {});

      break;
    }
  }

  // Leave "Number of Results" blank to export all rows.
  const inputs = modal.locator('input');
  const inputCount = await inputs.count();

  for (
    let index = 0;
    index < inputCount;
    index += 1
  ) {
    const input = inputs.nth(index);

    if (!await input.isVisible().catch(() => false)) {
      continue;
    }

    const placeholder =
      (
        await input.getAttribute('placeholder')
        .catch(() => '')
      ) || '';

    const name =
      (
        await input.getAttribute('name')
        .catch(() => '')
      ) || '';

    const combined =
      `${placeholder} ${name}`.toLowerCase();

    if (
      combined.includes('result') ||
      combined.includes('leave blank')
    ) {
      await input.fill('').catch(() => {});
    }
  }

  console.log(
    '✅ Export format: CSV, tất cả kết quả.'
  );
}

async function clickModalExportAndDownload(
  page,
  exportFileName
) {
  console.log('\n🔎 DEBUG: Starting Export download...');

  const modal =
    await getVisibleExportModal(page);

  /*
   * Splunk's Export control is an <a role="button"> in the
   * current UI, not a real <button>. Playwright's getByRole()
   * can be inconsistent with this legacy markup, so prefer the
   * concrete anchor/class used by the dialog and keep role/text
   * selectors as fallbacks.
   */
  let exportButton = modal
    .locator('a.modal-btn-primary')
    .filter({
      hasText: /^\s*Export\s*$/i
    })
    .last();

  if (await exportButton.count() === 0) {
    exportButton = modal
      .locator('a[role="button"]')
      .filter({
        hasText: /^\s*Export\s*$/i
      })
      .last();
  }

  if (await exportButton.count() === 0) {
    exportButton = modal
      .locator('button, a, input[type="button"], input[type="submit"]')
      .filter({
        hasText: /^\s*Export\s*$/i
      })
      .last();
  }

  if (await exportButton.count() === 0) {
    const debugButtons = await modal
      .locator('button, a, input[type="button"], input[type="submit"], [role="button"]')
      .evaluateAll(elements => elements.map(element => ({
        tag: element.tagName,
        role: element.getAttribute('role'),
        className: typeof element.className === 'string' ? element.className : '',
        text: (element.innerText || element.textContent || element.value || '').replace(/\s+/g, ' ').trim(),
        visible: !!(element.offsetWidth || element.offsetHeight || element.getClientRects().length)
      })));

    throw new Error(
      'Không tìm thấy nút Export trong popup Export Results. ' +
      `Clickable elements: ${JSON.stringify(debugButtons)}`
    );
  }

  console.log(
    '🎯 DEBUG: Selected popup Export button:',
    {
      count: await exportButton.count(),
      tag: await exportButton.evaluate(el => el.tagName).catch(() => 'unknown'),
      role: await exportButton.getAttribute('role').catch(() => null),
      className: await exportButton.getAttribute('class').catch(() => null),
      text: await exportButton.innerText().catch(() => 'Export')
    }
  );

  console.log(
    '🖱️ DEBUG: About to click popup Export button...'
  );

  /*
   * Splunk normally emits a Playwright download event here.
   * Start waiting BEFORE clicking so a fast download cannot be missed.
   */
  const downloadPromise = page.waitForEvent(
    'download',
    {
      timeout: 60000
    }
  );

  await exportButton.click();

  console.log(
    '🖱️ DEBUG: popup Export button click() executed.'
  );

  let download;

  try {
    download = await downloadPromise;
  } catch (error) {
    throw new Error(
      `Export button was clicked, but Splunk did not start a download within 60 seconds: ${error.message}`
    );
  }

  const suggestedName =
    download.suggestedFilename();

  console.log(
    `📥 DEBUG: DOWNLOAD EVENT: ${suggestedName}`
  );

  const finalFileName =
    suggestedName &&
    suggestedName.toLowerCase().endsWith('.csv')
      ? suggestedName
      : `${exportFileName}.csv`;

  const csvPath = path.join(
    downloadDirectory,
    finalFileName
  );

  await download.saveAs(csvPath);

  console.log(
    `✅ Đã tải CSV: ${csvPath}`
  );

  return csvPath;
}

async function exportCsv(page, exportFileName) {
  await openExportDialog(page);
  await configureExportDialog(page);

  return await clickModalExportAndDownload(
    page,
    exportFileName
  );
}

async function main() {
  ensureDirectories();

  if (!fs.existsSync(AUTH_FILE)) {
    throw new Error(
      `Không tìm thấy session: ${AUTH_FILE}`
    );
  }

  if (!fs.existsSync(queryFile)) {
    throw new Error(
      `Không tìm thấy query: ${queryFile}`
    );
  }

  const baseQuery = fs
    .readFileSync(queryFile, 'utf8')
    .trim();

  const {
    earliest,
    latest,
    description
  } = selectedWindow;

  let query = addTimeRange(
    baseQuery,
    earliest,
    latest
  );

  query =
    addPlayerFilter(
      query,
      playerId
    );

  console.log('\n🛡️ QA Sentinel');
  console.log(`Monitor: ${queryName}`);
  console.log(`Window key: ${windowName}`);
  console.log(`Window: ${description}`);
  console.log(`Splunk time: ${earliest} → ${latest}`);

  if (playerId) {
    console.log(`Player scope: ${playerId}`);
  }

  console.log('Splunk query:');
  console.log(query);

  const browser = await chromium.launch({
    headless: true
  });

  try {
    const context = await browser.newContext({
      storageState: AUTH_FILE,
      acceptDownloads: true
    });

    const page = await context.newPage();

    await page.goto(SPLUNK_URL, {
  waitUntil: 'domcontentloaded',
  timeout: 90000
});

console.log(
  `🌐 Current URL: ${page.url()}`
);

/*
 * Splunk may redirect through Okta SAML when
 * the stored session needs to be refreshed.
 *
 * Wait until navigation returns to Splunk
 * before looking for the search editor.
 */
try {
  await page.waitForURL(
    url =>
      url.hostname.includes(
        'playstudios.splunkcloud.com'
      ) &&
      !url.pathname.includes('/saml/acs'),
    {
      timeout: 90000
    }
  );
} catch (error) {
  throw new Error(
    `Splunk authentication did not complete. ` +
    `Current URL: ${page.url()}`
  );
}

await page.locator(
  'textarea.ace_text-input[aria-label="Search"]'
).waitFor({
  state: 'visible',
  timeout: 90000
});

/*
 * Persist refreshed Okta/Splunk cookies.
 * The next monitoring window will reuse
 * the newest authenticated session.
 */
await context.storageState({
  path: AUTH_FILE
});

console.log(
  '✅ Splunk session refreshed and saved.'
);

    await page.waitForTimeout(2000);

    await setAceEditorValue(page, query);
    await runSearch(page);
    const searchResult =
  await waitForSearchCompletion(
    page,
    {
      allowGenericTable:
        executionMode === 'natural_query'
    }
  );
  if (forceNoData) {
  console.log(
    '🧪 Test mode: forcing no_data result.'
  );

  searchResult.status =
    'no_data';
}

if (
  searchResult.status ===
  'no_data'
) {
  const timestamp =
    createTimestamp();

  const output = {
    metadata: {
      monitor:
        queryName,

      window:
        windowName,

      windowDescription:
        description,

      generatedAtUtc:
        new Date().toISOString(),

      timezone:
        'Asia/Ho_Chi_Minh',

      earliest,

      latest,

      sourceCsv:
        null,

      recordCount:
        0,

      status:
        'no_data',

      message:
        'Splunk search completed with no results.'
    },

    records: []
  };

  const outputPath =
    path.join(
      rawDirectory,
      `${queryName}-${windowName}-${timestamp}.json`
    );

  const latestPath =
    path.join(
      rawDirectory,
      `${queryName}-${windowName}.json`
    );

  fs.writeFileSync(
    outputPath,
    JSON.stringify(
      output,
      null,
      2
    )
  );

  fs.writeFileSync(
    latestPath,
    JSON.stringify(
      output,
      null,
      2
    )
  );

  console.log(
    `⚪ No result found for ` +
    `${queryName} | ${windowName}.`
  );

  console.log(
    `✅ Empty JSON created: ${outputPath}`
  );

  console.log(
    `✅ Latest: ${latestPath}`
  );

  return;
}

if (
  queryName === 'client_error' &&
  windowName === 'current'
) {

  const screenshotPath = path.join(
    reportsDirectory,
    "client_error-current-latest.png"
  );

  await page.screenshot({

    path: screenshotPath,

    fullPage: true

  });

  console.log(
    `📸 Client Error screenshot saved: ${screenshotPath}`
  );

}
    const timestamp = createTimestamp();

    const exportFileName =
      `${queryName}-${windowName}-${timestamp}`;

    const csvPath = await exportCsv(
      page,
      exportFileName
    );

    const csvText = fs.readFileSync(
      csvPath,
      'utf8'
    );

    const records = parseCsv(csvText);

    if (records.length === 0) {
      throw new Error(
        'CSV đã tải nhưng không có dòng dữ liệu.'
      );
    }

    const output = {
      metadata: {
        monitor: queryName,
        window: windowName,
        windowDescription: description,
        generatedAtUtc: new Date().toISOString(),
        timezone: 'Asia/Ho_Chi_Minh',
        earliest,
        latest,
        sourceCsv: path.basename(csvPath),
        recordCount: records.length
      },
      records
    };

    const outputPath = path.join(
      rawDirectory,
      `${queryName}-${windowName}-${timestamp}.json`
    );

    const latestPath = path.join(
      rawDirectory,
      `${queryName}-${windowName}.json`
    );

    fs.writeFileSync(
      outputPath,
      JSON.stringify(output, null, 2)
    );

    fs.writeFileSync(
      latestPath,
      JSON.stringify(output, null, 2)
    );

    console.log(
      `✅ Đã chuyển ${records.length} dòng CSV thành JSON.`
    );

    console.log(`✅ JSON: ${outputPath}`);
    console.log(`✅ Latest: ${latestPath}`);

    console.log('\n3 dòng đầu:');

    console.log(
      JSON.stringify(
        records.slice(0, 3),
        null,
        2
      )
    );
  } finally {
    await browser.close();
  }
}

main().catch(error => {
  console.error(`\n❌ ${error.message}`);
  process.exit(1);
});
