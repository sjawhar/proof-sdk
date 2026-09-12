// Builds the smoke harness, serves it, drives it with Playwright, exits 1 on any FAIL.
import { chromium } from '@playwright/test';
import { build, preview } from 'vite';

await build({ configFile: 'vite.smoke.config.ts' });
const server = await preview({ configFile: 'vite.smoke.config.ts', preview: { port: 4173, strictPort: true } });
const browser = await chromium.launch();
const page = await browser.newPage();
page.on('console', (message) => console.log(message.text()));
await page.goto('http://127.0.0.1:4173/');
await page.waitForFunction(() => window.__smokeAction === 'type', null, { timeout: 90_000 });
const editorA = page.locator('#editor-a .ProseMirror');
await editorA.click();
await page.keyboard.insertText('Hello world, this is bold text about the plan.');
await page.evaluate(() => window.__smokeContinueAction());
await page.waitForFunction(() => window.__smokeAction === 'hover' || /FATAL/.test(document.getElementById('status')?.textContent ?? ''), null, { timeout: 90_000 });
const marginMark = page.locator('#editor-c [data-id]').first();
await marginMark.hover();
await page.locator('#status').hover();
await page.evaluate(() => window.__smokeContinueAction());
await page.waitForFunction(() => window.__smokeAction === 'click', null, { timeout: 90_000 });
await marginMark.click();
await page.evaluate(() => window.__smokeContinueAction());
await page.waitForFunction(() => window.__smokeAction === 'click', null, { timeout: 90_000 });
await page.locator('#editor-b2 [data-mark-id]').click();
await page.evaluate(() => window.__smokeContinueAction());
await page.waitForFunction(() => window.__smokeAction === 'type-remote', null, { timeout: 90_000 });
await page.keyboard.press('Escape');
await page.waitForFunction(() =>
  Array.from(document.querySelectorAll('.mark-popover-backdrop')).every(
    (element) => getComputedStyle(element).display === 'none',
  ),
);
const editorB = page.locator('#editor-b > .proof-editor .ProseMirror');
await editorB.click();
await page.keyboard.press('Control+End');
await page.keyboard.press('Enter');
await page.keyboard.type('hello from B');
await page.waitForFunction(() => document.querySelector('#editor-b .ProseMirror')?.textContent?.includes('hello from B') ?? false, null, { timeout: 5000 });
await page.evaluate(() => window.__smokeContinueAction());
await page.waitForFunction(() => /DONE|FATAL/.test(document.getElementById('status')?.textContent ?? ''), null, { timeout: 90_000 });
const results = await page.evaluate(() => window.__smokeResults ?? {});
const fatal = await page.evaluate(() => window.__smokeFatal);
let remoteInputPass = false;
let bobPage;
try {
  const alice = await browser.newContext();
  const bob = await browser.newContext();
  const alicePage = await alice.newPage();
  bobPage = await bob.newPage();
  for (const [name, p] of [['alice', alicePage], ['bob', bobPage]]) {
    p.on('console', (message) => { if (message.type() === 'error' || message.type() === 'warning') console.log(`[${name}] ${message.text()}`); });
    p.on('pageerror', (error) => console.log(`[${name}] pageerror ${error.message}`));
  }
  await alicePage.goto('http://127.0.0.1:4173/?two-context');
  await alicePage.waitForFunction(() => window.__twoContextEditor !== undefined);
  const initial = await alicePage.evaluate(() => {
    window.__twoContextEditor.handle.setMarkdown('## Database\n\n```ts\nconst x = 1;\n```\n');
    return {
      awareness: window.__twoContextEditor.awarenessUpdate(),
      document: window.__twoContextEditor.documentUpdate(),
    };
  });
  await bobPage.goto(
    `http://127.0.0.1:4173/?two-context&document=${encodeURIComponent(JSON.stringify(initial.document))}&awareness=${encodeURIComponent(JSON.stringify(initial.awareness))}`,
  );
  await bobPage.waitForFunction(() => window.__twoContextEditor !== undefined);
  const aliceEditor = alicePage.locator('#editor-a .ProseMirror');
  const bobEditor = bobPage.locator('#editor-a .ProseMirror');
  await aliceEditor.click();
  await alicePage.keyboard.press('Control+End');
  await alicePage.keyboard.type('alice remote edit');
  await aliceEditor.getByText('alice remote edit').waitFor();
  const aliceUpdate = await alicePage.evaluate(() => ({
    awareness: window.__twoContextEditor.awarenessUpdate(),
    document: window.__twoContextEditor.documentUpdate(),
  }));
  await bobPage.evaluate(({ awareness, document }) => {
    window.__twoContextEditor.applyDocument(document);
    window.__twoContextEditor.applyAwareness(awareness);
  }, aliceUpdate);
  await bobEditor.getByText('alice remote edit').waitFor();
  await bobPage.waitForTimeout(400);
  await bobEditor.click();
  await bobPage.keyboard.press('Control+End');
  await bobPage.keyboard.press('Enter');
  await bobPage.keyboard.type('hello from B after remote');
  await bobEditor.getByText('hello from B after remote').waitFor({ timeout: 5000 });
  const bobUpdate = await bobPage.evaluate(() => window.__twoContextEditor.documentUpdate());
  await alicePage.evaluate((document) => window.__twoContextEditor.applyDocument(document), bobUpdate);
  const relayState = await alicePage.evaluate(() => ({
    markdown: window.__twoContextEditor.handle.getMarkdown(),
    text: window.__twoContextEditor.handle.view.state.doc.textContent,
  }));
  console.log(`two-context relay state: ${JSON.stringify(relayState)}`);
  await aliceEditor.getByText('hello from B after remote').waitFor({ timeout: 5000 });
  remoteInputPass = true;
} catch (error) {
  console.error(`two-context remote input: ${error instanceof Error ? error.message : String(error)}`);
  try {
    const bobState = await bobPage.evaluate(() => ({
      text: window.__twoContextEditor.handle.view.state.doc.textContent,
      json: JSON.stringify(window.__twoContextEditor.handle.view.state.doc.toJSON()).slice(0, 1500),
      dom: document.querySelector('#editor-a .ProseMirror')?.innerHTML.slice(0, 800),
    }));
    console.error(`two-context bob state: ${JSON.stringify(bobState)}`);
  } catch (inner) {
    console.error(`two-context bob state unavailable: ${inner instanceof Error ? inner.message : String(inner)}`);
  }
}
results['typing after a remote edit reaches a separate browser context'] = remoteInputPass;
await browser.close();
await server.close();
const failed = Object.entries(results).filter(([, pass]) => !pass).map(([name]) => name);
if (fatal) console.error(`FATAL: ${fatal}`);
console.log(`${Object.keys(results).length - failed.length}/${Object.keys(results).length} smoke checks passed`);
process.exit(fatal || failed.length > 0 ? 1 : 0);
