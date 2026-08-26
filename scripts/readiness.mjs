#!/usr/bin/env node
/**
 * ClaimReady readiness gate. Zero dependencies, Node 20.
 *
 * One ruler, printed in full every run. Rows are either engineering rows, which
 * the build owns and CI can turn red, or submission rows, which are the four
 * things a judge actually needs to exist. Owner gated rows are printed in their
 * own block with the manual step and are never counted as passes.
 *
 * The live check fetches the judge URL and requires HTTP 200 plus the flagship
 * sentence in the body. A network failure is a FAIL. It is never a skip, and it
 * is never reduced to a file existence check.
 *
 * Usage:
 *   node scripts/readiness.mjs                    full gate, exits non zero below 95 percent
 *   node scripts/readiness.mjs --ci               CI mode, exits non zero on engineering rows only
 *   node scripts/readiness.mjs --allow-undeployed permits an absent CLAIMREADY_URL, prints NOT DEPLOYED
 *   node scripts/readiness.mjs --selftest         breaks inputs on purpose to prove the gate can fail
 *
 * --allow-undeployed is ignored when CLAIMREADY_URL is set. Once the variable
 * exists, the live check always runs and always blocks.
 */

import { existsSync, readFileSync, readdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = fileURLToPath(new URL('.', import.meta.url));
const ROOT = join(SCRIPT_DIR, '..');

/** The one sentence. It leads the README, it ships in the page, and the live check looks for it. */
const FLAGSHIP =
  "The insurer's page hands your own agent its policy rules as typed tools, so a claim is " +
  'checked against your actual cover while you describe it, and only you can file it.';

/** Short enough to survive punctuation edits, long enough that nothing else matches it. */
const FLAGSHIP_FRAGMENT = 'hands your own agent its policy rules as typed tools';

/** Used when CLAIMREADY_URL is not set. The environment variable always wins. */
const DEFAULT_JUDGE_URL = 'https://claimready.vercel.app/';

const FETCH_TIMEOUT_MS = 15000;

/** Actions that stay human only. If one of these is ever a tool, the product claim is false. */
const HUMAN_ONLY_ACTIONS = [
  'file_claim',
  'submit_claim',
  'submit',
  'file',
  'request_assistance',
  'request_roadside',
  'dispatch_services',
  'dispatch',
  'override_eligibility',
  'override',
];

const PASS = 'PASS';
const FAIL = 'FAIL';
const NOT_DEPLOYED = 'NOT DEPLOYED';

const ENGINEERING = 'engineering';
const SUBMISSION = 'submission';

/* ---------------------------------------------------------------- helpers */

function read(path) {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

function listFiles(dir, suffix) {
  try {
    return readdirSync(dir).filter((f) => f.endsWith(suffix));
  } catch {
    return [];
  }
}

/**
 * Markup out, whitespace collapsed. Lets the flagship sentence be matched in full even though
 * it is line wrapped in the source and may carry markup inside it. Matching a fragment would
 * let the sentence drift a word at a time, and that sentence is the whole product claim.
 */
function normalizedText(input) {
  return input.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
}

function runNode(args, cwd) {
  return spawnSync(process.execPath, args, { cwd, encoding: 'utf8' });
}

function row(id, label, status, detail, blocking, counted = true) {
  return { id, label, status, detail, blocking, counted };
}

/**
 * Where the tool modules live. The gate resolves this rather than hard coding one path,
 * because a gate that checks a directory nobody uses reports PASS by looking at nothing,
 * or FAIL while the tools sit finished one directory across.
 */
const TOOL_DIR_CANDIDATES = [
  ['src', 'webmcp', 'tools'],
  ['src', 'tools'],
  ['src', 'mcp', 'tools'],
];

function resolveToolDir(root) {
  for (const parts of TOOL_DIR_CANDIDATES) {
    const full = join(root, ...parts);
    if (existsSync(full) && listFiles(full, '.js').length > 0) {
      return { full, rel: parts.join('/') };
    }
  }
  return null;
}

/* ----------------------------------------------------------------- checks */

async function checkLiveUrl(root, options) {
  const fromEnv = process.env.CLAIMREADY_URL;
  const url = fromEnv || DEFAULT_JUDGE_URL;
  const explicit = Boolean(fromEnv);
  const blocking = explicit || !options.allowUndeployed ? ENGINEERING : SUBMISSION;

  if (!explicit && options.allowUndeployed) {
    return row(
      'LIVE',
      'judge URL returns 200 and serves the flagship sentence',
      NOT_DEPLOYED,
      `CLAIMREADY_URL is not set. Nothing was fetched, so nothing is proven. Set the repo variable once ${DEFAULT_JUDGE_URL} is live.`,
      blocking,
    );
  }

  let response;
  try {
    response = await fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(options.timeoutMs ?? FETCH_TIMEOUT_MS),
      headers: { 'user-agent': 'claimready-readiness' },
    });
  } catch (error) {
    return row('LIVE', `judge URL ${url}`, FAIL, `fetch failed: ${error.message}`, blocking);
  }

  if (response.status !== 200) {
    return row('LIVE', `judge URL ${url}`, FAIL, `HTTP ${response.status}, expected 200`, blocking);
  }

  let body = '';
  try {
    body = await response.text();
  } catch (error) {
    return row('LIVE', `judge URL ${url}`, FAIL, `body unreadable: ${error.message}`, blocking);
  }

  if (!normalizedText(body).includes(FLAGSHIP)) {
    const near = body.includes(FLAGSHIP_FRAGMENT) ? ' The fragment is there but the sentence has drifted.' : '';
    return row(
      'LIVE',
      `judge URL ${url}`,
      FAIL,
      `HTTP 200 but the flagship sentence is not being served, so the live surface is not this build.${near}`,
      blocking,
    );
  }

  return row('LIVE', `judge URL ${url}`, PASS, `HTTP 200, flagship sentence present`, blocking);
}

function checkLicense(root) {
  const text = read(join(root, 'LICENSE'));
  if (!text) return row('LIC', 'LICENSE present', FAIL, 'no LICENSE file at the repo root', ENGINEERING);
  const ok = text.includes('MIT License') && text.includes('2026') && text.includes('Fousekis');
  return row(
    'LIC',
    'LICENSE present, MIT, current year, named holder',
    ok ? PASS : FAIL,
    ok ? 'MIT, 2026' : 'LICENSE exists but is not the expected MIT text',
    ENGINEERING,
  );
}

function checkReadme(root) {
  const text = read(join(root, 'README.md'));
  if (!text) return row('RDM', 'README opens with the one sentence', FAIL, 'no README.md', ENGINEERING);
  // The first paragraph under the title, joined, must be the sentence word for word.
  const lines = text.split(/\r?\n/);
  const titleAt = lines.findIndex((l) => l.trim().startsWith('#'));
  const paragraph = [];
  for (const line of lines.slice(titleAt + 1)) {
    if (line.trim().length === 0) {
      if (paragraph.length > 0) break;
      continue;
    }
    paragraph.push(line.trim());
  }
  const opening = normalizedText(paragraph.join(' '));
  const ok = opening === FLAGSHIP;
  return row(
    'RDM',
    'README opens with the one sentence, word for word',
    ok ? PASS : FAIL,
    ok
      ? 'the first paragraph under the title is the flagship sentence verbatim'
      : `the first paragraph under the title is not the flagship sentence. Found: ${opening.slice(0, 90)}`,
    ENGINEERING,
  );
}

function checkStyleGate(root) {
  const result = runNode([join(root, 'scripts', 'check_style.mjs'), '--quiet'], root);
  const ok = result.status === 0;
  const detail = ok
    ? 'no em dash, annotations that exist, no foreign project names, tool budgets'
    : (result.stderr || result.stdout || '').trim().split(/\r?\n/).slice(0, 4).join(' | ');
  return row('STY', 'node scripts/check_style.mjs', ok ? PASS : FAIL, detail, ENGINEERING);
}

function checkUnitTests(root) {
  const dir = join(root, 'tests', 'unit');
  if (!existsSync(dir)) {
    return row('TST', 'node --test tests/unit', FAIL, 'tests/unit does not exist yet', ENGINEERING);
  }
  const result = runNode(['--test', 'tests/unit'], root);
  const ok = result.status === 0;
  const output = `${result.stdout || ''}${result.stderr || ''}`;
  const summary = (output.match(/^# (pass|fail) \d+$/gm) || []).join(', ');
  return row(
    'TST',
    'node --test tests/unit',
    ok ? PASS : FAIL,
    summary || (ok ? 'test run clean' : 'test run failed, see the CI log'),
    ENGINEERING,
  );
}

function checkCorePurity(root) {
  const dir = join(root, 'src', 'core');
  const files = listFiles(dir, '.js');
  if (files.length === 0) {
    return row('PUR', 'src/core imports nothing from the browser', FAIL, 'src/core has no modules yet', ENGINEERING);
  }
  const banned = /\b(document|window|localStorage|sessionStorage|navigator|fetch|setTimeout|setInterval|requestAnimationFrame|XMLHttpRequest)\b/;
  const offenders = [];
  for (const file of files) {
    const source = stripComments(read(join(dir, file)) || '');
    const hit = source.match(banned);
    if (hit) offenders.push(`${file} uses ${hit[1]}`);
  }
  return row(
    'PUR',
    'src/core imports nothing from the browser',
    offenders.length === 0 ? PASS : FAIL,
    offenders.length === 0 ? `${files.length} core modules, all pure` : offenders.join(', '),
    ENGINEERING,
  );
}

function inspectToolFile(source) {
  const problems = [];
  const nameLiterals = [...source.matchAll(/(?:^|[\s{,(\[])name\s*:\s*(['"`])((?:\\.|(?!\1)[\s\S])*)\1/g)];
  if (nameLiterals.length !== 1) {
    problems.push(`expected exactly one tool name literal, found ${nameLiterals.length}`);
  }
  const name = nameLiterals.length === 1 ? nameLiterals[0][2] : null;

  if (name !== null) {
    if (!/^[a-z][a-z0-9_]*$/.test(name)) problems.push(`tool name "${name}" is not lower snake case`);
    if (name.length > 30) problems.push(`tool name "${name}" is ${name.length} characters, budget 30`);
    if (HUMAN_ONLY_ACTIONS.includes(name)) {
      problems.push(`"${name}" is a human only action and must never be registered as a tool`);
    }
  }
  if (!/annotations\s*:/.test(source)) problems.push('no annotations declared');
  if (!/readOnlyHint\s*:/.test(source)) problems.push('readOnlyHint is not declared explicitly');
  if (!/inputSchema\s*:/.test(source)) problems.push('no inputSchema');
  if (!/execute\s*[:(]/.test(source)) problems.push('no execute');
  if (/exposedTo/.test(source)) problems.push('exposedTo is set, tools must stay same origin');
  return { name, problems };
}

function checkToolFiles(root) {
  const dir = resolveToolDir(root);
  if (!dir) {
    return row(
      'TOL',
      'each tool file declares exactly one tool with annotations',
      FAIL,
      `no tool modules found. Looked in ${TOOL_DIR_CANDIDATES.map((p) => p.join('/')).join(', ')}`,
      ENGINEERING,
    );
  }
  const files = listFiles(dir.full, '.js').filter((f) => f !== 'index.js');
  const problems = [];
  const names = [];
  for (const file of files) {
    const result = inspectToolFile(read(join(dir.full, file)) || '');
    if (result.name) names.push(result.name);
    for (const p of result.problems) problems.push(`${file}: ${p}`);
  }
  return row(
    'TOL',
    'each tool file declares exactly one tool with annotations',
    problems.length === 0 ? PASS : FAIL,
    problems.length === 0
      ? `${dir.rel}, ${files.length} tools: ${names.join(', ')}`
      : `${dir.rel} | ${problems.join(' | ')}`,
    ENGINEERING,
  );
}

function checkHumanOnlyBoundary(root) {
  const dir = resolveToolDir(root);
  if (!dir) {
    return row('HUM', 'filing and assistance are never tools', FAIL, 'no tool modules to inspect yet', ENGINEERING);
  }
  const files = listFiles(dir.full, '.js');
  const offenders = [];
  for (const file of files) {
    const source = read(join(dir.full, file)) || '';
    for (const action of HUMAN_ONLY_ACTIONS) {
      const re = new RegExp(`name\\s*:\\s*['"\`]${action}['"\`]`);
      if (re.test(source)) offenders.push(`${file} registers ${action}`);
    }
  }
  return row(
    'HUM',
    'filing and assistance are never tools',
    offenders.length === 0 ? PASS : FAIL,
    offenders.length === 0 ? 'no human only action appears in the tool surface' : offenders.join(', '),
    ENGINEERING,
  );
}

/**
 * Every JavaScript file under src, which with no bundler IS the deployed bundle.
 * Grepping the source and grepping the shipped artifact are the same act here, and that
 * is only true because there is no build step. If one ever appears, this must read the output.
 */
function shippedScriptSources(root) {
  const out = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.js')) out.push(read(full) || '');
    }
  };
  walk(join(root, 'src'));
  return out.join('\n');
}

function checkIndexHtml(root) {
  const text = read(join(root, 'index.html'));
  if (!text) return row('IDX', 'index.html at the repo root', FAIL, 'no index.html, the judge URL would 404', ENGINEERING);
  const problems = [];
  if (!normalizedText(text).includes(FLAGSHIP)) {
    problems.push(
      text.includes(FLAGSHIP_FRAGMENT)
        ? 'the flagship sentence has drifted from the one the README and the live check expect'
        : 'the flagship sentence is not in the page',
    );
  }
  if (/<style[\s>]/i.test(text)) problems.push('inline style block, blocked by our Content Security Policy');
  if (/<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?\S[\s\S]*?<\/script>/i.test(text)) {
    problems.push('inline script, blocked by our Content Security Policy');
  }
  if (!/<script[^>]*\btype=["']module["'][^>]*\bsrc=/i.test(text)) {
    problems.push('no module script is loaded, so nothing registers any tool');
  }
  return row(
    'IDX',
    'index.html serves the claim, no inline code',
    problems.length === 0 ? PASS : FAIL,
    problems.length === 0 ? 'flagship sentence present, module script loaded, no inline style or script' : problems.join(' | '),
    ENGINEERING,
  );
}

function checkApiDetection(root) {
  const bundle = shippedScriptSources(root);
  if (!bundle.trim()) {
    return row('API', 'both WebMCP entry point names are feature detected', FAIL, 'no JavaScript under src yet', ENGINEERING);
  }
  const problems = [];
  if (!bundle.includes('document.modelContext')) problems.push('document.modelContext is never read');
  if (!bundle.includes('navigator.modelContext')) {
    problems.push('the navigator.modelContext fallback is missing, so one judge path registers nothing');
  }
  if (/\bexposedTo\b/.test(bundle)) problems.push('exposedTo is set somewhere, tools must stay same origin');
  return row(
    'API',
    'both WebMCP entry point names are feature detected',
    problems.length === 0 ? PASS : FAIL,
    problems.length === 0 ? 'document.modelContext and the navigator.modelContext fallback both read, no exposedTo' : problems.join(' | '),
    ENGINEERING,
  );
}

/**
 * Exactly one tool surface may be reachable on the judge's origin.
 *
 * The whole repo is deployed, so any other HTML page that registers tools is publicly
 * reachable too. A visitor's agent that lands on it sees a second set of tools, with its own
 * vocabulary, that nothing in the gate audits. Scaffolding pages have to go before deploy,
 * not just be tidied up.
 */
function checkSingleToolSurface(root) {
  const pages = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      // Only what the host never serves is skipped. Everything else in the repo is deployed,
      // docs and tests included, so everything else is in scope for this check.
      if (['.git', 'node_modules', '.vercel'].includes(entry.name)) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.html?$/i.test(entry.name)) pages.push(full);
    }
  };
  walk(root);

  const rogue = pages
    .filter((p) => relative(root, p).split('\\').join('/') !== 'index.html')
    .filter((p) => {
      const source = read(p) || '';
      return source.includes('registerTool') || source.includes('modelContext');
    })
    .map((p) => relative(root, p).split('\\').join('/'));

  return row(
    'ONE',
    'exactly one tool surface is reachable on the origin',
    rogue.length === 0 ? PASS : FAIL,
    rogue.length === 0
      ? 'index.html is the only page that registers tools'
      : `a second tool surface would be deployed and reachable: ${rogue.join(', ')}. Delete it before deploy.`,
    ENGINEERING,
  );
}

function checkVercelConfig(root) {
  const raw = read(join(root, 'vercel.json'));
  if (!raw) return row('VRC', 'vercel.json with security headers', FAIL, 'no vercel.json', ENGINEERING);
  let config;
  try {
    config = JSON.parse(raw);
  } catch (error) {
    return row('VRC', 'vercel.json with security headers', FAIL, `invalid JSON: ${error.message}`, ENGINEERING);
  }
  const headers = (config.headers || []).flatMap((entry) => entry.headers || []);
  const byKey = new Map(headers.map((h) => [String(h.key).toLowerCase(), String(h.value)]));
  const csp = byKey.get('content-security-policy') || '';
  const problems = [];
  for (const directive of ["default-src 'self'", "script-src 'self'", "style-src 'self'", "frame-ancestors 'none'", "base-uri 'none'"]) {
    if (!csp.includes(directive)) problems.push(`CSP missing ${directive}`);
  }
  if (byKey.get('x-content-type-options') !== 'nosniff') problems.push('X-Content-Type-Options is not nosniff');
  if (!byKey.has('referrer-policy')) problems.push('no Referrer-Policy');

  // The scripts are not content hashed, so without a revalidate rule a judge can be served a
  // fresh index.html against a stale module, and the live check would not notice because it
  // only ever reads the HTML.
  const revalidated = (config.headers || [])
    .filter((entry) => (entry.headers || []).some(
      (h) => String(h.key).toLowerCase() === 'cache-control' && /max-age=0|no-store|no-cache/.test(String(h.value)),
    ))
    .map((entry) => entry.source);
  for (const path of ['/src/(.*)', '/assets/(.*)']) {
    if (!revalidated.includes(path)) problems.push(`${path} is not set to revalidate, so a stale bundle can be served`);
  }
  if (raw.includes('Permissions-Policy') && raw.includes('tools')) {
    problems.push('a Permissions-Policy entry for tools would loosen the default of self');
  }
  return row(
    'VRC',
    'vercel.json with a strict Content Security Policy',
    problems.length === 0 ? PASS : FAIL,
    problems.length === 0 ? 'CSP, nosniff and Referrer-Policy all present' : problems.join(' | '),
    ENGINEERING,
  );
}

function checkPublicRepo(root) {
  const result = spawnSync('git', ['-C', root, 'remote', 'get-url', 'origin'], { encoding: 'utf8' });
  const url = (result.stdout || '').trim();
  const ok = result.status === 0 && url.length > 0;
  return row(
    'D1',
    'deliverable: public repo with the licence visible',
    ok ? PASS : FAIL,
    ok ? url : 'no git remote named origin yet',
    SUBMISSION,
  );
}

function checkDescription(root) {
  const path = join(root, 'docs', 'submission', 'description.md');
  const text = read(path);
  if (!text) {
    return row('D3', 'deliverable: written description', FAIL, 'docs/submission/description.md does not exist', SUBMISSION);
  }
  // The four elements the challenge rules require the description to cover, in the organizer's
  // own words: "Why your use case is a strong fit for WebMCP", "How it creates a better user
  // experience", "what people and agents can do together that was difficult or impossible
  // before", "Briefly explain how you implemented WebMCP". An earlier version of this check
  // looked for "theme fit", which appears nowhere in the rules: it confused the Stage One
  // pass/fail gate on fitting the theme with this deliverable. Corrected against the live rules
  // page on 2026-08-26, https://webmcp.devpost.com/rules
  const required = ['fit for webmcp', 'better', 'impossible', 'implemented'];
  const lowered = text.toLowerCase();
  const missing = required.filter((token) => !lowered.includes(token));
  return row(
    'D3',
    'deliverable: written description, four mandatory elements',
    missing.length === 0 ? PASS : FAIL,
    missing.length === 0 ? 'all four elements addressed' : `not yet addressed: ${missing.join(', ')}`,
    SUBMISSION,
  );
}

function checkVideo(root) {
  const path = join(root, 'docs', 'submission', 'video.md');
  const text = read(path);
  if (!text) {
    return row('D4', 'deliverable: public video under three minutes', FAIL, 'docs/submission/video.md does not exist', SUBMISSION);
  }
  const link = text.match(/https:\/\/(www\.)?(youtube\.com|youtu\.be)\/\S+/);
  return row(
    'D4',
    'deliverable: public video under three minutes',
    link ? PASS : FAIL,
    link ? link[0] : 'no public video link recorded yet',
    SUBMISSION,
  );
}

/* ------------------------------------------------------------ owner gated */

function ownerGatedRows() {
  return [
    {
      id: 'O1',
      label: 'video uploaded to YouTube as public, not unlisted',
      step: 'owner uploads the rendered cut, sets visibility to Public, pastes the link into docs/submission/video.md',
    },
    {
      id: 'O2',
      label: 'Devpost project created with every field filled',
      step: 'owner opens the hackathon submission form and pastes the repo URL, the live URL, the description and the video',
    },
    {
      id: 'O3',
      label: 'the form reads Submitted',
      step: 'owner presses Submit. A draft scores zero. Submit early, then edit in place',
    },
    {
      id: 'O4',
      label: 'Chrome origin trial token registered for the production domain',
      step: 'owner registers the stable production origin so judges need no browser flag, then the token meta tag ships in index.html',
    },
    {
      id: 'O5',
      label: 'tools proven callable in a real judge path',
      step: 'owner opens the live URL in the ChatGPT desktop browser, or Chrome with the WebMCP testing flag plus the Tool Inspector extension, and runs the three example prompts from the README',
    },
  ];
}

/* ------------------------------------------------------------------ print */

function pad(value, width) {
  const text = String(value);
  return text.length >= width ? text : text + ' '.repeat(width - text.length);
}

function printTable(rows) {
  console.log(`${pad('ID', 6)}${pad('STATUS', 14)}${pad('BLOCKS', 13)}CHECK`);
  console.log('-'.repeat(96));
  for (const r of rows) {
    console.log(`${pad(r.id, 6)}${pad(r.status, 14)}${pad(r.blocking, 13)}${r.label}`);
    if (r.detail) console.log(`${' '.repeat(33)}${r.detail}`);
  }
}

/* --------------------------------------------------------------- selftest */

/**
 * Break three inputs on purpose and require each check to report FAIL.
 * A gate that has never been seen to fail is not evidence of anything.
 */
async function selftest() {
  const results = [];
  const sandbox = mkdtempSync(join(tmpdir(), 'claimready-selftest-'));

  writeFileSync(join(sandbox, 'README.md'), '# ClaimReady\n\nA page about claims.\n', 'utf8');
  const readmeRow = checkReadme(sandbox);
  results.push({ name: 'README missing the flagship sentence', expected: FAIL, actual: readmeRow.status });

  writeFileSync(join(sandbox, 'note.md'), `a ${String.fromCodePoint(0x2014)} b\n`, 'utf8');
  const styleResult = runNode([join(ROOT, 'scripts', 'check_style.mjs'), '--root', sandbox, '--quiet'], ROOT);
  results.push({
    name: 'style gate against a file holding an em dash',
    expected: FAIL,
    actual: styleResult.status === 0 ? PASS : FAIL,
  });

  const savedUrl = process.env.CLAIMREADY_URL;
  process.env.CLAIMREADY_URL = 'https://claimready-selftest-host-that-does-not-exist.invalid/';
  const liveRow = await checkLiveUrl(ROOT, { allowUndeployed: true, timeoutMs: 5000 });
  if (savedUrl === undefined) delete process.env.CLAIMREADY_URL;
  else process.env.CLAIMREADY_URL = savedUrl;
  results.push({ name: 'live check against an unreachable host', expected: FAIL, actual: liveRow.status });

  console.log('readiness selftest: each broken input must produce FAIL\n');
  let bad = 0;
  for (const r of results) {
    const ok = r.actual === r.expected;
    if (!ok) bad += 1;
    console.log(`  ${ok ? 'ok  ' : 'BAD '} ${pad(r.actual, 14)} ${r.name}`);
  }
  console.log(`\nsandbox: ${sandbox}`);
  if (bad > 0) {
    console.error(`\nselftest FAILED. ${bad} check(s) stayed green on deliberately broken input.`);
    process.exit(1);
  }
  console.log('\nselftest passed. The gate has teeth.');
  process.exit(0);
}

/* ------------------------------------------------------------------- main */

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--selftest')) {
    await selftest();
    return;
  }
  const options = {
    ci: argv.includes('--ci'),
    allowUndeployed: argv.includes('--allow-undeployed'),
  };

  const rows = [
    await checkLiveUrl(ROOT, options),
    checkIndexHtml(ROOT),
    checkApiDetection(ROOT),
    checkSingleToolSurface(ROOT),
    checkReadme(ROOT),
    checkLicense(ROOT),
    checkVercelConfig(ROOT),
    checkStyleGate(ROOT),
    checkUnitTests(ROOT),
    checkCorePurity(ROOT),
    checkToolFiles(ROOT),
    checkHumanOnlyBoundary(ROOT),
    checkPublicRepo(ROOT),
    checkDescription(ROOT),
    checkVideo(ROOT),
  ];

  console.log('ClaimReady readiness gate');
  console.log(`repo: ${ROOT}`);
  console.log(`run:  node ${relative(ROOT, fileURLToPath(import.meta.url)).split('\\').join('/')}${argv.length ? ' ' + argv.join(' ') : ''}\n`);
  printTable(rows);

  const counted = rows.filter((r) => r.counted);
  const passed = counted.filter((r) => r.status === PASS);
  const percent = counted.length === 0 ? 0 : Math.round((passed.length / counted.length) * 1000) / 10;

  console.log('\nowner gated, never counted as passes');
  console.log('-'.repeat(96));
  for (const o of ownerGatedRows()) {
    console.log(`${pad(o.id, 6)}${pad('OWNER GATED', 14)}${pad('manual', 13)}${o.label}`);
    console.log(`${' '.repeat(33)}${o.step}`);
  }

  const undeployed = rows.some((r) => r.status === NOT_DEPLOYED);
  const engineeringFailures = rows.filter((r) => r.blocking === ENGINEERING && r.status !== PASS);
  const submissionFailures = rows.filter((r) => r.blocking === SUBMISSION && r.status !== PASS);

  console.log('\n' + '='.repeat(96));
  console.log(`score: ${passed.length} of ${counted.length} required rows, ${percent} percent${undeployed ? ' (provisional, the live row proved nothing)' : ''}`);
  console.log(`engineering rows outstanding: ${engineeringFailures.length}`);
  console.log(`submission rows outstanding:  ${submissionFailures.length}`);
  if (undeployed) {
    console.log('SUBMISSION BLOCKING: the judge URL was not fetched. Set CLAIMREADY_URL and run again.');
  }

  if (options.ci) {
    if (engineeringFailures.length > 0) {
      console.error(`\nCI: FAIL. ${engineeringFailures.map((r) => r.id).join(', ')}`);
      process.exit(1);
    }
    console.log('\nCI: engineering rows green. Submission rows are still outstanding and are printed above.');
    process.exit(0);
  }

  if (percent < 95) {
    console.error(`\nNOT READY. ${percent} percent is below the 95 percent gate.`);
    process.exit(1);
  }
  console.log('\nREADY.');
  process.exit(0);
}

main().catch((error) => {
  console.error(`readiness crashed: ${error.stack || error.message}`);
  process.exit(1);
});
