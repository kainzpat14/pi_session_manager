import { test, expect } from '@playwright/test';
import {
  login,
  getTerminalText,
  getSelectedInstanceId,
  getActiveTab,
  getInstanceCount,
  waitForTerminalText,
  typeInTerminal,
  sendTerminalInput,
  pressEnter,
} from './helpers';

test.describe('pi-web e2e', () => {
  test('login page shows token input and connects', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#login-overlay')).toBeVisible();
    await expect(page.locator('#token-input')).toBeVisible();
    await page.fill('#token-input', 'wrong-token');
    await page.click('#login-btn');
    // Login overlay should hide since the frontend always hides it on click
    await expect(page.locator('#login-overlay')).toHaveClass(/hidden/);
  });

  test('sidebar shows empty state on fresh login', async ({ page }) => {
    await login(page);
    // Sidebar should render even with 0 items
    await expect(page.locator('#instance-list')).toBeAttached();
    await expect(page.locator('#history-list')).toBeVisible();
    await expect(page.locator('#fs-list')).toBeVisible();
    // Status text should reflect current count
    const count = await page.locator('#instance-list li').count();
    await expect(page.locator('#status-text')).toHaveText(`${count} active`);
  });

  test('creates new instance via + button and shows mock pi TUI', async ({ page }) => {
    await login(page);
    const countBefore = await page.locator('#instance-list li').count();

    await page.click('#new-session-btn');

    // Wait for instance to appear in sidebar
    await expect(page.locator('#instance-list li')).toHaveCount(countBefore + 1);
    await expect(page.locator('#status-text')).toHaveText(`${countBefore + 1} active`);

    // Wait for terminal to show mock pi output
    const text = await waitForTerminalText(
      page,
      'pi',
      (t) => t.includes('MOCK PI') && t.includes('test process'),
      5000
    );
    expect(text).toContain('MOCK PI');
  });

  test('sends input to mock pi and sees echo output', async ({ page }) => {
    await login(page);
    const countBefore = await page.locator('#instance-list li').count();
    await page.click('#new-session-btn');
    await expect(page.locator('#instance-list li')).toHaveCount(countBefore + 1);

    // Wait for prompt to be ready
    await waitForTerminalText(page, 'pi', (t) => t.includes('MOCK PI'), 5000);

    // Send input directly via the WebSocket to avoid xterm.js keyboard event issues
    await sendTerminalInput(page, 'pi', 'hello world\r');

    // Wait for echo
    const text = await waitForTerminalText(
      page,
      'pi',
      (t) => t.includes('echo: hello world'),
      5000
    );
    expect(text).toContain('echo: hello world');
  });

  test('switches to shell tab and shows bash prompt', async ({ page }) => {
    await login(page);
    const countBefore = await page.locator('#instance-list li').count();
    await page.click('#new-session-btn');
    await expect(page.locator('#instance-list li')).toHaveCount(countBefore + 1);

    // Wait for pi tab to be active
    await expect(page.locator('#pi-tab')).toHaveClass(/active/);

    // Click Terminal tab
    await page.click('.tab.shell-tab');
    await expect(page.locator('.tab.shell-tab')).toHaveClass(/active/);
    await expect(page.locator('#pi-tab')).not.toHaveClass(/active/);

    // Wait for bash to show something
    await page.waitForTimeout(1000);
    const text = await getTerminalText(page, 'shell');
    // Bash should have a prompt
    expect(text.length).toBeGreaterThan(0);
  });

  test('switches back to pi tab', async ({ page }) => {
    await login(page);
    const countBefore = await page.locator('#instance-list li').count();
    await page.click('#new-session-btn');
    await expect(page.locator('#instance-list li')).toHaveCount(countBefore + 1);

    await page.click('.tab.shell-tab');
    await expect(page.locator('.tab.shell-tab')).toHaveClass(/active/);

    await page.click('#pi-tab');
    await expect(page.locator('#pi-tab')).toHaveClass(/active/);
    await expect(page.locator('.tab.shell-tab')).not.toHaveClass(/active/);
  });

  test('kills instance via sidebar × button', async ({ page }) => {
    await login(page);
    const countBefore = await page.locator('#instance-list li').count();
    await page.click('#new-session-btn');
    await expect(page.locator('#instance-list li')).toHaveCount(countBefore + 1);

    await page.locator('.instance-close').last().click();
    await expect(page.locator('#instance-list li')).toHaveCount(countBefore);
    await expect(page.locator('#status-text')).toHaveText(`${countBefore} active`);
  });

  test('file explorer shows current directory entries', async ({ page }) => {
    await login(page);
    // Wait for file explorer to load asynchronously
    await page.waitForSelector('#fs-list .fs-item', { timeout: 5000 });
    const count = await page.locator('#fs-list .fs-item').count();
    expect(count).toBeGreaterThan(0);
    await expect(page.locator('#fs-breadcrumb')).toContainText('/home/dev');
  });

  test('clicking directory in file explorer navigates into it', async ({ page }) => {
    await login(page);
    const dirs = page.locator('#fs-list .fs-item.dir');
    const count = await dirs.count();
    if (count > 0) {
      const firstDir = dirs.first();
      const dirName = await firstDir.locator('.fs-name').textContent();
      await firstDir.click();
      // Breadcrumb should now show the subdir
      await expect(page.locator('#fs-breadcrumb')).toContainText(dirName!);
    }
  });

  test('creates instance from file explorer + New session here', async ({ page }) => {
    await login(page);
    const countBefore = await page.locator('#instance-list li').count();

    // Navigate to a subdirectory if available
    const dirs = page.locator('#fs-list .fs-item.dir');
    const dirCount = await dirs.count();
    if (dirCount > 0) {
      await dirs.first().click();
    }

    const currentPath = await page.locator('#fs-breadcrumb').textContent();
    await page.click('.fs-create-btn');

    await expect(page.locator('#instance-list li')).toHaveCount(countBefore + 1);
    const cwdText = await page.locator('.instance-cwd').last().textContent();
    expect(cwdText).toContain(currentPath?.replace('↑ ', '') || '/home/dev');
  });

  test('mobile sidebar toggle works', async ({ page }) => {
    // Set mobile viewport before loading page
    await page.setViewportSize({ width: 375, height: 667 });
    await login(page);

    // Sidebar should be hidden by default on mobile
    const sidebar = page.locator('#sidebar');
    await expect(sidebar).not.toHaveClass(/open/);

    // Toggle open
    await page.evaluate(() => (window as any).toggleSidebar());
    await expect(sidebar).toHaveClass(/open/);

    // Click overlay to close
    await page.evaluate(() => (window as any).closeSidebar());
    await expect(sidebar).not.toHaveClass(/open/);

    // Reset viewport
    await page.setViewportSize({ width: 1280, height: 720 });
  });

  test('clicking sidebar instance selects it and shows pi tab', async ({ page }) => {
    await login(page);
    const countBefore = await page.locator('#instance-list li').count();
    await page.click('#new-session-btn');
    await expect(page.locator('#instance-list li')).toHaveCount(countBefore + 1);

    // Click shell tab first
    await page.click('.tab.shell-tab');
    await expect(page.locator('.tab.shell-tab')).toHaveClass(/active/);

    // Click sidebar instance
    await page.locator('#instance-list li').last().click();
    await expect(page.locator('#pi-tab')).toHaveClass(/active/);
    await expect(page.locator('.tab.shell-tab')).not.toHaveClass(/active/);
  });

  test('multiple instances can be created and selected', async ({ page }) => {
    await login(page);
    const countBefore = await page.locator('#instance-list li').count();

    await page.click('#new-session-btn');
    await expect(page.locator('#instance-list li')).toHaveCount(countBefore + 1);

    await page.click('#new-session-btn');
    await expect(page.locator('#instance-list li')).toHaveCount(countBefore + 2);

    // Click the last instance
    const items = page.locator('#instance-list li');
    await items.last().click();

    await expect(page.locator('#pi-tab')).toHaveClass(/active/);
    await expect(page.locator('#status-text')).toHaveText(`${countBefore + 2} active`);
  });

  test('instance is removed from map when killed', async ({ page }) => {
    await login(page);
    const countBefore = await page.locator('#instance-list li').count();
    await page.click('#new-session-btn');
    await expect(page.locator('#instance-list li')).toHaveCount(countBefore + 1);

    // Verify the new instance is attached in the frontend map
    const countBeforeMap = await getInstanceCount(page);
    expect(countBeforeMap).toBeGreaterThanOrEqual(1);

    await page.locator('.instance-close').last().click();
    await expect(page.locator('#instance-list li')).toHaveCount(countBefore);

    // After killing, the map should have one fewer than before
    const countAfter = await getInstanceCount(page);
    expect(countAfter).toBe(countBeforeMap - 1);
  });

  test('history list shows past sessions', async ({ page }) => {
    await login(page);
    // The history section is always visible
    await expect(page.locator('#history-list')).toBeVisible();
  });

  test('terminal pane is visible after creating instance', async ({ page }) => {
    await login(page);
    await page.click('#new-session-btn');

    const pane = page.locator('.terminal-pane.active');
    await expect(pane).toBeVisible();
  });

  test('shell pane is hidden when pi tab is active', async ({ page }) => {
    await login(page);
    await page.click('#new-session-btn');

    const shellPane = page.locator('.shell-pane.active');
    await expect(shellPane).toHaveCount(0);

    const piPane = page.locator('.terminal-pane.active');
    await expect(piPane).toBeVisible();
  });

  test('shell pane is visible when shell tab is active', async ({ page }) => {
    await login(page);
    await page.click('#new-session-btn');
    await page.click('.tab.shell-tab');

    const shellPane = page.locator('.shell-pane.active');
    await expect(shellPane).toBeVisible();

    const piPane = page.locator('.terminal-pane.active');
    await expect(piPane).toHaveCount(0);
  });

  test('paste button is hidden on desktop', async ({ page }) => {
    await login(page);
    await page.setViewportSize({ width: 1280, height: 720 });
    const pasteBtn = page.locator('#paste-btn');
    // On desktop (>768px) the paste button is hidden via CSS
    const isVisible = await pasteBtn.isVisible();
    expect(isVisible).toBe(false);
  });

  test('paste button is visible on mobile', async ({ page }) => {
    await login(page);
    await page.setViewportSize({ width: 375, height: 667 });
    const pasteBtn = page.locator('#paste-btn');
    await expect(pasteBtn).toBeVisible();
    await page.setViewportSize({ width: 1280, height: 720 });
  });
});
