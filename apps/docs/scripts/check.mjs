import assert from 'node:assert/strict';
import {mkdir, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium, expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import pages from '../pages.mjs';

const origin = process.argv[2] ?? 'http://127.0.0.1:3001';
const parsedOrigin = URL.parse(origin);
if (!parsedOrigin || !/^https?:$/.test(parsedOrigin.protocol)) throw new Error('Supply an absolute HTTP(S) origin.');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const evidence = path.join(root, '.deploy-local/docs-site-20261021', parsedOrigin.hostname);
await mkdir(evidence, {recursive: true});
const browser = await chromium.launch({channel: 'chrome', headless: true});
const errors = [], report = {origin, pages: [], viewports: [], interactions: []};
try {
  const context = await browser.newContext();
  const page = await context.newPage();
  let automaticIndexRequests = 0;
  page.on('request', request => {if (request.url().endsWith('/generated/search-index.json')) automaticIndexRequests++;});
  page.on('pageerror', error => errors.push(error.message));
  for (const [id, title] of pages) {
    const pathname = `/docs/${id === 'intro' ? '' : id + '/'}`;
    const response = await page.goto(origin + pathname);
    assert.equal(response.status(), 200, pathname);
    await assert.doesNotReject(() => page.getByRole('heading', {level: 1, name: title, exact: true}).waitFor());
    const missing = await page.evaluate(() => [...document.querySelectorAll('main a[href]')].filter(a => {
      const u = new URL(a.href);
      if (u.pathname !== location.pathname || !u.hash) return false;
      return !document.getElementById(decodeURIComponent(u.hash.slice(1)));
    }).map(a => a.href));
    assert.deepEqual(missing, [], `Missing anchors: ${pathname}`);
    report.pages.push({pathname, title, status: response.status()});
  }
  for (const product of ['chef', 'prep']) {
    await page.goto(origin + `/docs/${product}/overview/`);
    const menu = page.locator('.theme-doc-sidebar-menu').first();
    const topLabels = await menu.locator(':scope > li > a.menu__link').allTextContents();
    assert.deepEqual(topLabels.slice(0, 3), ['Overview', 'Quickstart', 'Quickstart with AI']);
    if (product === 'prep') assert.deepEqual(topLabels.slice(3, 5), ['Getting Started', 'Clients']);
    await menu.getByRole('link', {name: 'Quickstart with AI', exact: true}).click();
    await page.getByRole('heading', {level: 1, name: 'Quickstart with AI', exact: true}).waitFor();
  }
  report.interactions.push('Chef and Prep onboarding sidebar order and AI guide navigation');
  for (const product of ['chef', 'prep']) {
    await page.setViewportSize({width: 1440, height: 1000});
    await page.emulateMedia({reducedMotion: 'no-preference'});
    await page.goto(origin + `/docs/${product}/overview/`);
    const image = page.locator('picture.overview-demo img');
    await expect(image).toBeVisible();
    await page.waitForFunction(() => document.querySelector('picture.overview-demo img')?.naturalWidth > 0);
    assert.match(await image.evaluate(img => img.currentSrc), new RegExp(`${product}-query\\.gif$`));
    await expect(page.locator('.theme-admonition-info')).toBeVisible();
    await page.screenshot({path: path.join(evidence, `${product}-overview-desktop.png`), fullPage: true});
    await page.emulateMedia({reducedMotion: 'reduce'});
    await page.waitForFunction(product => document.querySelector('picture.overview-demo img')?.currentSrc.endsWith(`${product}-query.png`), product);
    await page.setViewportSize({width: 375, height: 900});
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    const overviewAxe = await new AxeBuilder({page}).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    assert.equal(overviewAxe.violations.length, 0, JSON.stringify(overviewAxe.violations.map(v => v.id)));
    await page.screenshot({path: path.join(evidence, `${product}-overview-mobile.png`), fullPage: true});
  }
  await page.emulateMedia({reducedMotion: 'no-preference'});
  for (const width of [1024, 1440, 1920]) {
    await page.setViewportSize({width, height: 900});
    const alignment = await page.evaluate(() => ({
      link: document.querySelector('.navbar__items > .navbar__link').getBoundingClientRect().left,
      sidebar: document.querySelector('.theme-doc-sidebar-container').getBoundingClientRect().right,
      logo: document.querySelector('.navbar__brand').getBoundingClientRect().left,
      overflow: document.documentElement.scrollWidth > innerWidth,
    }));
    assert.ok(alignment.link >= alignment.sidebar - 1, JSON.stringify(alignment));
    assert.equal(alignment.logo, 16);
    assert.equal(alignment.overflow, false);
  }
  report.interactions.push('Overview GIFs, reduced-motion stills, mobile accessibility and desktop header alignment');
  for (const width of [375, 768, 1440]) {
    await page.setViewportSize({width, height: 900});
    await page.goto(origin + '/docs/chef/shielded/memos/');
    await page.evaluate(() => document.fonts.ready);
    const dimensions = await page.evaluate(() => ({viewport: innerWidth, document: document.documentElement.scrollWidth}));
    assert.ok(dimensions.document <= width, JSON.stringify(dimensions));
    if (width < 997) {
      const copyControl = page.getByRole('button', {name: /Copy code to clipboard/}).first();
      assert.ok(await copyControl.evaluate(element => {
        for (let current = element; current; current = current.parentElement) if (getComputedStyle(current).opacity === '0') return false;
        return true;
      }), 'Touch code-copy control must be visible without hover');
    }
    const axe = await new AxeBuilder({page}).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    await writeFile(path.join(evidence, `axe-${width}.json`), JSON.stringify(axe.violations, null, 2));
    assert.equal(axe.violations.length, 0, JSON.stringify(axe.violations.map(v => ({id: v.id, targets: v.nodes.map(n => n.target)}))));
    await page.screenshot({path: path.join(evidence, `memos-${width}.png`), fullPage: true});
    report.viewports.push({width, ...dimensions, axeViolations: axe.violations.length});
  }
  await page.setViewportSize({width: 1440, height: 900});
  await page.goto(origin + '/docs/');
  await page.waitForFunction(() => document.documentElement.dataset.hasHydrated === 'true');
  assert.equal(automaticIndexRequests, 0, 'Search index must load only after user action');
  await page.keyboard.press('Control+k');
  await page.getByRole('dialog').waitFor();
  await page.getByLabel('What are you building?').fill('memo');
  await page.getByRole('dialog').getByRole('link', {name: /Reading receipts & memos/}).click();
  await page.waitForURL('**/docs/chef/shielded/memos/');
  assert.equal(await page.getByRole('dialog').isVisible(), false);
  report.interactions.push('Ctrl+K search and memo result navigation');
  await page.getByRole('button', {name: 'Search documentation', exact: true}).click();
  await page.getByLabel('What are you building?').fill('no-results-7b8d91');
  await page.getByRole('status').filter({hasText: 'No matching pages'}).waitFor();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', {name: 'Search documentation', exact: true})).toBeFocused();
  report.interactions.push('Empty search, Escape dismissal and focus return');
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  const copy = page.getByRole('button', {name: /Copy code to clipboard/}).first();
  await copy.click({force: true});
  assert.match(await page.evaluate(() => navigator.clipboard.readText()), /query.mjs/);
  report.interactions.push('Code clipboard copy');
  await page.setViewportSize({width: 375, height: 900});
  await page.getByRole('button', {name: 'Toggle navigation bar'}).click();
  const back = page.locator('.navbar-sidebar').getByRole('button', {name: /Back to main menu/});
  if (await page.locator('.navbar-sidebar__items--show-secondary').count()) await back.click();
  await expect(page.locator('.navbar-sidebar__items')).not.toHaveClass(/--show-secondary/);
  await page.locator('.navbar-sidebar').getByRole('link', {name: 'Prep', exact: true}).click();
  await page.waitForURL('**/docs/prep/overview/');
  report.interactions.push('Mobile drawer product navigation');
  await page.emulateMedia({reducedMotion: 'reduce'});
  await page.goto(origin + '/docs/prep/query/');
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  report.interactions.push('Long reference reflow with reduced motion');
  if (parsedOrigin.hostname === 'zeer.endpx.cloud') {
    await page.goto(origin + '/');
    await page.getByRole('link', {name: /Get started/}).first().click();
    await page.getByRole('heading', {level: 1, name: 'Build with Zeer', exact: true}).waitFor();
    report.interactions.push('Existing website Get started link enters the new docs');
  }
  assert.deepEqual(errors, []);
  await writeFile(path.join(evidence, 'verification.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
}
