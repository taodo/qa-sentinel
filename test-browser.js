const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({
    headless: false
  });

  const page = await browser.newPage();

  await page.goto(
    'https://playstudios.splunkcloud.com/en-US/app/search/search',
    { waitUntil: 'domcontentloaded' }
  );

  console.log('Browser opened successfully.');
  console.log('Page title:', await page.title());

  await page.waitForTimeout(30000);
  await browser.close();
})();
