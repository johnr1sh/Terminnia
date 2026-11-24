import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  page.on('console', message => {
    if (message.type() === 'error') console.log('[browser console]', message.text());
  });
  page.on('pageerror', error => console.log('[browser pageerror]', error.stack || error.message));
  page.on('requestfailed', request => console.log('[browser requestfailed]', request.url(), request.failure()?.errorText || 'unknown'));
  await page.goto('http://127.0.0.1:4173/');
  await expect(page.locator('#status')).toContainText('Ready', { timeout: 30000 });
});

async function replaceSql(page, source) {
  const editor = page.locator('.cm-content');
  await editor.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.insertText(source);
}

test('starts with an executable sample database', async ({ page }) => {
  await expect(page.locator('#table-list')).toContainText('employees');
  await expect(page.locator('#table-list')).toContainText('departments');
  await replaceSql(page, 'SELECT name, salary FROM employees ORDER BY salary DESC LIMIT 3;');
  await page.getByRole('button', { name: /Run/ }).click();
  await expect(page.locator('#result-content')).toContainText('Jordan Lee');
  await expect(page.locator('#result-content')).toContainText('Alex Morgan');
});

test('executes writes, persists them after reload, and reads them back', async ({ page }) => {
  await replaceSql(page, "CREATE TABLE smoke_test (id INTEGER PRIMARY KEY, value TEXT NOT NULL); INSERT INTO smoke_test(value) VALUES ('persisted'); SELECT value FROM smoke_test;");
  await page.getByRole('button', { name: /Run/ }).click();
  await expect(page.locator('#result-content')).toContainText('persisted');
  await page.reload();
  await expect(page.locator('#status')).toContainText('Ready', { timeout: 30000 });
  await replaceSql(page, 'SELECT value FROM smoke_test;');
  await page.getByRole('button', { name: /Run/ }).click();
  await expect(page.locator('#result-content')).toContainText('persisted');
});

test('reports SQL errors without crashing the editor', async ({ page }) => {
  await replaceSql(page, 'SELECT * FROM table_that_does_not_exist;');
  await page.getByRole('button', { name: /Run/ }).click();
  await expect(page.locator('#message-content')).toContainText(/no such table/i);
  await expect(page.locator('#status')).toContainText('failed');
  await replaceSql(page, 'SELECT 1 AS healthy;');
  await page.getByRole('button', { name: /Run/ }).click();
  await expect(page.locator('#result-content')).toContainText('healthy');
  await expect(page.locator('#result-content')).toContainText('1');
});

test('exports a valid local database backup', async ({ page }) => {
  const downloadPromise = page.waitForEvent('download');
  await page.locator('#export-db').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('terminnia.sqlite');
});


test('creates and switches between persistent SQL editor tabs', async ({ page }) => {
  await replaceSql(page, 'SELECT 101 AS first_tab;');
  await page.locator('#add-tab').click();
  await replaceSql(page, 'SELECT 202 AS second_tab;');
  await expect(page.locator('.editor-tab')).toHaveCount(2);
  await page.locator('.editor-tab').first().click();
  await expect(page.locator('.cm-content')).toContainText('first_tab');
  await page.reload();
  await expect(page.locator('#status')).toContainText('Ready', { timeout: 30000 });
  await expect(page.locator('.editor-tab')).toHaveCount(2);
  await page.locator('.editor-tab').last().click();
  await expect(page.locator('.cm-content')).toContainText('second_tab');
});

test('rejects an invalid SQLite import without replacing the active database', async ({ page }) => {
  await replaceSql(page, 'SELECT name FROM employees ORDER BY name LIMIT 1;');
  await page.getByRole('button', { name: /Run/ }).click();
  await expect(page.locator('#result-content')).toContainText('Alex Morgan');

  await page.locator('#database-file').setInputFiles({
    name: 'not-a-database.sqlite',
    mimeType: 'application/x-sqlite3',
    buffer: Buffer.from('this is not a SQLite database')
  });

  await expect(page.locator('#toast')).toHaveClass(/visible/);
  await expect(page.locator('#connection')).toContainText('Local database ready');
  await replaceSql(page, 'SELECT name FROM employees ORDER BY name LIMIT 1;');
  await page.getByRole('button', { name: /Run/ }).click();
  await expect(page.locator('#result-content')).toContainText('Alex Morgan');
});
