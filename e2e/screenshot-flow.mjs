import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

// Clear state
await page.goto('https://dev.zkcoins.app');
await page.evaluate(() => {
  Object.keys(localStorage).forEach((k) => localStorage.removeItem(k));
  indexedDB.databases().then((dbs) =>
    dbs.forEach((db) => {
      if (db.name) indexedDB.deleteDatabase(db.name);
    }),
  );
});
await page.reload({ waitUntil: 'networkidle' });
await page.screenshot({ path: '/tmp/zk-01-landing.png' });
console.log('01: Landing page');

// Click "New Wallet" / seed phrase button
const seedBtn = page.getByRole('button', { name: /seed phrase|new wallet/i }).first();
await seedBtn.click();
await page.waitForTimeout(1000);
await page.screenshot({ path: '/tmp/zk-02-seed-start.png' });
console.log('02: Seed phrase start');

// Generate mnemonic
const generateBtn = page.getByRole('button', { name: /generate/i });
if (await generateBtn.isVisible({ timeout: 3000 })) {
  await generateBtn.click();
  await page.waitForTimeout(2000);
}
await page.screenshot({ path: '/tmp/zk-03-mnemonic.png' });
console.log('03: Mnemonic generated');

// Get the 12 words
const wordElements = page.locator('.grid > div, .grid > span');
const wordCount = await wordElements.count();
console.log(`Found ${wordCount} word elements`);
const words = [];
for (let i = 0; i < wordCount; i++) {
  const text = await wordElements.nth(i).textContent();
  const word = text?.replace(/^\d+\.\s*/, '').trim();
  if (word) words.push(word);
}
console.log(`Words: ${words.join(' ')}`);

// Click "I wrote it down" or continue
const wroteBtn = page.getByRole('button', { name: /wrote it down|continue|next/i });
if (await wroteBtn.isVisible({ timeout: 3000 })) {
  await wroteBtn.click();
  await page.waitForTimeout(1000);
}
await page.screenshot({ path: '/tmp/zk-04-after-wrote.png' });
console.log('04: After wrote it down');

// Confirm by entering words
const confirmInput = page.getByRole('textbox');
if (await confirmInput.isVisible({ timeout: 3000 })) {
  await confirmInput.fill(words.join(' '));
  await page.waitForTimeout(500);
  const confirmBtn = page.getByRole('button', { name: /confirm|verify/i });
  if (await confirmBtn.isVisible({ timeout: 2000 })) {
    await confirmBtn.click();
    await page.waitForTimeout(1000);
  }
}
await page.screenshot({ path: '/tmp/zk-05-confirmed.png' });
console.log('05: Confirmed');

// Set password
const passwordInputs = page.locator('input[type="password"]');
if (await passwordInputs.first().isVisible({ timeout: 5000 })) {
  await passwordInputs.first().fill('TestPass123!');
  if (await passwordInputs.nth(1).isVisible({ timeout: 1000 })) {
    await passwordInputs.nth(1).fill('TestPass123!');
  }
  const saveBtn = page.getByRole('button', { name: /encrypt|save|create/i });
  if (await saveBtn.isVisible({ timeout: 2000 })) {
    await saveBtn.click();
  }
  await page.waitForTimeout(3000);
}
await page.screenshot({ path: '/tmp/zk-06-wallet-created.png' });
console.log('06: Wallet created');

// Wait for balance to load (mint happens automatically or via faucet)
await page.waitForTimeout(5000);
await page.screenshot({ path: '/tmp/zk-07-balance.png' });
console.log('07: Balance view');

// Check if faucet button exists and click it
const faucetBtn = page.getByRole('button', { name: /faucet/i });
if (await faucetBtn.isVisible({ timeout: 3000 })) {
  console.log('Clicking faucet...');
  await faucetBtn.click();
  await page.waitForTimeout(10000); // Wait for mint to complete
  await page.screenshot({ path: '/tmp/zk-08-after-faucet.png' });
  console.log('08: After faucet');
}

// Final state
const bodyText = await page.textContent('body');
console.log('\nPage text (excerpt):', bodyText?.substring(0, 500));

await browser.close();
console.log('\nDone. Screenshots in /tmp/zk-*.png');
