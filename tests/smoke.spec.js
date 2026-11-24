import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
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
