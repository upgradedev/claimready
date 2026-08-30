#!/usr/bin/env node
/**
 * ClaimReady readiness gate. Zero dependencies, Node 20.
 *
 * One ruler, printed in full every run. Rows are engineering rows, which the
 * build owns and CI can turn red, or deliverable rows, which are the things a
 * judge needs to exist. A deliverable row blocks the exit code in EVERY mode,
 * --ci included. A missing mandatory deliverable that leaves a green exit is
 * the exact failure this gate exists to prevent, so there is no mode in which
 * it is survivable.
 *
 * EVERY ROW CARRIES A TIER, AND THE TIER SAYS WHO IS ASKING.
 *   mandatory     the organizer requires it. Quoted from the rules beside the
 *                 tier constants below. Five rows: LIVE, D1, LIC, D3, D4
 *   recommended   we require it of ourselves, because it protects a mandatory
 *                 row or a judging criterion. Everything else in the table
 *   optional      nobody requires it. Printed, never counted
 *   owner gated   no script can prove it. Counted separately, never a pass
 * The gate used to print one undifferentiated list, which invited the reading
 * that every red row was equally urgent, and it carried the Chrome origin trial
 * as an owner gated row inside the READY TO SUBMIT tally. The rules ask for no
 * origin trial. Counting one made the entry look further from ready than it was.
 *
 * Owner gated rows are printed in their own block with the manual step. No
 * script can prove any of them, so they are not passes. They ARE counted in
 * the second tally, because "is this ready to submit" is a question that
 * includes pressing Submit, and a percentage that leaves that out answers a
 * smaller question than a reader will assume it does.
 *
 * THE TOOL SURFACE IS READ FROM THE CODE THAT PUBLISHES IT, BOTH HALVES. The
 * imperative half from register.describeToolSurface, the declarative half from
 * declarative_form.js joined to the toolname attribute in index.html. Listing
 * src/webmcp/tools/*.js and calling that the surface is what this gate did
 * before, and it could not see the declarative form at all.
 *
 * The live check fetches the judge URL and requires HTTP 200 plus the flagship
 * sentence in the body. A network failure is a FAIL. It is never a skip, and it
 * is never reduced to a file existence check.
 *
 * Usage:
 *   node scripts/readiness.mjs                    full gate, fetches the judge URL
 *   node scripts/readiness.mjs --ci               CI mode: engineering and deliverable rows block
 *   node scripts/readiness.mjs --allow-undeployed permits an absent CLAIMREADY_URL, prints NOT DEPLOYED
 *   node scripts/readiness.mjs --selftest         breaks every row on purpose to prove each can fail
 *
 * --allow-undeployed is ignored when CLAIMREADY_URL is set. Once the variable
 * exists, the live check always runs and always blocks.
 */

import { existsSync, readFileSync, readdirSync, mkdtempSync, writeFileSync, cpSync, rmSync } from 'node:fs';
import { join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = fileURLToPath(new URL('.', import.meta.url));
const ROOT = join(SCRIPT_DIR, '..');

/** The one sentence. It leads the README, it ships in the page, and the live check looks for it. */
const FLAGSHIP =
  "The insurer's page hands your own agent its policy rules as typed tools, so you learn " +
  'what you are covered for while you are still describing the crash.';

/** Short enough to survive punctuation edits, long enough that nothing else matches it. */
const FLAGSHIP_FRAGMENT = 'hands your own agent its policy rules as typed tools';

/**
 * Used when CLAIMREADY_URL is not set. The environment variable always wins.
 *
 * This is production. It has to be, because a default that points somewhere else turns the LIVE
 * row into a row a reader is taught to ignore, and a row a reader is taught to ignore is worse
 * than no row: it is the one that will be red on the day the site is genuinely down. The previous
 * default pointed at a Vercel domain that was never taken and answered 404.
 */
const DEFAULT_JUDGE_URL = 'https://upgradedev.github.io/claimready/';

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
  // Pinning is the third human only control on the page and the README names it as one, so the
  // blocklist has to cover it or that sentence is unbacked. Nothing can be talked into unpinning
  // a field a claimant checked, because no tool exists to try.
  'pin_field',
  'unpin_field',
  'lock_field',
  'unlock_field',
];

const PASS = 'PASS';
const FAIL = 'FAIL';
const NOT_DEPLOYED = 'NOT DEPLOYED';

const ENGINEERING = 'engineering';
const DELIVERABLE = 'deliverable';

/**
 * WHAT THE ORGANIZER REQUIRES, AND WHAT WE REQUIRE OF OURSELVES. Four tiers, and the difference
 * between them is who is asking.
 *
 * Read from https://webmcp.devpost.com/rules on 2026-08-30. The rules require, in their words: a
 * working live URL "that judges can access using ChatGPT's in-app browser or Google Chrome with
 * WebMCP enabled"; a text description covering four named elements; "a URL to your public code
 * repository" which "Must be open source by including an open source license file"; and a video
 * "less than three (3) minutes" made "publicly visible on YouTube". Those five rows are MANDATORY
 * and nothing else is.
 *
 * Everything else this gate checks is RECOMMENDED: our own engineering, held to because it
 * protects a mandatory row or a judging criterion. Calling it mandatory would be inventing a rule
 * the organizer did not write, and a reader who cannot tell the two apart cannot triage.
 *
 * OPTIONAL rows are printed and are never counted in any tally. They exist because the fact is
 * worth knowing, not because anything is owed.
 *
 * OWNER GATED rows are counted separately, in their own block, and are never a pass.
 */
const MANDATORY = 'mandatory';
const RECOMMENDED = 'recommended';
const OPTIONAL = 'optional';
const OWNER_GATED = 'owner gated';

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

/**
 * `tier` says WHO is asking for this row, and it is the only input to whether the row blocks.
 *
 * There used to be a `counted` parameter here that defaulted to true and that no call site ever
 * passed, so it looked like a way to keep a row out of the score while being no such thing. Dead
 * configuration in a gate is worse than none. It is gone, and it is not coming back as a second
 * flag beside this one: `mandatory` is DERIVED here rather than passed, so no call site can ever
 * hand in a tier and a blocking flag that disagree.
 *
 * THE ONE SUBTLETY, WRITTEN DOWN RATHER THAN HIDDEN. A mandatory row blocks the exit code in every
 * mode once it has actually been evaluated. NOT DEPLOYED is not an evaluation: it is the operator
 * saying, with --allow-undeployed and no CLAIMREADY_URL, that nothing was fetched. That state is
 * never a pass, is always reported as submission blocking in its own line, and fails the default
 * mode through the percentage. What it does not do is turn a deliberate offline engineering run
 * into a red build for a check nobody asked it to make.
 */
function row(id, label, status, detail, blocking, tier = RECOMMENDED) {
  return { id, label, status, detail, blocking, tier, mandatory: tier === MANDATORY && status !== NOT_DEPLOYED };
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
  const blocking = explicit || !options.allowUndeployed ? ENGINEERING : DELIVERABLE;

  if (!explicit && options.allowUndeployed) {
    return row(
      'LIVE',
      'judge URL returns 200 and serves the flagship sentence',
      NOT_DEPLOYED,
      `CLAIMREADY_URL is not set and --allow-undeployed was passed, so nothing was fetched and nothing is proven. Drop --allow-undeployed, or set CLAIMREADY_URL, to fetch ${DEFAULT_JUDGE_URL}.`,
      blocking,
      MANDATORY,
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
    return row('LIVE', `judge URL ${url}`, FAIL, `fetch failed: ${error.message}`, blocking, MANDATORY);
  }

  if (response.status !== 200) {
    return row('LIVE', `judge URL ${url}`, FAIL, `HTTP ${response.status}, expected 200`, blocking, MANDATORY);
  }

  let body = '';
  try {
    body = await response.text();
  } catch (error) {
    return row('LIVE', `judge URL ${url}`, FAIL, `body unreadable: ${error.message}`, blocking, MANDATORY);
  }

  if (!normalizedText(body).includes(FLAGSHIP)) {
    const near = body.includes(FLAGSHIP_FRAGMENT) ? ' The fragment is there but the sentence has drifted.' : '';
    return row(
      'LIVE',
      `judge URL ${url}`,
      FAIL,
      `HTTP 200 but the flagship sentence is not being served, so the live surface is not this build.${near}`,
      blocking,
      MANDATORY,
    );
  }

  return row('LIVE', `judge URL ${url}`, PASS, `HTTP 200, flagship sentence present`, blocking, MANDATORY);
}

function checkLicense(root) {
  const text = read(join(root, 'LICENSE'));
  if (!text) return row('LIC', 'LICENSE present', FAIL, 'no LICENSE file at the repo root', ENGINEERING, MANDATORY);
  const ok = text.includes('MIT License') && text.includes('2026') && text.includes('Fousekis');
  return row(
    'LIC',
    'LICENSE present, MIT, current year, named holder',
    ok ? PASS : FAIL,
    ok ? 'MIT, 2026' : 'LICENSE exists but is not the expected MIT text',
    ENGINEERING,
    MANDATORY,
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
      'each IMPERATIVE tool file declares exactly one tool with annotations',
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
    'each IMPERATIVE tool file declares exactly one tool with annotations',
    problems.length === 0 ? PASS : FAIL,
    problems.length === 0
      ? `${dir.rel}, ${files.length} tools: ${names.join(', ')}`
      : `${dir.rel} | ${problems.join(' | ')}`,
    ENGINEERING,
  );
}

/* ------------------------------------------------------- the tool surface */

/**
 * THE PAGE PUBLISHES TWO SURFACES AND THIS GATE USED TO READ ONE.
 *
 * `checkToolFiles` and the old `checkHumanOnlyBoundary` both listed `src/webmcp/tools/*.js` and
 * called the result "the tool surface". That was true when the page had only the imperative half.
 * It stopped being true when the page grew a declarative form: `src/webmcp/declarative_form.js`
 * plus four attributes on markup in index.html publish a tenth callable name that no tool file
 * declares and no directory walk can see. A blocklist that reads a directory would have watched a
 * filing capability appear on the declarative surface and reported PASS.
 *
 * So the surface is now enumerated from the code that publishes it, both halves:
 *   imperative   register.describeToolSurface({}), which is register.js's own answer to
 *                "what does this page hand an agent", built from ALWAYS_ON_TOOLS and
 *                CONDITIONAL_TOOLS rather than from a file listing
 *   declarative  declarative_form.FORM_TOOL_NAME, joined to the `toolname` attribute actually
 *                present in the shipped index.html, because the browser reads the markup and not
 *                the module
 *
 * WHY OUT OF PROCESS. `describeToolSurface` has to be imported to be asked, and the selftest runs
 * each check twice against one sandbox, before and after a break. Node caches a module by resolved
 * URL, and register.js pulls in nine tool modules by relative specifier that no query string on the
 * parent can bust, so an in process import would answer the second call from the first call's
 * cache and the broken half would pass. A child process has no cache to inherit.
 *
 * WHY THE COUNT IS ASSERTED. `describeOne` inside register.js returns null when a factory throws,
 * and `describeToolSurface` drops nulls. A gate that trusted the returned list would therefore
 * report a clean surface by being handed a shorter one, which is strictly worse than the directory
 * walk it replaces. The expected count is read from the two exported lists in the same process
 * that built the surface, so the two cannot be read from different revisions of the file.
 *
 * @param {string} root
 * @returns {{names: string[], imperative: string[], declarative: string[], problems: string[], scanned: string}}
 */
function enumerateToolSurface(root) {
  const problems = [];
  const probe = [
    "import { pathToFileURL } from 'node:url';",
    "import { join } from 'node:path';",
    'const root = process.argv[1];',
    'const at = (p) => pathToFileURL(join(root, p)).href;',
    "const register = await import(at('src/webmcp/register.js'));",
    "const form = await import(at('src/webmcp/declarative_form.js'));",
    'const built = register.describeToolSurface({});',
    'process.stdout.write(JSON.stringify({',
    '  imperative: built.map((entry) => (entry && typeof entry.name === "string" ? entry.name : null)),',
    '  expected: register.ALWAYS_ON_TOOLS.length + register.CONDITIONAL_TOOLS.length,',
    '  declarative: [form.FORM_TOOL_NAME],',
    '}));',
  ].join('\n');

  const run = spawnSync(process.execPath, ['--input-type=module', '-e', probe, root], { encoding: 'utf8' });
  if (run.status !== 0 || !run.stdout) {
    const said = (run.stderr || run.stdout || 'no output').trim().split(/\r?\n/).slice(0, 3).join(' | ');
    return {
      names: [],
      imperative: [],
      declarative: [],
      problems: [`the tool surface could not be enumerated: ${said}`],
      scanned: 'nothing',
    };
  }

  let answer;
  try {
    answer = JSON.parse(run.stdout);
  } catch (error) {
    return {
      names: [],
      imperative: [],
      declarative: [],
      problems: [`the tool surface probe did not return JSON: ${error.message}`],
      scanned: 'nothing',
    };
  }

  const imperative = answer.imperative.filter((name) => typeof name === 'string' && name.length > 0);
  if (answer.imperative.includes(null)) {
    problems.push('at least one tool factory refused to produce a named descriptor, so the surface an agent is handed is shorter than the code declares');
  }
  if (imperative.length !== answer.expected) {
    problems.push(
      `register.js declares ${answer.expected} tools and describeToolSurface built ${imperative.length}. `
      + 'A surface that reports fewer tools than it declares is a gate looking at less than it says it is.',
    );
  }

  // The declarative half exists in two places and the browser reads only one of them: the markup.
  // Comments are stripped first, because index.html documents the four attribute NAMES in a
  // comment above the form and a scan that counted those would find a tool that is not there.
  const html = (read(join(root, 'index.html')) || '').replace(/<!--[\s\S]*?-->/g, ' ');
  const markupNames = [...html.matchAll(/\btoolname\s*=\s*"([^"]*)"/gi)].map((m) => m[1]);
  const declared = answer.declarative.filter((name) => typeof name === 'string' && name.length > 0);

  for (const name of declared) {
    if (!markupNames.includes(name)) {
      problems.push(
        `declarative_form.js publishes "${name}" and index.html carries `
        + `${markupNames.length === 0 ? 'no toolname attribute at all' : markupNames.map((n) => `"${n}"`).join(', ')}. `
        + 'The browser reads the markup, so the module is describing a tool nobody can call.',
      );
    }
  }
  for (const name of markupNames) {
    if (!declared.includes(name)) {
      problems.push(`index.html publishes the declarative tool "${name}" and no module in src declares it.`);
    }
  }

  const names = [...imperative, ...new Set([...declared, ...markupNames])];
  for (const name of names) {
    if (!/^[a-z][a-z0-9_]*$/.test(name)) problems.push(`tool name "${name}" is not lower snake case`);
    if (name.length > 30) problems.push(`tool name "${name}" is ${name.length} characters, budget 30`);
  }

  return {
    names,
    imperative,
    declarative: [...new Set([...declared, ...markupNames])],
    problems,
    scanned: `${imperative.length} imperative from register.js, ${new Set([...declared, ...markupNames]).size} declarative from declarative_form.js and index.html`,
  };
}

function checkToolSurface(root) {
  const surface = enumerateToolSurface(root);
  return row(
    'SUR',
    'the published surface, imperative and declarative, is enumerated from the code that publishes it',
    surface.problems.length === 0 ? PASS : FAIL,
    surface.problems.length === 0
      ? `${surface.scanned}: ${surface.names.join(', ')}`
      : surface.problems.join(' | '),
    ENGINEERING,
    RECOMMENDED,
  );
}

/**
 * No human only action is callable, on EITHER surface.
 *
 * The list this walks is the one `enumerateToolSurface` built from the publishing code, so a
 * filing capability added as a tool descriptor, as a `toolname` on the form, or as a rename of
 * FORM_TOOL_NAME is caught by the same row. The old version read a directory and could only ever
 * see the first of those three.
 */
function checkHumanOnlyBoundary(root) {
  const surface = enumerateToolSurface(root);
  if (surface.problems.some((p) => p.startsWith('the tool surface could not be enumerated'))) {
    return row('HUM', 'filing, assistance and pinning are never tools, on either surface', FAIL, surface.problems[0], ENGINEERING, RECOMMENDED);
  }

  const offenders = [];
  for (const name of surface.imperative) {
    if (HUMAN_ONLY_ACTIONS.includes(name)) offenders.push(`the imperative surface publishes ${name}`);
  }
  for (const name of surface.declarative) {
    if (HUMAN_ONLY_ACTIONS.includes(name)) offenders.push(`the declarative form publishes ${name}`);
  }

  return row(
    'HUM',
    'filing, assistance and pinning are never tools, on either surface',
    offenders.length === 0 ? PASS : FAIL,
    offenders.length === 0
      ? `no human only action appears among the ${surface.names.length} published names (${surface.scanned})`
      : offenders.join(', '),
    ENGINEERING,
    RECOMMENDED,
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
  if (!raw) return row('VRC', 'vercel.json, a fallback host config, carries a strict CSP', FAIL, 'no vercel.json', ENGINEERING);
  let config;
  try {
    config = JSON.parse(raw);
  } catch (error) {
    return row('VRC', 'vercel.json, a fallback host config, carries a strict CSP', FAIL, `invalid JSON: ${error.message}`, ENGINEERING);
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
    'vercel.json, a fallback host config, carries a strict CSP. Production does not read it',
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
    DELIVERABLE,
    MANDATORY,
  );
}

function checkDescription(root) {
  const path = join(root, 'docs', 'submission', 'description.md');
  const text = read(path);
  if (!text) {
    return row('D3', 'deliverable: written description', FAIL, 'docs/submission/description.md does not exist', DELIVERABLE, MANDATORY);
  }
  // The four elements the challenge rules require the description to cover, in the organizer's
  // own words: "Why your use case is a strong fit for WebMCP", "How it creates a better user
  // experience", "what people and agents can do together that was difficult or impossible
  // before", "Briefly explain how you implemented WebMCP". An earlier version of this check
  // looked for "theme fit", which appears nowhere in the rules: it confused the Stage One
  // pass/fail gate on fitting the theme with this deliverable. Corrected against the live rules
  // page on 2026-08-26, https://webmcp.devpost.com/rules
  //
  // WHY THE THIRD ELEMENT ACCEPTS EITHER WORD. The rules say "difficult or impossible", and this
  // row used to demand the literal "impossible". That turned the gate into a ratchet pointing the
  // wrong way: a maintainer who noticed the description was overclaiming, and softened it to the
  // organizer's own lower bar, turned CI red and was pushed straight back into the overclaim. A
  // gate is allowed to insist the element is addressed. It is not allowed to insist on the
  // stronger of the two words the rules themselves offer. Each entry below is a list of accepted
  // spellings and one of them has to appear.
  const required = [
    ['fit for webmcp'],
    ['better'],
    ['impossible', 'difficult'],
    ['implemented'],
  ];
  const lowered = text.toLowerCase();
  const missing = required
    .filter((alternatives) => !alternatives.some((token) => lowered.includes(token)))
    .map((alternatives) => alternatives.join(' or '));
  return row(
    'D3',
    'deliverable: written description, four mandatory elements',
    missing.length === 0 ? PASS : FAIL,
    missing.length === 0 ? 'all four elements addressed' : `not yet addressed: ${missing.join(', ')}`,
    DELIVERABLE,
    MANDATORY,
  );
}

function checkVideo(root) {
  const path = join(root, 'docs', 'submission', 'video.md');
  const text = read(path);
  if (!text) {
    return row('D4', 'deliverable: public video under three minutes', FAIL, 'docs/submission/video.md does not exist', DELIVERABLE, MANDATORY);
  }
  const link = text.match(/https:\/\/(www\.)?(youtube\.com|youtu\.be)\/\S+/);
  return row(
    'D4',
    'deliverable: public video under three minutes',
    link ? PASS : FAIL,
    link ? link[0] : 'no public video link recorded yet',
    DELIVERABLE,
    MANDATORY,
  );
}

/* ------------------------------------------------------------ owner gated */

function ownerGatedRows() {
  return [
    {
      id: 'O1',
      label: 'video uploaded to YouTube as public, not unlisted',
      backs: 'the mandatory video row D4',
      step: 'owner uploads the rendered cut, sets visibility to Public, pastes the link into docs/submission/video.md',
    },
    {
      id: 'O2',
      label: 'Devpost project created with every field filled',
      backs: 'every mandatory row, which the form is where a judge sees',
      step: 'owner opens the hackathon submission form and pastes the repo URL, the live URL, the description and the video',
    },
    {
      id: 'O3',
      label: 'the form reads Submitted',
      backs: 'the entry existing at all',
      step: 'owner presses Submit. A draft scores zero. Submit early, then edit in place',
    },
    {
      id: 'O5',
      label: 'tools proven callable in a real judge path',
      backs: 'the mandatory live URL row LIVE, which is only worth anything if the tools answer there',
      step: 'owner opens the live URL in the ChatGPT in-app browser, or Chrome with chrome://flags/#enable-webmcp-testing, and runs the three example prompts from the README',
    },
  ];
}

/**
 * Printed, never counted, and here so nobody re adds it as a deliverable.
 *
 * THE CHROME ORIGIN TRIAL IS NOT A REQUIREMENT OF THIS CHALLENGE. It sat in the owner gated block
 * above, which is counted in the READY TO SUBMIT tally, so the gate was reporting the entry as
 * owing a token that the organizer never asked for. Read from https://webmcp.devpost.com/rules on
 * 2026-08-30, the rules say a judge accesses the project with "ChatGPT's in-app browser or Google
 * Chrome with WebMCP enabled", and for Chrome they tell the entrant to "enable
 * chrome://flags/#enable-webmcp-testing, and restart the browser". No origin trial and no token
 * appears anywhere in the rules.
 *
 * The row stays because the FACT is worth printing: stock Chrome, with no flag and no token, sees
 * nothing on this page. A judge following the organizer's own instructions is not stock Chrome, so
 * that fact costs the entry nothing, and it is the difference between a limitation stated and a
 * limitation discovered.
 */
function optionalRows() {
  return [
    {
      id: 'O4',
      label: 'Chrome origin trial token registered for the production domain',
      why: 'NOT required by the rules. Judges are told to use the ChatGPT in-app browser or chrome://flags/#enable-webmcp-testing. A token would only serve a visitor who arrives with neither',
      step: 'optional: owner registers the stable production origin, and the token meta tag then ships in index.html',
    },
  ];
}

/* ------------------------------------------------------------------ print */

function pad(value, width) {
  const text = String(value);
  return text.length >= width ? text : text + ' '.repeat(width - text.length);
}

/**
 * The table, grouped by tier, because the tier is the first thing a reader needs.
 *
 * An ungrouped table invites the reading that every red row is equally urgent. It is not: a red
 * MANDATORY row means the entry cannot be judged, and a red RECOMMENDED row means our own
 * engineering slipped. Those are different days of work.
 */
function printTable(rows) {
  console.log(`${pad('ID', 6)}${pad('STATUS', 14)}${pad('TIER', 14)}${pad('BLOCKS', 13)}CHECK`);
  console.log('-'.repeat(110));
  for (const tier of [MANDATORY, RECOMMENDED]) {
    const group = rows.filter((r) => r.tier === tier);
    if (group.length === 0) continue;
    console.log(`${tier.toUpperCase()}, ${group.length} row(s)${tier === MANDATORY ? '. Required by the organizer. Each one blocks the exit code in every mode' : '. Our own engineering, not the organizer\'s'}`);
    for (const r of group) {
      console.log(`${pad(r.id, 6)}${pad(r.status, 14)}${pad(r.tier, 14)}${pad(r.blocking, 13)}${r.label}`);
      if (r.detail) console.log(`${' '.repeat(47)}${r.detail}`);
    }
  }
}

/* --------------------------------------------------------------- selftest */

/**
 * Break every row this gate prints and require each one to refuse.
 *
 * The old version broke three of fifteen. Twelve checks had therefore never been observed to fail
 * at all, which is the same evidence as no check: a regex that matches nothing reports PASS by
 * looking at nothing, and a directory walk over an empty tree reports PASS the same way.
 *
 * Two rules make each result attributable rather than merely red.
 *
 *  1. Every case starts from a COPY OF THE REAL REPOSITORY and breaks exactly one thing in it.
 *     A sandbox holding three hand written files fails most checks for being nearly empty, and a
 *     check that fails for "nothing is here" has told you nothing about the thing you broke.
 *  2. Both halves are run and both are printed. The intact copy must PASS and the broken copy
 *     must FAIL. A check wired to a constant passes half of that and is caught by the other half.
 *
 * The detail line the broken check produced is printed next to each result, so a row that failed
 * for the wrong reason is visible instead of being counted as a success.
 */

const UNREACHABLE_HOST = 'https://claimready-selftest-host-that-does-not-exist.invalid/';

/** Directories a sandbox copy does not need. Nothing here is read by any check. */
const SANDBOX_SKIP = new Set(['.git', 'node_modules', '.vercel', 'tmp', 'video']);

/**
 * THE SKIP LIST WAS DEAD, AND A DEAD SKIP LIST HERE DESTROYS THE REPOSITORY.
 *
 * On Windows, Node hands this filter an extended length path, `\\?\C:\...`, while ROOT is a plain
 * `C:\...`. `relative` between the two cannot find a common root, so it returned the whole absolute
 * path, `rel.split('/')[0]` was that whole string, and `SANDBOX_SKIP.has` was false for every entry.
 * Nothing was ever skipped. `.git`, `tmp`, `video` and `node_modules` were all copied into all
 * seventeen sandboxes.
 *
 * That is not a tidiness bug. In a linked git worktree `.git` is a one line file pointing back at
 * the real repository, so the copy pointed there too, and the D1 case, whose break step is
 * `git remote remove origin`, deleted the ORIGIN REMOTE OF THE REAL REPOSITORY and then reported
 * `ok D1` and exited 0. It was reproduced twice on 2026-08-28 and it is what removed this
 * repository's own remote during that session.
 *
 * The prefix is stripped before comparing, and the result is asserted rather than trusted: if a
 * skipped name survives into the sandbox this throws instead of running a destructive break step
 * against whatever the copy is pointing at. A silent filter is how this got here.
 */
function makeSandbox(dest) {
  cpSync(ROOT, dest, {
    recursive: true,
    filter: (source) => {
      const plain = String(source).replace(/^\\\\\?\\/, '');
      const rel = relative(ROOT, plain).split('\\').join('/');
      if (rel === '') return true;
      return !SANDBOX_SKIP.has(rel.split('/')[0]);
    },
  });
  for (const name of SANDBOX_SKIP) {
    if (existsSync(join(dest, name))) {
      throw new Error(
        `selftest sandbox ${dest} still carries ${name}, so the skip filter is not working. `
        + 'Refusing to run break steps against it: the D1 case would edit the real repository.',
      );
    }
  }
  return dest;
}

function editFile(sandbox, relPath, transform) {
  const full = join(sandbox, relPath);
  writeFileSync(full, transform(readFileSync(full, 'utf8')), 'utf8');
}

/** Rewrite one string across every module under src, since checkApiDetection reads all of them. */
function replaceAcrossSrc(sandbox, from, to) {
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.js')) {
        const source = readFileSync(full, 'utf8');
        if (source.includes(from)) writeFileSync(full, source.split(from).join(to), 'utf8');
      }
    }
  };
  walk(join(sandbox, 'src'));
}

function git(sandbox, args) {
  return spawnSync('git', ['-C', sandbox, ...args], { encoding: 'utf8' });
}

/**
 * Publish a tool from a sandbox the way the page publishes one: a module, imported by register.js
 * and named in ALWAYS_ON_TOOLS.
 *
 * Writing the file alone is not publishing. `describeToolSurface` is built from the two lists in
 * register.js, so an unimported file is invisible to it, and a break that stopped at writing the
 * file would leave the human only rows green on both halves.
 *
 * @param {string} sandbox
 * @param {string} name the tool name to publish, normally one from HUMAN_ONLY_ACTIONS
 */
function publishSelftestTool(sandbox, name) {
  const file = 'zz_selftest_break.js';
  writeFileSync(
    join(sandbox, 'src', 'webmcp', 'tools', file),
    `export default () => ({\n  name: '${name}',\n`
    + "  description: 'Written by the readiness selftest to prove the human only boundary refuses it.',\n"
    + '  annotations: { readOnlyHint: false },\n'
    + "  inputSchema: { type: 'object', properties: {} },\n"
    + '  async execute() { return null; },\n});\n',
    'utf8',
  );
  editFile(sandbox, join('src', 'webmcp', 'register.js'), (source) => {
    const withImport = source.replace(
      "import describeClaimTool from './tools/describe_claim.js';",
      `import describeClaimTool from './tools/describe_claim.js';\nimport zzSelftestTool from './tools/${file}';`,
    );
    const wired = withImport.replace(
      'export const ALWAYS_ON_TOOLS = [',
      'export const ALWAYS_ON_TOOLS = [\n  (ctx) => zzSelftestTool(ctx),',
    );
    if (wired === source) {
      throw new Error('the selftest could not wire a tool into register.js, so its break step did nothing.');
    }
    return wired;
  });
}

function styleGateRow(sandbox) {
  const result = runNode([join(ROOT, 'scripts', 'check_style.mjs'), '--root', sandbox, '--quiet'], ROOT);
  const detail = (result.stderr || result.stdout || '').trim().split(/\r?\n/).slice(0, 2).join(' | ');
  return { status: result.status === 0 ? PASS : FAIL, detail: detail || 'no findings' };
}

async function liveRowAgainst(url) {
  const saved = process.env.CLAIMREADY_URL;
  process.env.CLAIMREADY_URL = url;
  try {
    return await checkLiveUrl(ROOT, { allowUndeployed: false, timeoutMs: 5000 });
  } finally {
    if (saved === undefined) delete process.env.CLAIMREADY_URL;
    else process.env.CLAIMREADY_URL = saved;
  }
}

/**
 * One case per row. `intact` runs the check against the untouched copy, `break` damages exactly
 * one input, and `run` reports the row afterwards. `intactSkipped` names the reason a case cannot
 * run its intact half, so the reason is printed rather than the case quietly counting for less.
 */
const SELFTEST_CASES = [
  {
    id: 'LIVE',
    name: 'the judge URL does not resolve',
    intactSkipped:
      'the intact half needs the network and would make an offline run red for the wrong reason. '
      + 'The live fetch is exercised for real by the readiness table itself.',
    run: () => liveRowAgainst(UNREACHABLE_HOST),
  },
  {
    id: 'IDX',
    name: 'index.html grows an inline style block, which our CSP forbids',
    break: (s) => editFile(s, 'index.html', (t) => t.replace('</head>', '<style>body{color:red}</style>\n</head>')),
    run: (s) => checkIndexHtml(s),
  },
  {
    id: 'IDX',
    name: 'the flagship sentence drifts by one word in the page',
    break: (s) => editFile(s, 'index.html', (t) => t.replace('typed tools', 'typed tool')),
    run: (s) => checkIndexHtml(s),
  },
  {
    id: 'API',
    name: 'the navigator.modelContext fallback is dropped, so one judge path registers nothing',
    break: (s) => replaceAcrossSrc(s, 'navigator.modelContext', 'navigator.notTheApiName'),
    run: (s) => checkApiDetection(s),
  },
  {
    id: 'ONE',
    name: 'a second page that registers tools is left in the deploy',
    break: (s) => writeFileSync(join(s, 'scratch.html'), '<p>scratch</p><script src="x.js"></script><!-- navigator.modelContext registerTool -->', 'utf8'),
    run: (s) => checkSingleToolSurface(s),
  },
  {
    id: 'RDM',
    name: 'the README stops opening with the flagship sentence',
    break: (s) => writeFileSync(join(s, 'README.md'), '# ClaimReady\n\nA page about claims.\n', 'utf8'),
    run: (s) => checkReadme(s),
  },
  {
    id: 'LIC',
    name: 'the LICENCE file is deleted',
    break: (s) => rmSync(join(s, 'LICENSE')),
    run: (s) => checkLicense(s),
  },
  {
    id: 'VRC',
    name: 'the Content Security Policy header is removed from the host config',
    break: (s) => editFile(s, 'vercel.json', (t) => t.split('Content-Security-Policy').join('X-Not-A-Policy')),
    run: (s) => checkVercelConfig(s),
  },
  {
    id: 'STY',
    name: 'a file grows an em dash',
    break: (s) => writeFileSync(join(s, 'note.md'), `a ${String.fromCodePoint(0x2014)} b\n`, 'utf8'),
    run: (s) => styleGateRow(s),
  },
  {
    id: 'TST',
    name: 'a unit test starts failing',
    break: (s) => writeFileSync(
      join(s, 'tests', 'unit', 'zz_selftest_break.test.js'),
      "import test from 'node:test';\nimport assert from 'node:assert/strict';\ntest('deliberately broken by the readiness selftest', () => { assert.equal(1, 2); });\n",
      'utf8',
    ),
    run: (s) => checkUnitTests(s),
  },
  {
    id: 'PUR',
    name: 'a core module reaches for the browser',
    break: (s) => writeFileSync(
      join(s, 'src', 'core', 'zz_selftest_break.js'),
      'export const where = window.location.href;\n',
      'utf8',
    ),
    run: (s) => checkCorePurity(s),
  },
  {
    id: 'TOL',
    name: 'a tool file ships with no annotations',
    break: (s) => writeFileSync(
      join(s, 'src', 'webmcp', 'tools', 'zz_selftest_break.js'),
      "export default () => ({\n  name: 'zz_unannotated',\n  inputSchema: { type: 'object', properties: {} },\n  async execute() { return null; },\n});\n",
      'utf8',
    ),
    run: (s) => checkToolFiles(s),
  },
  {
    id: 'TOL',
    // THE SCENARIO THAT MOVED HOUSE. The two human only cases below used to write an unimported
    // file into the tools directory, and while HUM read the directory that was enough. HUM now
    // reads what register.js publishes, so an unimported file is invisible to it, and their break
    // steps were rewritten to publish properly. That left this scenario, a human only action
    // sitting in the tools directory that nothing imports yet, covered by no case at all. It is
    // TOL's to catch, because TOL is the per file lint, and here it is being watched to catch it.
    name: 'a human only action is written as a tool file, even one register.js never imports',
    break: (s) => writeFileSync(
      join(s, 'src', 'webmcp', 'tools', 'zz_selftest_break.js'),
      "export default () => ({\n  name: 'file_claim',\n  annotations: { readOnlyHint: false },\n"
      + "  inputSchema: { type: 'object', properties: {} },\n  async execute() { return null; },\n});\n",
      'utf8',
    ),
    run: (s) => checkToolFiles(s),
  },
  {
    id: 'HUM',
    name: 'filing appears as a tool on the imperative surface',
    // THE BREAK HAS TO PUBLISH IT, NOT JUST WRITE THE FILE. This case used to drop a tool file in
    // the directory, which was enough while the gate read the directory. The gate now reads what
    // register.js actually publishes, and a file nobody imports publishes nothing. A break that
    // stopped short of publishing would leave this case green on both halves and report a gate
    // with teeth that had never been shown any.
    break: (s) => publishSelftestTool(s, 'file_claim'),
    run: (s) => checkHumanOnlyBoundary(s),
  },
  {
    id: 'HUM',
    name: 'unpinning a field appears as a tool, the third human only action',
    break: (s) => publishSelftestTool(s, 'unpin_field'),
    run: (s) => checkHumanOnlyBoundary(s),
  },
  {
    id: 'HUM',
    name: 'filing appears on the DECLARATIVE surface, through the markup a browser reads',
    // The surface the old gate could not see at all. No tool file changes: the four attributes on
    // the form in index.html are what a browser reads, so renaming one there publishes a filing
    // capability that no directory walk would ever find.
    break: (s) => editFile(s, 'index.html', (t) => t.replace('toolname="record_supporting_details"', 'toolname="file_claim"')),
    run: (s) => checkHumanOnlyBoundary(s),
  },
  {
    id: 'HUM',
    name: 'filing appears on the declarative surface, through the module that describes it',
    break: (s) => {
      editFile(s, join('src', 'webmcp', 'declarative_form.js'), (t) => t.replace(
        "export const FORM_TOOL_NAME = 'record_supporting_details';",
        "export const FORM_TOOL_NAME = 'submit_claim';",
      ));
      editFile(s, 'index.html', (t) => t.replace('toolname="record_supporting_details"', 'toolname="submit_claim"'));
    },
    run: (s) => checkHumanOnlyBoundary(s),
  },
  {
    id: 'SUR',
    name: 'a tool factory throws, so the surface an agent is handed is quietly one tool shorter',
    // describeOne swallows a throwing factory and returns null, and describeToolSurface drops the
    // null. Without the count assertion the gate would be handed eight tools, find nothing wrong
    // with any of them, and report a clean surface by looking at less of it.
    break: (s) => writeFileSync(
      join(s, 'src', 'webmcp', 'tools', 'describe_claim.js'),
      "export default () => { throw new Error('broken on purpose by the readiness selftest'); };\n",
      'utf8',
    ),
    run: (s) => checkToolSurface(s),
  },
  {
    id: 'SUR',
    name: 'the declarative form in the markup and the module that describes it stop agreeing',
    break: (s) => editFile(s, 'index.html', (t) => t.replace('toolname="record_supporting_details"', 'toolname="record_details"')),
    run: (s) => checkToolSurface(s),
  },
  {
    id: 'D1',
    name: 'the public repository has no remote',
    // The copy carries no .git, so the intact half has to build one. No network is touched.
    prepare: (s) => {
      git(s, ['init', '--quiet']);
      git(s, ['remote', 'add', 'origin', 'https://github.example.invalid/selftest/claimready.git']);
    },
    break: (s) => git(s, ['remote', 'remove', 'origin']),
    run: (s) => checkPublicRepo(s),
  },
  {
    id: 'D3',
    name: 'the description stops answering one of the four mandatory elements',
    // BOTH accepted spellings have to go. Removing only "impossible" no longer breaks anything,
    // because "difficult" is the organizer's other word for the same element and the row accepts
    // it. A break that leaves an accepted spelling behind tests nothing and would report a check
    // that had quietly stopped failing as a check that still fails.
    break: (s) => editFile(
      s,
      join('docs', 'submission', 'description.md'),
      (t) => t.split('impossible').join('hard').split('difficult').join('hard'),
    ),
    run: (s) => checkDescription(s),
  },
  {
    id: 'D4',
    name: 'the public video link is removed',
    // D4 is red in the real repository today, so the intact half is written here rather than
    // copied. That is stated in the output instead of being hidden by skipping the case.
    prepare: (s) => writeFileSync(
      join(s, 'docs', 'submission', 'video.md'),
      '# Video\n\nhttps://www.youtube.com/watch?v=selftestPlaceholder\n',
      'utf8',
    ),
    break: (s) => editFile(s, join('docs', 'submission', 'video.md'), (t) => t.replace(/https:\/\/\S+/, 'not recorded yet')),
    run: (s) => checkVideo(s),
  },
];

async function selftest() {
  const home = mkdtempSync(join(tmpdir(), 'claimready-selftest-'));
  const results = [];

  console.log('readiness selftest');
  console.log('every row is broken on purpose in its own copy of this repository.');
  console.log('the intact copy must PASS and the broken copy must FAIL. Both are printed.\n');

  for (let i = 0; i < SELFTEST_CASES.length; i += 1) {
    const testCase = SELFTEST_CASES[i];
    const sandbox = join(home, `${String(i).padStart(2, '0')}-${testCase.id}`);
    let intact = null;
    let broken = null;
    let crash = null;

    try {
      if (testCase.break) makeSandbox(sandbox);
      if (testCase.prepare) testCase.prepare(sandbox);
      if (!testCase.intactSkipped) intact = await testCase.run(sandbox);
      if (testCase.break) testCase.break(sandbox);
      broken = await testCase.run(sandbox);
    } catch (error) {
      crash = error.message;
    }

    const intactOk = testCase.intactSkipped ? true : Boolean(intact) && intact.status === PASS;
    const brokenOk = Boolean(broken) && broken.status === FAIL;
    results.push({
      id: testCase.id,
      name: testCase.name,
      sandbox,
      crash,
      intact: testCase.intactSkipped ? 'not run' : (intact ? intact.status : 'crashed'),
      intactSkipped: testCase.intactSkipped,
      broken: broken ? broken.status : 'crashed',
      detail: broken && broken.detail ? broken.detail : '',
      ok: !crash && intactOk && brokenOk,
    });

    // A copy of the repository per case adds up, and this machine has very little disk. The
    // sandbox of a case that behaved is worth nothing; the sandbox of one that did not is the
    // evidence, so that one is kept and its path is printed.
    if (results[results.length - 1].ok) {
      try { rmSync(sandbox, { recursive: true, force: true }); } catch { /* leave it, it is temp */ }
    }
  }

  let bad = 0;
  for (const r of results) {
    if (!r.ok) bad += 1;
    console.log(
      `  ${r.ok ? 'ok  ' : 'BAD '} ${pad(r.id, 6)}intact ${pad(r.intact, 9)}broken ${pad(r.broken, 9)}${r.name}`,
    );
    if (r.intactSkipped) console.log(`${' '.repeat(8)}intact half not run: ${r.intactSkipped}`);
    if (r.detail) console.log(`${' '.repeat(8)}refusal said: ${r.detail.slice(0, 150)}`);
    if (r.crash) console.log(`${' '.repeat(8)}CRASHED: ${r.crash}`);
    if (!r.ok) console.log(`${' '.repeat(8)}sandbox kept at ${r.sandbox}`);
  }

  const ids = [...new Set(SELFTEST_CASES.map((c) => c.id))];
  console.log(`\n${results.length} breaks over ${ids.length} rows: ${ids.join(', ')}`);
  console.log('no row is skipped. Every row this gate prints is broken above and refuses.');
  console.log(`sandboxes: ${home}`);

  if (bad > 0) {
    console.error(`\nselftest FAILED. ${bad} case(s) did not behave: a check stayed green on broken input, or refused good input, or crashed.`);
    process.exit(1);
  }
  console.log('\nselftest passed. Every row has been watched to fail, and to pass, for its own reason.');
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
    checkToolSurface(ROOT),
    checkHumanOnlyBoundary(ROOT),
    checkPublicRepo(ROOT),
    checkDescription(ROOT),
    checkVideo(ROOT),
  ];

  console.log('ClaimReady readiness gate');
  console.log(`repo: ${ROOT}`);
  console.log(`run:  node ${relative(ROOT, fileURLToPath(import.meta.url)).split('\\').join('/')}${argv.length ? ' ' + argv.join(' ') : ''}\n`);
  printTable(rows);

  const passed = rows.filter((r) => r.status === PASS);
  const percent = rows.length === 0 ? 0 : Math.round((passed.length / rows.length) * 1000) / 10;

  const owner = ownerGatedRows();
  console.log('\nOWNER GATED. No script can prove any of these, so none of them is ever a PASS. They ARE counted');
  console.log('-'.repeat(110));
  for (const o of owner) {
    console.log(`${pad(o.id, 6)}${pad('OWNER GATED', 14)}${pad(OWNER_GATED, 14)}${pad('manual', 13)}${o.label}`);
    console.log(`${' '.repeat(47)}backs ${o.backs}`);
    console.log(`${' '.repeat(47)}${o.step}`);
  }

  const optional = optionalRows();
  console.log('\nOPTIONAL. The organizer asks for none of this. Printed because the fact matters, NEVER counted');
  console.log('-'.repeat(110));
  for (const o of optional) {
    console.log(`${pad(o.id, 6)}${pad('NOT OWED', 14)}${pad(OPTIONAL, 14)}${pad('nothing', 13)}${o.label}`);
    console.log(`${' '.repeat(47)}${o.why}`);
    console.log(`${' '.repeat(47)}${o.step}`);
  }

  const undeployed = rows.some((r) => r.status === NOT_DEPLOYED);
  const engineeringFailures = rows.filter((r) => r.blocking === ENGINEERING && r.status !== PASS);
  const deliverableFailures = rows.filter((r) => r.blocking === DELIVERABLE && r.status !== PASS);
  const mandatoryFailures = rows.filter((r) => r.mandatory && r.status !== PASS);

  // Two tallies, because one would be read as the answer to the wrong question. The first is
  // what a script proved. The second adds the five owner gated rows, one of which is whether
  // the form reads Submitted, so it is the one that answers "is this ready to submit". Printing
  // only the first is how a build reports 93 percent while nothing has been submitted at all.
  const overallTotal = rows.length + owner.length;
  const overallPercent = Math.round((passed.length / overallTotal) * 1000) / 10;

  const mandatoryRows = rows.filter((r) => r.tier === MANDATORY);
  const mandatoryPassed = mandatoryRows.filter((r) => r.status === PASS);
  const recommendedRows = rows.filter((r) => r.tier === RECOMMENDED);
  const recommendedPassed = recommendedRows.filter((r) => r.status === PASS);

  console.log('\n' + '='.repeat(110));
  console.log(`MANDATORY, what the rules require:   ${mandatoryPassed.length} of ${mandatoryRows.length} PASS  (${mandatoryRows.map((r) => `${r.id} ${r.status}`).join(', ')})`);
  console.log(`RECOMMENDED, our own engineering:    ${recommendedPassed.length} of ${recommendedRows.length} PASS`);
  console.log(`OPTIONAL, owed to nobody:            ${optional.length} row(s) printed, 0 counted`);
  console.log(`automated rows:   ${passed.length} of ${rows.length} PASS, ${percent} percent${undeployed ? ' (provisional, the live row proved nothing)' : ''}`);
  console.log(`READY TO SUBMIT:  ${passed.length} of ${overallTotal} proven, ${overallPercent} percent. This is the number that answers the question.`);
  console.log(`  it adds the ${owner.length} owner gated rows, none of which any script can prove, and one of which is whether the form reads Submitted.`);
  console.log(`  it does NOT add the ${optional.length} optional row(s). Counting something the organizer never asked for makes the entry look further from ready than it is.`);
  console.log(`engineering rows outstanding: ${engineeringFailures.length}`);
  console.log(`deliverable rows outstanding: ${deliverableFailures.length}`);
  if (mandatoryFailures.length > 0) {
    console.log(`MANDATORY DELIVERABLES MISSING: ${mandatoryFailures.map((r) => r.id).join(', ')}. These block the exit code in every mode.`);
  }
  if (undeployed) {
    console.log('DELIVERABLE BLOCKING: the judge URL was not fetched. Drop --allow-undeployed and run again.');
  }

  if (options.ci) {
    // A mandatory deliverable is never survivable, not even in CI mode. --ci narrows what turns
    // the build red among the engineering rows. It has never been a licence to ship without a
    // video, and the row that used to FAIL here while the process exited zero was D4.
    const blocking = [...new Set([...engineeringFailures, ...mandatoryFailures])];
    if (blocking.length > 0) {
      console.error(`\nCI: FAIL. ${blocking.map((r) => r.id).join(', ')}`);
      process.exit(1);
    }
    console.log('\nCI: engineering rows green and every mandatory deliverable exists.');
    process.exit(0);
  }

  if (mandatoryFailures.length > 0) {
    console.error(`\nNOT READY. A mandatory deliverable is missing: ${mandatoryFailures.map((r) => r.id).join(', ')}.`);
    process.exit(1);
  }
  if (percent < 95) {
    console.error(`\nNOT READY. ${percent} percent is below the 95 percent gate.`);
    process.exit(1);
  }
  console.log('\nREADY. The owner gated rows above are still owed by a person.');
  process.exit(0);
}

main().catch((error) => {
  console.error(`readiness crashed: ${error.stack || error.message}`);
  process.exit(1);
});
