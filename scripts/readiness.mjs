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

import { existsSync, readFileSync, readdirSync, mkdirSync, mkdtempSync, writeFileSync, cpSync, rmSync } from 'node:fs';
import { join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = fileURLToPath(new URL('.', import.meta.url));
const ROOT = join(SCRIPT_DIR, '..');

/** The one sentence. It leads the README, it ships in the page, and the live check looks for it. */
const FLAGSHIP =
  "The insurer's page hands your own agent its rules as typed tools, so you learn " +
  'what you are covered for while still describing the crash.';

/** Short enough to survive punctuation edits, long enough that nothing else matches it. */
const FLAGSHIP_FRAGMENT = 'hands your own agent its rules as typed tools';

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

/**
 * The first paragraph under the first heading, joined into one line.
 *
 * Joined, because the sentence is wrapped in both files and a reader who rewraps it has not
 * changed it. Blank lines before the paragraph are skipped and the first blank line after it
 * ends it, so a title followed by badges followed by prose is not read as the opening.
 */
function openingParagraph(text) {
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
  return normalizedText(paragraph.join(' '));
}

/**
 * WHY THIS ROW READS TWO FILES RATHER THAN ONE.
 *
 * The one sentence is only worth having if it is the same sentence in both places a judge meets
 * it: the repository they open, and the description they read on the submission form. This row
 * used to check the README alone, which left the description free to drift, and a drift between
 * two long files is invisible until somebody reads them side by side. So both files are checked
 * here, under the same id, and the row fails if either one has moved.
 *
 * The sentence itself is also in `index.html`, and that is checked in the IDX row and again in
 * LIVE against the served bytes, so all three copies are held to the same string.
 */
function checkReadme(root) {
  const targets = [
    ['README.md', join(root, 'README.md')],
    ['docs/submission/description.md', join(root, 'docs', 'submission', 'description.md')],
  ];

  const problems = [];
  for (const [label, path] of targets) {
    const text = read(path);
    if (!text) {
      problems.push(`${label} is not there at all`);
      continue;
    }
    const opening = openingParagraph(text);
    if (opening !== FLAGSHIP) {
      problems.push(`${label} opens with: ${opening.slice(0, 70)}`);
    }
  }

  const ok = problems.length === 0;
  return row(
    'RDM',
    'README and description both open with the one sentence, word for word',
    ok ? PASS : FAIL,
    ok
      ? 'the first paragraph under the title is the flagship sentence verbatim in both files'
      : `the flagship sentence is not the opening of every file that has to carry it. ${problems.join('. ')}`,
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

/* ------------------------------------------- facts an external audit said were unproven */

/**
 * The impact study is either evidence or it is not, and the file itself says which.
 *
 * `scripts/analyze_impact.mjs` refuses to write a headline from a partial set. It prints an
 * `AWAITING_RUNS` section instead and exits 1. So there is a state where the study exists, the
 * results file exists, and the analyzer has publicly declined to draw a conclusion from it. A
 * README or a description that cites the study in that state is citing a refusal.
 *
 * This row reads the artifact and never runs the analyzer, because the analyzer OVERWRITES
 * `results.md`. A gate that rebuilds the thing it is auditing cannot tell you what was on disk.
 *
 * Three facts have to agree, and all three are read from a different place on purpose:
 *   1. the number of run files actually on disk
 *   2. the Runs column of the counts table in results.md
 *   3. the two denominators in the headline sentence
 * A headline that survives a run file being deleted is a headline nobody is checking.
 */
function checkImpactStudy(root) {
  const label = 'the impact study carries a headline its own run count supports';
  const runsDir = join(root, 'evidence', 'impact', 'runs');
  const onDisk = listFiles(runsDir, '.json').length;
  const text = read(join(root, 'evidence', 'impact', 'results.md'));

  if (!text) {
    return row('IMP', label, FAIL, `evidence/impact/results.md does not exist. ${onDisk} run file(s) are on disk`, ENGINEERING);
  }
  if (text.includes('AWAITING_RUNS')) {
    return row(
      'IMP',
      label,
      FAIL,
      `results.md says AWAITING_RUNS over ${onDisk} run file(s) on disk, so the analyzer has refused its own `
      + 'headline. A study in that state is not evidence and must not be cited as any.',
      ENGINEERING,
    );
  }

  // The counts table, read by position. Arm, runs, policy complete, then three columns this row
  // does not need. Anything that is not a data line with two numbers in those places is not a row.
  const countsBlock = text.split('## Counts')[1] || '';
  const counts = [];
  for (const line of countsBlock.split(/\r?\n/)) {
    if (!line.trim().startsWith('|')) continue;
    const cells = line.split('|').slice(1, -1).map((c) => c.trim());
    if (cells.length < 3) continue;
    if (!/^\d+$/.test(cells[1]) || !/^\d+$/.test(cells[2])) continue;
    counts.push({ arm: cells[0], runs: Number(cells[1]), ready: Number(cells[2]) });
  }

  const problems = [];
  if (counts.length === 0) {
    problems.push('results.md has no readable counts table, so there is nothing to reconcile a headline against');
  }

  const tableTotal = counts.reduce((sum, c) => sum + c.runs, 0);
  if (counts.length > 0 && tableTotal !== onDisk) {
    problems.push(
      `the counts table totals ${tableTotal} run(s) and ${onDisk} run file(s) are on disk. `
      + 'results.md was written from a different set of runs than the one in the repository.',
    );
  }

  const headlineBlock = text.split('## The one sentence this supports')[1] || '';
  const headline = (headlineBlock.split(/\r?\n/).find((l) => l.trim().startsWith('>')) || '').trim();
  if (!headline) {
    problems.push('results.md carries no headline sentence, so the study concluded nothing a judge could read');
  } else {
    const pairs = [...headline.matchAll(/\b(\d+)\s+of\s+(\d+)\b/g)].map((m) => [Number(m[1]), Number(m[2])]);
    if (pairs.length !== counts.length) {
      problems.push(`the headline states ${pairs.length} result(s) and the counts table has ${counts.length} arm(s)`);
    } else {
      for (let i = 0; i < pairs.length; i += 1) {
        const [ready, runs] = pairs[i];
        if (ready !== counts[i].ready || runs !== counts[i].runs) {
          problems.push(
            `the headline says ${ready} of ${runs} for ${counts[i].arm} and the counts table says `
            + `${counts[i].ready} of ${counts[i].runs}`,
          );
        }
      }
    }
  }

  return row(
    'IMP',
    label,
    problems.length === 0 ? PASS : FAIL,
    problems.length === 0
      ? `${onDisk} run file(s) on disk, counts table totals ${tableTotal}, headline reads `
        + `${counts.map((c) => `${c.ready} of ${c.runs} ${c.arm}`).join(' and ')}`
      : problems.join(' | '),
    ENGINEERING,
  );
}

/**
 * Every command the README quickstart prints resolves to something that is actually here.
 *
 * WHAT THIS ROW DOES NOT DO IS IN ITS OWN NAME. It does not execute the block, and two of the
 * commands are why. `python -m http.server` never exits, and `node scripts/readiness.mjs` is this
 * file, so running the block would hang and then recurse. The row resolves rather than runs, and
 * it is named for resolving. A row called "the quickstart works" that only opened a directory
 * would be the same overstatement the rest of this audit is about.
 *
 * What it catches is the thing that actually goes wrong in a repository that is still moving: a
 * script is renamed or a flag stops being read, and the first instruction a judge copies out of
 * the README dies on a path that is no longer there. Both halves are checked, the file and the
 * flag, because a flag that quietly stopped being read is the harder of the two to notice.
 *
 * THE LIMIT OF THE FLAG HALF, NAMED HERE RATHER THAN LEFT TO BE DISCOVERED. It is a substring
 * search over the whole script, comments included. A flag still documented in a docblock and no
 * longer read by the code would pass this row. Catching that needs each script's own argument
 * parser, and the row is named for what it does rather than for what would be nice to have.
 *
 * WHY IT NOW READS EVERY SHELL BLOCK AND NOT ONLY THE ONE UNDER THE QUICKSTART HEADING. The
 * Quickstart is not the only place this README tells a judge to run something, and it is not even
 * the first. On 2026-09-01 the block under "Open it yourself", the command a judge meets earliest
 * in the file, carried a literal backslash n where a line continuation was meant. Pasted into a
 * shell it printed `unrecognized arguments: n` and exited 2. This row stayed green through all of
 * it for one reason: it selected the text it covered by searching for a heading, so everything
 * outside that heading was invisible to it and it never said so. The selection is now every
 * fenced sh block in the file, and the number of blocks scanned is printed so a reader can see
 * the coverage rather than assume it.
 *
 * IT RESOLVES PYTHON SCRIPTS NOW TOO. The old code treated any command starting with `python` as
 * the local server and checked nothing about it, which is the other half of why that broken
 * command survived a green row. Only `python -m` is a server here. A python script named by path
 * resolves the same way a node one does.
 *
 * AND IT REFUSES A BACKSLASH THAT IS NOT A CONTINUATION. Real continuations are joined first, so
 * a command wrapped over two lines is read as the one command it is. A backslash still standing
 * after that join is an argument the shell would hand to the program, which is exactly what went
 * wrong, so it is a refusal with the offending line quoted.
 */
function checkQuickstart(root) {
  const label = 'every command in every README shell block resolves to a file and a flag that exist';
  const text = read(join(root, 'README.md'));
  if (!text) return row('QCK', label, FAIL, 'no README.md', ENGINEERING);

  // The Quickstart heading is still required. A README that stops telling a judge what to run has
  // not got better by having fewer commands left to check.
  if (text.indexOf('## Quickstart') === -1) {
    return row('QCK', label, FAIL, 'README.md has no Quickstart heading, so a judge is told nothing to run', ENGINEERING);
  }

  const blocks = [...text.matchAll(/```sh\r?\n([\s\S]*?)```/g)].map((match) => match[1]);
  if (blocks.length === 0) {
    return row('QCK', label, FAIL, 'the README carries no shell block at all', ENGINEERING);
  }

  const commands = [];
  const danglingBackslash = [];
  for (const block of blocks) {
    const joined = block.replace(/\\\r?\n\s*/g, ' ');
    for (const raw of joined.split(/\r?\n/)) {
      const line = raw.trim();
      if (line.length === 0 || line.startsWith('#')) continue;
      if (line.includes('\\')) danglingBackslash.push(line);
      commands.push(line);
    }
  }

  // A block that emptied out would otherwise report PASS by looking at nothing, which is the
  // failure this gate exists to refuse.
  if (commands.length === 0) {
    return row('QCK', label, FAIL, 'the README shell blocks carry no commands at all', ENGINEERING);
  }

  const problems = [];
  let resolved = 0;
  let servers = 0;

  for (const line of danglingBackslash) {
    problems.push(
      `${line}: this carries a backslash that is not a line continuation, so a shell passes it to `
      + 'the command as an argument',
    );
  }

  for (const command of commands) {
    const parts = command.split(/\s+/);
    let script = null;
    let flags = [];

    if (parts[0] === 'python' && parts[1] === '-m') {
      // The local server. There is nothing to resolve about it beyond the page it would serve.
      if (!existsSync(join(root, 'index.html'))) problems.push(`${command}: there is no index.html for it to serve`);
      servers += 1;
      continue;
    }

    if (parts[0] === 'node' && parts[1] === '--test') {
      const target = parts[2];
      if (!target || !existsSync(join(root, target))) {
        problems.push(`${command}: the test target ${target || '(none named)'} does not exist`);
      } else {
        resolved += 1;
      }
      continue;
    }

    if (parts[0] === 'node' || parts[0] === 'python') {
      script = parts[1];
      flags = parts.slice(2);
    } else {
      problems.push(`${command}: this row cannot resolve a command that does not start with node or python`);
      continue;
    }

    if (!script || !existsSync(join(root, script))) {
      problems.push(`${command}: ${script || '(no script named)'} does not exist`);
      continue;
    }

    const source = read(join(root, script)) || '';
    for (const token of flags) {
      // Both halves of a flag are checked. A flag the script no longer reads, and a value the
      // script no longer knows, each fail here for their own reason rather than at a judge's shell.
      if (token.startsWith('--')) {
        if (!source.includes(token)) problems.push(`${command}: ${script} never reads ${token}`);
        continue;
      }
      // A commit name is a fact about this repository's history, not a string any script holds, so
      // the rule below does not apply to it. Whether it is the RIGHT commit is not a question a
      // file check can answer, and nothing here pretends it can: the command itself fetches the
      // host and refuses when the bytes differ.
      if (/^[0-9a-f]{7,40}$/.test(token)) continue;
      if (/^[a-z0-9-]+$/.test(token) && !source.includes(token)) {
        problems.push(`${command}: ${script} never mentions the value ${token}`);
      }
    }
    resolved += 1;
  }

  return row(
    'QCK',
    label,
    problems.length === 0 ? PASS : FAIL,
    problems.length === 0
      ? `${blocks.length} shell block(s), ${commands.length} command(s), ${resolved} resolved against the tree, `
        + `${servers} local server(s) named and not executed`
      : problems.join(' | '),
    ENGINEERING,
  );
}

/**
 * The commit the video is recorded against is NAMED before the takes are shot.
 *
 * The reason is the one that has cost most elsewhere: waiting for a final product is why a video
 * never gets made, because there is always one more pull request. Naming the commit ends that
 * argument. It also makes a re-record attributable, because the report can say which commit the
 * old cut showed and which the new one does.
 *
 * WHAT IT CHECKS IS THAT A DECLARATION EXISTS, NOT THAT THE COMMIT RESOLVES. The self test copies
 * this repository without `.git`, so a `git cat-file` here would fail on a healthy tree and the
 * self test would go red for the wrong reason. Declaration is the bar anyway: the point is that a
 * person wrote a SHA down before recording. Nothing here invents one.
 *
 * IT IS A DELIVERABLE ROW, NOT AN ENGINEERING ONE, on the axis this file already uses for the live
 * URL. It prints FAIL, it is counted red in both tallies, and it is listed under deliverable rows
 * outstanding. What it does not do is turn a CI run red for a fact that only a person with a screen
 * recorder can settle. Nothing is hidden and no threshold moved: the row simply blocks the same
 * way the other things a person still owes block.
 */
const FREEZE_DECLARATION_PATH = ['docs', 'submission', 'video.md'];

function checkFreezeCommit(root) {
  const label = 'a freeze commit is declared for the recording, before the takes are shot';
  const rel = FREEZE_DECLARATION_PATH.join('/');
  const text = read(join(root, ...FREEZE_DECLARATION_PATH));
  if (!text) {
    return row('FRZ', label, FAIL, `${rel} does not exist, so nothing declares a commit to record against`, DELIVERABLE);
  }

  const lines = text.split(/\r?\n/).filter((line) => /freeze commit/i.test(line));
  if (lines.length === 0) {
    return row(
      'FRZ',
      label,
      FAIL,
      `${rel} declares no freeze commit. Add a line naming it, for example a deliverable record row `
      + 'reading Freeze commit with the SHA in backticks. No SHA is invented here.',
      DELIVERABLE,
    );
  }

  const withSha = lines.map((line) => line.match(/`([0-9a-f]{7,40})`/)).find(Boolean);
  if (!withSha) {
    return row(
      'FRZ',
      label,
      FAIL,
      `${rel} names a freeze commit and declares no SHA for it: ${lines[0].trim().slice(0, 90)}`,
      DELIVERABLE,
    );
  }

  return row('FRZ', label, PASS, `${rel} declares the recording frozen at ${withSha[1]}`, DELIVERABLE);
}

/**
 * A persona or judge review has been run, and the record says which commit it read.
 *
 * A review of a build that has since moved is a review of something else. That is why the commit
 * is the part this row insists on rather than the findings: findings with no commit beside them
 * cannot be told apart from findings that were fixed a week ago, or findings against a page that
 * no longer exists.
 *
 * IT READS ONLY THIS REPOSITORY. A review recorded in a working note outside the checkout is
 * invisible to a judge and invisible to CI, which sees the repository alone. A row that reached
 * outside would pass on one machine and mean nothing anywhere else.
 */
const REVIEW_DIR_PARTS = ['docs', 'review'];

function checkPersonaReview(root) {
  // THE LABEL SAYS WHAT THE CHECK LOOKS AT, WHICH IS ONE DIRECTORY. It used to say "in the repo",
  // and the check reads docs/review and nothing else. An adversarial reviewer caught it while the
  // repository held a review at docs/submission/judge-review.md naming its commit: the row printed
  // FAIL and told the reader the review was kept outside the repository, which was false and which
  // nothing in the row had tested. A row is allowed to be narrow. It is not allowed to describe
  // itself as wider than it is, or to diagnose a cause it never looked for.
  const label = 'a persona or judge review is recorded in docs/review, against a named commit';
  const rel = REVIEW_DIR_PARTS.join('/');
  const dir = join(root, ...REVIEW_DIR_PARTS);
  const files = listFiles(dir, '.md');

  if (files.length === 0) {
    return row(
      'PER',
      label,
      FAIL,
      `no review is recorded in ${rel}, which is the one directory this row reads. It does not look `
      + 'anywhere else, so it is not saying a review does not exist. Record it there, as a file '
      + 'naming the commit it was run against.',
      DELIVERABLE,
    );
  }

  const withCommit = [];
  const without = [];
  for (const file of files) {
    const text = read(join(dir, file)) || '';
    if (/`[0-9a-f]{7,40}`/.test(text)) withCommit.push(file);
    else without.push(file);
  }

  if (withCommit.length === 0) {
    return row(
      'PER',
      label,
      FAIL,
      `${rel} holds ${files.length} review file(s) and none names the commit it was run against: ${without.join(', ')}`,
      DELIVERABLE,
    );
  }

  return row(
    'PER',
    label,
    PASS,
    `${rel}: ${withCommit.length} review(s) naming a commit (${withCommit.join(', ')})`
    + (without.length > 0 ? `. Naming no commit: ${without.join(', ')}` : ''),
    DELIVERABLE,
  );
}

/* ------------------------------------------------------------ owner gated */

/**
 * The rows a person still owes, PRINTED IN THE ORDER A PERSON DOES THEM.
 *
 * They used to print O1, O2, O3, O5, which is the order the identifiers were minted in, and it put
 * "the form reads Submitted" third of four. Submitting is the last thing that happens. A checklist
 * that prints the last step in the middle is one a reader has to reorder in their head before they
 * can use it, and the step most likely to be skipped is the one that is out of place.
 *
 * So the print order is the performance order: prove the tools answer, record and publish the
 * video, fill the form, press Submit. THE IDENTIFIERS DO NOT MOVE. O4 is already taken by the
 * optional Chrome origin trial row below, and renumbering these to close the gap would silently
 * rename every row a previous report referred to.
 *
 * Each row prints what closes it, prefixed "to close:", because the manual step is the only part of
 * an owner gated row that a reader can act on.
 */
function ownerGatedRows() {
  return [
    {
      id: 'O5',
      // WHAT THIS ROW IS GATED ON, SAID PLAINLY. It used to read "tools proven callable in a real
      // judge path", and neither strong word in that sentence survives reading the code: there is
      // no check here at all, this is a static list, and what closes it is one person opening one
      // client once and watching. Nothing is recorded, no artifact is left, and no second person
      // can confirm it. "Proven" claimed a standard of evidence the row cannot reach, and "a real
      // judge path" claimed generality that one browser on one machine does not have. The
      // preflight in docs/submission/video.md describes that walk being made on 2026-08-31, which
      // is where the step text below comes from. That dated line is also why the label does not
      // say nothing records it: something does, it is a note in a runbook, and it is about a
      // build this tree has since moved past. Hence 'at the commit now live'. An attestation in a
      // runbook, against an earlier commit, is not a pass.
      label: 'owner has watched the tools answer by hand, in one WebMCP client, at the commit now live',
      backs: 'the mandatory live URL row LIVE, which proves the page is served and proves nothing about whether a tool answers',
      step: 'owner opens the live URL in the ChatGPT in-app browser, or Chrome with chrome://flags/#enable-webmcp-testing, and runs the three example prompts from the README',
    },
    {
      id: 'O1',
      label: 'video uploaded to YouTube as public, not unlisted',
      backs: 'the mandatory video row D4',
      step: 'owner uploads the rendered cut, sets visibility to Public, pastes the link into docs/submission/video.md',
    },
    {
      id: 'O2',
      label: 'Devpost project created with every field filled',
      backs: 'every mandatory row, because the form is where a judge sees them',
      step: 'owner opens the hackathon submission form and pastes the repo URL, the live URL, the description and the video',
    },
    {
      id: 'O3',
      label: 'the form reads Submitted. This is the last thing that happens',
      backs: 'the entry existing at all',
      step: 'owner presses Submit. A draft scores zero. Submit early, then edit in place',
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
const SANDBOX_SKIP = new Set(['.git', 'node_modules', '.vercel', 'tmp']);

/**
 * WHY `video` LEFT THAT LIST.
 *
 * It was skipped whole, and then a test started reading `video/beats/*&#47;beat.json`: the beat files
 * are the copy `--check-takes` prints to an owner, and tests/unit/beat_metadata.test.js holds them
 * to the runbook. In a sandbox with no video tree that test failed on the INTACT copy, so the TST
 * row reported `intact FAIL broken FAIL` and the self test went red. A gate that cannot pass on a
 * healthy tree tells you nothing about a broken one.
 *
 * What the sandbox does not need is the heavy generated media, which is what the skip was for. So
 * the filter is by extension now: the metadata a test reads is copied, and a take, a beat render, a
 * narration audio file or a finished cut is not.
 */
const SANDBOX_SKIP_EXTENSIONS = new Set([
  '.mp4', '.webm', '.mov', '.mkv', '.m4a', '.mp3', '.wav', '.vtt', '.png', '.jpg', '.jpeg',
]);

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
      if (SANDBOX_SKIP.has(rel.split('/')[0])) return false;
      const dot = rel.lastIndexOf('.');
      const extension = dot === -1 ? '' : rel.slice(dot).toLowerCase();
      return !SANDBOX_SKIP_EXTENSIONS.has(extension);
    },
  });
  // The beat metadata a test reads has to have survived the filter, or the TST row fails on a
  // healthy tree and the whole self test says nothing. Asserted rather than assumed, for the same
  // reason the skip below is asserted: a silent filter is how the last defect here got in.
  const beatMetadata = join(dest, 'video', 'beats', '03-agent-fills', 'beat.json');
  if (!existsSync(beatMetadata)) {
    throw new Error(
      `selftest sandbox ${dest} has no ${relative(dest, beatMetadata)}, so the tests that read the `
      + 'beat metadata cannot pass in it and the TST row would fail on an intact copy.',
    );
  }

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
    // The second half of the same row, broken on its own. Breaking only the README would leave
    // the description half untested, and an untested half is the half that drifts. The break
    // rewrites the opening paragraph and leaves the rest of the file, so what fails here is the
    // drift and not a missing file.
    id: 'RDM',
    name: 'the description stops opening with the flagship sentence, while the README still does',
    break: (s) => editFile(
      s,
      join('docs', 'submission', 'description.md'),
      (t) => t.replace(
        /The insurer's page hands your own agent[\s\S]*?describing the crash\./,
        'A page for motor claims that publishes tools.',
      ),
    ),
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
  {
    id: 'IMP',
    name: 'the analyzer refuses its own headline and results.md says AWAITING_RUNS',
    break: (s) => editFile(s, join('evidence', 'impact', 'results.md'), (t) => t.replace(
      '## Counts',
      '## AWAITING_RUNS\n\nNo headline is written from a partial set.\n\n## Counts',
    )),
    run: (s) => checkImpactStudy(s),
  },
  {
    id: 'IMP',
    name: 'the headline states a number the counts table underneath it does not',
    break: (s) => editFile(s, join('evidence', 'impact', 'results.md'), (t) => t.replace('in 5 of 18 runs', 'in 9 of 18 runs')),
    run: (s) => checkImpactStudy(s),
  },
  {
    id: 'IMP',
    // The half that would otherwise never be watched. A results file is a snapshot, and a run
    // disappearing from the folder afterwards leaves a headline that no longer counts anything.
    // Only the sandbox copy is touched here. The recorded runs are frozen evidence.
    name: 'a recorded run leaves the folder and the headline goes on quoting it',
    break: (s) => rmSync(join(s, 'evidence', 'impact', 'runs', 'S1-carpark-dent__published-rules__1.json')),
    run: (s) => checkImpactStudy(s),
  },
  {
    id: 'QCK',
    name: 'the quickstart tells a judge to run a script that has been renamed',
    break: (s) => editFile(s, 'README.md', (t) => t.replace(
      /(# count the intake[^\n]*\r?\n)node scripts\/measure_intake\.mjs/,
      '$1node scripts/measure_intake_renamed.mjs',
    )),
    run: (s) => checkQuickstart(s),
  },
  {
    id: 'QCK',
    // The quieter of the two failures. The file is still there, so a check that stopped at
    // existence would report PASS while the copied command died on an argument nothing reads.
    name: 'the quickstart passes a flag the script it names never reads',
    break: (s) => editFile(s, 'README.md', (t) => t.replace(
      /(# the style gate[^\n]*\r?\n)node scripts\/check_style\.mjs/,
      '$1node scripts/check_style.mjs --not-a-real-flag',
    )),
    run: (s) => checkQuickstart(s),
  },
  {
    id: 'QCK',
    // THE ONE THAT WAS ACTUALLY SHIPPED, on 2026-09-01, and survived because this row only read
    // the block under the Quickstart heading. The command lives under "Open it yourself", which
    // is earlier in the file, so the old selection could not see it at all. The break puts the
    // literal backslash n back exactly as it was written.
    name: 'a command outside the quickstart block breaks its line continuation',
    break: (s) => editFile(s, 'README.md', (t) => t.replace(
      /--verify-deployed \\\r?\n\s*--url/,
      '--verify-deployed \\n  --url',
    )),
    run: (s) => checkQuickstart(s),
  },
  {
    id: 'QCK',
    // The selection itself, tested rather than trusted. If this row ever goes back to reading one
    // block, this case is the one that turns red, because the script it renames is named nowhere
    // near the Quickstart heading.
    name: 'a script named in a block outside the quickstart is renamed away',
    break: (s) => editFile(s, 'README.md', (t) => t.replace(
      'python video/build_video.py --verify-deployed',
      'python video/build_video_renamed.py --verify-deployed',
    )),
    run: (s) => checkQuickstart(s),
  },
  {
    id: 'FRZ',
    // FRZ is red in the real repository today, because nothing declares a freeze commit, so the
    // intact half is written here rather than copied. That is stated rather than hidden by
    // skipping the case. The break leaves the field NAMED and takes the SHA away, which is the
    // shape a half filled template arrives in and the one a reader is most likely to skim past.
    name: 'the freeze commit is named as a field and no SHA is declared for it',
    // THE PREPARE STEP CLEARS BEFORE IT WRITES, and that is not tidiness. An APPENDING prepare
    // would stop being a gate on the day the owner declares a real freeze commit. There would
    // then be two freeze commit lines, checkFreezeCommit takes the first one carrying a SHA, and
    // a break that only blanks the placeholder would leave the real declaration standing. The
    // broken half would report PASS and this case would turn from a gate into a green light,
    // exactly when reality improved. So every earlier declaration is stripped and one known line
    // is written in its place.
    prepare: (s) => editFile(
      s,
      join('docs', 'submission', 'video.md'),
      (t) => `${t.split(/\r?\n/).filter((line) => !/freeze commit/i.test(line)).join('\n')}\n`
        + '| Freeze commit | \`0123456789abcdef0123456789abcdef01234567\` |\n',
    ),
    break: (s) => editFile(
      s,
      join('docs', 'submission', 'video.md'),
      (t) => t.replace('`0123456789abcdef0123456789abcdef01234567`', 'not declared yet'),
    ),
    run: (s) => checkFreezeCommit(s),
  },
  {
    id: 'PER',
    // PER is red in the real repository today for the same reason, so its intact half is written
    // here too. The break keeps the review and removes the commit, because a review with no commit
    // beside it is the state this row exists to refuse: it reads as evidence and proves nothing
    // about the build a judge will open.
    name: 'a review is recorded and does not say which commit it read',
    prepare: (s) => {
      // Cleared first, for the reason written above the FRZ case. A real review landing in
      // docs/review would otherwise satisfy this row on its own, and the break below would have
      // nothing left to prove.
      rmSync(join(s, 'docs', 'review'), { recursive: true, force: true });
      mkdirSync(join(s, 'docs', 'review'), { recursive: true });
      writeFileSync(
        join(s, 'docs', 'review', 'zz-selftest-review.md'),
        '# Review written by the readiness selftest\n\nRun against `0123456789abcdef0123456789abcdef01234567`.\n',
        'utf8',
      );
    },
    break: (s) => writeFileSync(
      join(s, 'docs', 'review', 'zz-selftest-review.md'),
      '# Review written by the readiness selftest\n\nRun against the build.\n',
      'utf8',
    ),
    run: (s) => checkPersonaReview(s),
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
    // Four facts an external audit said were unproven. Each one reads a real artifact, and two of
    // them are red today because the artifact is not there. That is the point of adding them.
    checkImpactStudy(ROOT),
    checkQuickstart(ROOT),
    checkFreezeCommit(ROOT),
    checkPersonaReview(ROOT),
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
    console.log(`${' '.repeat(47)}to close: ${o.step}`);
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
  // what a script proved. The second adds the owner gated rows, one of which is whether the form
  // reads Submitted, so it is the one that answers "is this ready to submit". The number of those
  // rows is not spelled out in this comment any more: it said five while `owner.length` was four,
  // and a stale count in a comment about honest counting is the defect it warns about. Printing
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
