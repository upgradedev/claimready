#!/usr/bin/env node
/**
 * What a visitor can actually reach without scrolling, measured in a real browser.
 *
 * This is not an estimate and it is not a screenshot. It starts a static server over this
 * checkout, launches the Chrome that is already on the machine in headless mode, tells it it is a
 * 375 by 812 phone and then a 1280 by 800 laptop, and reads `getBoundingClientRect` off the real
 * layout. Every number this prints came back from Chrome. Nothing here models a layout.
 *
 * WHY IT EXISTS, WITH THE NUMBERS THIS SCRIPT ITSELF PRODUCED ON 2026-09-01. At 375 by 812, before
 * the fix, the first control a visitor could see and press was the "No agent in this browser?"
 * disclosure at y=699, which opens a paragraph of help and touches nothing. The first control that
 * reached the claim at all was "Load synthetic incident" at y=882, and the first field of the draft
 * was at y=1138. The fold is at 812. So a person arriving on a phone met a wall of prose and no way
 * into the thing the page is for. After the fix the primary action sits at y=331 on the phone and
 * y=217 on the laptop. Those are readings from Chrome, not judgements about a design.
 *
 * WHAT COUNTS AS AN ACTION, WRITTEN DOWN BECAUSE THE DEFINITION IS THE WHOLE CHECK. An element
 * counts when all of these hold, as Chrome reports them:
 *   - it is an `a[href]`, `button`, `input` of a type a person can operate, `select`, `textarea`
 *     or `summary`
 *   - it is not `disabled` and not `aria-disabled="true"`
 *   - its rect has width and height above zero
 *   - computed `visibility` is not `hidden` and computed `opacity` is above 0.01
 *   - its rect overlaps the viewport horizontally, which is what removes the skip link. The skip
 *     link sits at `left: -9999px` until it is focused, so it is an action for a keyboard and it
 *     is not one for the eye. Counting it would have closed this check the day it was written,
 *     with the page unchanged, because it is the first interactive node in the document.
 *
 * WHAT IS ASSERTED, and each one exits non zero on its own:
 *   1. The element marked `data-el="primary-action"` exists, is an action by the definition above,
 *      and its whole rect is above the fold at both sizes.
 *   2. That element leads into the claim flow. It is an in page link and its target id resolves to
 *      an element inside `<main>`, so a decorative button or a link to a paragraph of prose cannot
 *      satisfy this row.
 *   3. It is the FIRST action in the document, by rect top then document order. A primary action
 *      above the fold with three other controls above it is not the first thing you can do.
 *   4. No element's right edge crosses the viewport width. This is measured per element and not
 *      from `documentElement.scrollWidth`, because `assets/styles.css` sets `overflow-x: hidden`
 *      on the body, which hides exactly the symptom a document level check would look for.
 *   5. Exactly one `h1`.
 *
 * Usage:
 *   node scripts/measure_fold.mjs             assert, and print the table
 *   node scripts/measure_fold.mjs --report    print the table and exit 0 whatever it says
 *
 * CHROME_PATH overrides the browser this looks for. It needs no flags, no profile of yours and no
 * network: the page is served from this checkout on a loopback port that is picked at run time.
 */

import http from 'node:http';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openSession } from '../evidence/impact/page_client.mjs';

const SCRIPT_DIR = fileURLToPath(new URL('.', import.meta.url));
const ROOT = join(SCRIPT_DIR, '..');

/**
 * The two sizes, and why these two.
 *
 * 375 by 812 is the iPhone X through 13 mini viewport and the narrowest size worth designing for.
 * 1280 by 800 is a laptop with a browser chrome of ordinary height. A fix that helps the phone by
 * wrecking the desktop is not a fix, so both are asserted rather than only the one that was red.
 */
const VIEWPORTS = [
  { name: 'phone', width: 375, height: 812, mobile: true },
  { name: 'laptop', width: 1280, height: 800, mobile: false },
];

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].filter(Boolean);

const MIME = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
]);

function findChrome() {
  for (const candidate of CHROME_CANDIDATES) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/** Ask the operating system for a port nobody is on, then let it go so Chrome can have it. */
function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

/**
 * The smallest static server that can serve this page, and it refuses to leave the checkout.
 *
 * The path is normalised and then checked against ROOT before anything is read, because a server
 * that answers `../../` is a hole even in a script that only ever talks to a browser we launched.
 */
function startServer(port) {
  const server = http.createServer((request, response) => {
    let rel = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
    if (rel.endsWith('/')) rel += 'index.html';
    const full = normalize(join(ROOT, rel));
    if (!full.startsWith(normalize(ROOT))) {
      response.writeHead(403).end('outside the checkout');
      return;
    }
    let body;
    try {
      body = readFileSync(full);
    } catch {
      response.writeHead(404).end('not here');
      return;
    }
    const dot = full.lastIndexOf('.');
    const type = MIME.get(dot === -1 ? '' : full.slice(dot).toLowerCase()) || 'application/octet-stream';
    response.writeHead(200, { 'content-type': type }).end(body);
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)));
}

/**
 * The one expression that runs in the page. It is a string because it crosses the protocol, and it
 * is the only place any measuring happens.
 *
 * IT IS GIVEN THE VIEWPORT IT IS SUPPOSED TO BE IN, RATHER THAN ASKING THE PAGE. That is not a
 * detail, it is the reason the overflow half of this check works at all. The first version read
 * `window.innerWidth` and compared every element against it, and a deliberate break, a `.lede`
 * widened to 900px inside a 375 viewport, went straight through it green. The debug print said
 * why: `window.innerWidth` came back as 917. Under mobile emulation Chrome widens the layout
 * viewport to fit content that does not fit, which is the old zoomed out mobile behaviour, so the
 * ruler grew by exactly the amount of the overflow and the overflow measured zero.
 *
 * So the comparison is against the size we asked for, and the page's own idea of its width is
 * asserted against that too. A layout viewport that has grown IS the overflow symptom, and it is
 * reported in those words.
 */
const MEASURE = (expectedWidth) => `(() => {
  const w = ${expectedWidth};
  const actualWidth = window.innerWidth;
  const h = window.innerHeight;
  const SELECTOR = 'a[href], button, select, textarea, summary, input:not([type=hidden])';
  const describe = (el) => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return {
      tag: el.tagName.toLowerCase(),
      el: el.getAttribute('data-el') || '',
      id: el.id || '',
      label: (el.textContent || el.value || el.getAttribute('aria-label') || '').trim().slice(0, 60),
      top: Math.round(r.top + window.scrollY),
      bottom: Math.round(r.bottom + window.scrollY),
      left: Math.round(r.left),
      right: Math.round(r.right),
      width: Math.round(r.width),
      height: Math.round(r.height),
      disabled: el.disabled === true || el.getAttribute('aria-disabled') === 'true',
      visibility: s.visibility,
      opacity: Number(s.opacity),
    };
  };
  const all = [...document.querySelectorAll(SELECTOR)].map(describe);
  const actionable = all.filter((d) => !d.disabled
    && d.width > 0 && d.height > 0
    && d.visibility !== 'hidden' && d.opacity > 0.01
    && d.right > 0 && d.left < w);

  // Right edge overflow, per element, because the body hides the document level symptom.
  const overflowing = [];
  for (const el of document.querySelectorAll('body *')) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    if (getComputedStyle(el).visibility === 'hidden') continue;
    if (r.right > w + 1) {
      overflowing.push({
        tag: el.tagName.toLowerCase(),
        cls: String(el.className || '').slice(0, 40),
        right: Math.round(r.right),
      });
    }
  }

  const marked = document.querySelector('[data-el="primary-action"]');
  let primary = null;
  if (marked) {
    primary = describe(marked);
    const href = marked.getAttribute('href') || '';
    primary.href = href;
    // Assertion 2 lives here because only the page can resolve its own anchor.
    const target = href.startsWith('#') ? document.getElementById(href.slice(1)) : null;
    primary.targetFound = Boolean(target);
    primary.targetInMain = Boolean(target && document.querySelector('main')
      && (document.querySelector('main') === target || document.querySelector('main').contains(target)));
  }

  return {
    width: w,
    actualWidth,
    height: h,
    h1Count: document.querySelectorAll('h1').length,
    documentScrollWidth: document.documentElement.scrollWidth,
    total: all.length,
    actionable,
    overflowing: overflowing.slice(0, 12),
    overflowCount: overflowing.length,
    primary,
    settled: document.querySelectorAll('[data-el="fields"] > *').length,
  };
})()`;

async function measure(session, viewport, url) {
  await session.send('Emulation.setDeviceMetricsOverride', {
    width: viewport.width,
    height: viewport.height,
    deviceScaleFactor: 1,
    mobile: viewport.mobile,
  });
  await session.send('Page.navigate', { url });

  /*
   * WAIT FOR THE PAGE TO STOP MOVING, NOT MERELY FOR IT TO START.
   *
   * The first version of this waited for one draft row to exist and then measured. That was wrong
   * and it was caught by its own output: two runs of the same page reported 6 actionable controls
   * and 33 actionable controls, because the rule pack arrives in a fetch and the field controls
   * are painted after the rows they sit in. A measurement taken in that window is a measurement of
   * a loading state, and a gate that reports a different number on every run is not a gate.
   *
   * So this waits for the count of interactive nodes to hold still across three consecutive polls
   * as well as for the first row to exist. The elapsed time is reported rather than swallowed,
   * because how long a visitor waits for the thing they came for is worth knowing on its own.
   */
  const started = Date.now();
  let settled = 0;
  let stable = 0;
  let previous = -1;
  while (Date.now() - started < 15000) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    const seen = await session.evaluate(
      '({rows: document.querySelectorAll(\'[data-el="fields"] > *\').length,'
      + ' nodes: document.querySelectorAll(\'a[href], button, select, textarea, summary, input:not([type=hidden])\').length})',
    );
    settled = seen.rows;
    stable = seen.nodes === previous ? stable + 1 : 0;
    previous = seen.nodes;
    if (settled > 0 && stable >= 3) break;
  }
  const settleMs = Date.now() - started;
  if (settled === 0 || stable < 3) {
    throw new Error(`the page never settled at ${viewport.width} by ${viewport.height}: `
      + `${settled} draft row(s) and an interactive node count still moving after ${settleMs} ms. `
      + 'Nothing is measured against a page that is still painting.');
  }

  const reading = await session.evaluate(MEASURE(viewport.width));
  return { viewport, settleMs, ...reading };
}

function report(reading) {
  const v = reading.viewport;
  console.log(`\n${v.name}, ${v.width} by ${v.height}`);
  console.log(`  the draft rows rendered after ${reading.settleMs} ms, ${reading.settled} row(s)`);
  console.log(`  ${reading.total} interactive node(s) in the document, ${reading.actionable.length} of them actionable`);
  console.log('  the first six actionable controls, by where they sit:');
  const ordered = [...reading.actionable].sort((a, b) => a.top - b.top);
  for (const item of ordered.slice(0, 6)) {
    const where = item.bottom <= v.height ? 'above the fold' : 'BELOW THE FOLD';
    const name = item.el || item.id || item.label || item.tag;
    console.log(`    y=${String(item.top).padStart(5)} to ${String(item.bottom).padStart(5)}  ${where.padEnd(14)} ${item.tag} ${name}`);
  }
  if (reading.primary) {
    const p = reading.primary;
    console.log(`  primary action: ${p.tag} ${p.el}, href ${p.href}, y=${p.top} to ${p.bottom}`);
  } else {
    console.log('  primary action: NONE. No element carries data-el="primary-action"');
  }
  console.log(`  layout viewport reported by the page: ${reading.actualWidth} wide, asked for ${v.width}`);
  console.log(`  h1 count ${reading.h1Count}, elements crossing the right edge ${reading.overflowCount}`);
  for (const item of reading.overflowing) {
    console.log(`    overflow: ${item.tag}.${item.cls} right edge at ${item.right}, viewport is ${v.width}`);
  }
}

function judge(reading) {
  const v = reading.viewport;
  const problems = [];
  const ordered = [...reading.actionable].sort((a, b) => a.top - b.top);

  if (!reading.primary) {
    problems.push('no element carries data-el="primary-action", so this page names nothing as the way in');
  } else {
    const p = reading.primary;
    const isActionable = reading.actionable.some((a) => a.el === 'primary-action');
    if (!isActionable) {
      problems.push(`the primary action is marked but is not actionable: disabled=${p.disabled}, `
        + `${p.width} by ${p.height}, visibility ${p.visibility}, opacity ${p.opacity}`);
    }
    if (p.bottom > v.height) {
      problems.push(`the primary action ends at y=${p.bottom} and the fold is at ${v.height}, so a visitor has to scroll to reach the first thing they can do`);
    }
    if (!p.targetFound) {
      problems.push(`the primary action points at ${p.href || '(no href)'} and nothing in the document has that id, so it leads nowhere`);
    } else if (!p.targetInMain) {
      problems.push(`the primary action points at ${p.href}, which is outside <main>, so it does not lead into the claim flow`);
    }
    if (ordered.length > 0 && ordered[0].el !== 'primary-action') {
      const first = ordered[0];
      problems.push(`the first actionable control is ${first.tag} ${first.el || first.label} at y=${first.top}, `
        + `not the primary action at y=${p.top}`);
    }
  }

  if (reading.actualWidth !== v.width) {
    problems.push(`the page reports a layout viewport of ${reading.actualWidth} where ${v.width} was asked for. `
      + 'Chrome widens the layout viewport to fit content that does not fit, so this number moving is itself the overflow');
  }
  if (reading.overflowCount > 0) {
    const worst = reading.overflowing[0];
    problems.push(`${reading.overflowCount} element(s) cross the right edge, the first being ${worst.tag}.${worst.cls} at ${worst.right} against a ${v.width} viewport`);
  }
  if (reading.h1Count !== 1) {
    problems.push(`the document has ${reading.h1Count} h1 elements and it should have exactly one`);
  }
  return problems;
}

async function main() {
  const reportOnly = process.argv.includes('--report');
  const chrome = findChrome();
  if (!chrome) {
    console.error('no Chrome found. Set CHROME_PATH to the browser binary and run this again.');
    console.error(`looked at: ${CHROME_CANDIDATES.join(', ')}`);
    process.exit(2);
  }

  const servePort = await freePort();
  const debugPort = await freePort();
  const server = await startServer(servePort);
  const url = `http://127.0.0.1:${servePort}/index.html`;
  const profile = mkdtempSync(join(tmpdir(), 'claimready-fold-'));

  const browser = spawn(chrome, [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${profile}`,
    url,
  ], { stdio: 'ignore' });

  let failed = 0;
  let session = null;
  let socket = null;
  try {
    const started = Date.now();
    while (Date.now() - started < 20000) {
      await new Promise((resolve) => setTimeout(resolve, 200));
      try {
        ({ session, socket } = await openSession(debugPort));
        break;
      } catch { /* Chrome is still coming up */ }
    }
    if (!session) throw new Error('Chrome never opened a debuggable page target');

    console.log('measure_fold: every number below was read from Chrome, in the layout it computed.');
    console.log(`browser ${chrome}`);
    console.log(`serving this checkout at ${url}`);

    for (const viewport of VIEWPORTS) {
      const reading = await measure(session, viewport, url);
      report(reading);
      const problems = judge(reading);
      if (problems.length === 0) {
        console.log(`  ${viewport.name}: PASS`);
      } else {
        failed += problems.length;
        console.log(`  ${viewport.name}: FAIL`);
        for (const problem of problems) console.log(`    ${problem}`);
      }
    }
  } finally {
    if (socket) socket.destroy();
    browser.kill();
    server.close();
    await new Promise((resolve) => setTimeout(resolve, 300));
    try { rmSync(profile, { recursive: true, force: true }); } catch { /* it is a temp dir */ }
  }

  if (reportOnly) {
    console.log(`\nreport only. ${failed} problem(s) found, and this mode exits 0 whatever they are.`);
    process.exit(0);
  }
  if (failed > 0) {
    console.error(`\nmeasure_fold FAILED with ${failed} problem(s). The page above is what a visitor meets.`);
    process.exit(1);
  }
  console.log('\nmeasure_fold passed at every viewport.');
  process.exit(0);
}

main().catch((error) => {
  console.error(`measure_fold could not run: ${error.message}`);
  process.exit(2);
});
