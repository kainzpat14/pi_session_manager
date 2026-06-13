import { Page } from '@playwright/test';

export const TEST_TOKEN = 'test-token-for-playwright';

export async function cleanupInstances(page: Page): Promise<void> {
  // Fetch all active instances and kill them
  const res = await page.evaluate(async () => {
    const token = localStorage.getItem('pi-web-token') || '';
    const r = await fetch('/api/instances', {
      headers: { 'X-Pi-Token': token },
    });
    if (!r.ok) return { error: await r.text() };
    const list = await r.json();
    for (const inst of list) {
      await fetch(`/api/instances/${inst.id}/kill`, {
        method: 'POST',
        headers: { 'X-Pi-Token': token },
      });
    }
    return { count: list.length };
  });
  // Small delay to let kill handlers propagate
  await page.waitForTimeout(300);
}

export async function login(page: Page): Promise<void> {
  await page.goto('/');
  await page.fill('#token-input', TEST_TOKEN);
  await page.click('#login-btn');
  await page.waitForSelector('#login-overlay', { state: 'hidden' });
}

export async function getTerminalText(page: Page, target: 'pi' | 'shell' = 'pi'): Promise<string> {
  return page.evaluate((t) => {
    const hook = (window as any)._piWeb;
    if (!hook) return '';
    return hook.getTerminalText(t);
  }, target);
}

export async function getSelectedInstanceId(page: Page): Promise<string | null> {
  return page.evaluate(() => (window as any)._piWeb?.selectedInstanceId ?? null);
}

export async function getActiveTab(page: Page): Promise<string> {
  return page.evaluate(() => (window as any)._piWeb?.activeTab ?? 'pi');
}

export async function getInstanceCount(page: Page): Promise<number> {
  return page.evaluate(() => (window as any)._piWeb?.instances?.size ?? 0);
}

export async function getVisibleInstanceIds(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const hook = (window as any)._piWeb;
    return hook ? Array.from(hook.instances.keys()) : [];
  });
}

export async function waitForTerminalText(
  page: Page,
  target: 'pi' | 'shell' = 'pi',
  predicate: (text: string) => boolean,
  timeout = 5000,
  interval = 100
): Promise<string> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const text = await getTerminalText(page, target);
    if (predicate(text)) return text;
    await page.waitForTimeout(interval);
  }
  const text = await getTerminalText(page, target);
  throw new Error(`Timeout waiting for terminal condition. Last text:\n${text}`);
}

export async function typeInTerminal(page: Page, text: string): Promise<void> {
  // Focus the xterm textarea and type character by character
  const textarea = page.locator('.xterm-helper-textarea').first();
  await textarea.focus();
  await page.keyboard.type(text);
  await page.keyboard.press('Enter');
}

export async function sendTerminalInput(page: Page, target: 'pi' | 'shell', text: string): Promise<void> {
  await page.evaluate(
    (args) => {
      const hook = (window as any)._piWeb;
      if (!hook) { console.error('[sendTerminalInput] no hook'); return; }
      const inst = hook.instances.get(hook.selectedInstanceId);
      if (!inst) { console.error('[sendTerminalInput] no instance'); return; }
      const ws = inst[args.target].ws;
      if (ws && ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({ type: 'input', data: args.text }));
      }
    },
    { target, text }
  );
}

export async function pressEnter(page: Page): Promise<void> {
  await page.keyboard.press('Enter');
}
