import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

/**
 * The page states what the policy schedule says and what the intake therefore
 * requires. It never decides a claim.
 *
 * That is a promise made to a judge and to a claimant, so it is checked rather
 * than remembered. This guard reads the shipped text of every core module and
 * every fixture and fails on any sentence that announces an outcome.
 *
 * It is deliberately narrow. "A collision claim is covered under Own damage,
 * clause OD-4.1" is a statement about the schedule and stays legal. "Your claim
 * has been approved" is an outcome and does not.
 */

const ROOT = new URL('../../', import.meta.url);

/**
 * Every pattern names its subject. "the change was accepted" is about a patch
 * and is nobody's business here; "the claim was accepted" is an outcome. A guard
 * that fires on innocent prose gets widened by the next person who trips over
 * it, and a widened guard is worth nothing, so it is narrow from the start.
 */
const CLAIM_SUBJECT = '(claim|cover|coverage|payout|settlement|policy)';

const OUTCOME_PHRASES = [
  {
    pattern: new RegExp(`\\b(the |this |your |a )?${CLAIM_SUBJECT} (is|was|has been) (approved|accepted|granted|denied|settled|valid)\\b`, 'i'),
    why: 'announces an outcome on a claim',
  },
  {
    pattern: new RegExp(`\\b(approve|approves|approved|accept|accepts|accepted|deny|denies|denied|settle|settles|settled) (the|this|your|their) ${CLAIM_SUBJECT}\\b`, 'i'),
    why: 'decides a claim',
  },
  { pattern: /\bwe (will )?(pay|approve|accept|settle|reimburse)\b/i, why: 'promises a payment or a decision' },
  { pattern: /\bguaranteed (payout|payment|settlement|cover|coverage)\b/i, why: 'guarantees an outcome' },
  { pattern: /\bpayout of\b/i, why: 'states a payout figure' },
  { pattern: /\bfully compliant\b/i, why: 'claims compliance' },
];

function read(relative) {
  return readFileSync(new URL(relative, ROOT), 'utf8');
}

function shippedTextFiles() {
  const files = [];
  for (const name of readdirSync(new URL('src/core/', ROOT))) {
    if (name.endsWith('.js')) files.push(`src/core/${name}`);
  }
  for (const name of readdirSync(new URL('fixtures/', ROOT))) {
    if (name.endsWith('.json')) files.push(`fixtures/${name}`);
  }
  for (const name of readdirSync(new URL('fixtures/insurers/', ROOT))) {
    if (name.endsWith('.json')) files.push(`fixtures/insurers/${name}`);
  }
  files.push('docs/claim-intake.v1.json');
  return files;
}

test('the shipped text scanned by this guard is the text that actually ships', () => {
  const files = shippedTextFiles();
  assert.ok(files.includes('src/core/coverage.js'), 'the cover module has to be in scope');
  assert.ok(files.includes('src/core/estimate.js'), 'the repair band module has to be in scope');
  assert.ok(files.includes('src/core/claim.js'));
  assert.ok(files.includes('fixtures/insurers/northwind.json'));
  assert.ok(files.includes('fixtures/insurers/kestrel.json'));
  assert.ok(files.length >= 8, `only ${files.length} files were scanned`);
});

test('nothing the page can say announces a decision on a claim', () => {
  const findings = [];
  for (const file of shippedTextFiles()) {
    const source = read(file);
    source.split(/\r?\n/).forEach((line, index) => {
      for (const rule of OUTCOME_PHRASES) {
        if (rule.pattern.test(line)) {
          findings.push(`${file}:${index + 1} ${rule.why}: ${line.trim().slice(0, 100)}`);
        }
      }
    });
  }
  assert.deepEqual(findings, [], `outcome wording reached the shipped text:\n${findings.join('\n')}`);
});

// A guard nobody has seen fail proves nothing.
test('the wording guard fails on a sentence that does announce a decision', () => {
  const planted = [
    'Good news, your claim is approved and we will pay the full amount.',
    'The insurer accepted this claim on 20 August.',
    'A guaranteed payout of 1200 EUR follows.',
  ];
  for (const sentence of planted) {
    const caught = OUTCOME_PHRASES.filter((rule) => rule.pattern.test(sentence));
    assert.ok(caught.length > 0, `the guard let this through: ${sentence}`);
  }
});

// And a guard that fires on ordinary prose gets widened by the next person who
// trips over it, so the innocent sentences are pinned too.
test('the wording guard leaves ordinary prose about patches and pins alone', () => {
  const innocent = [
    'Pinning a field that is already pinned is allowed and changes nothing.',
    'The revision advances on every accepted change.',
    'A collision claim is covered under Own damage, clause OD-4.1.',
    'This section carries no excess, so there is nothing for you to pay towards it.',
    'The patch was accepted and the revision moved to 4.',
  ];
  for (const sentence of innocent) {
    const caught = OUTCOME_PHRASES.filter((rule) => rule.pattern.test(sentence));
    assert.deepEqual(caught.map((rule) => rule.why), [], `the guard fired on: ${sentence}`);
  }
});

// The repair band is triage, not a quote. The disclaimer is what keeps it that
// way, so it is pinned here rather than left to whoever edits the module next.
test('the repair band still ships with its disclaimer', () => {
  const source = read('src/core/estimate.js');
  assert.match(source, /not a quote and not a prediction/i);
  assert.match(source, /triage/i);
});

// ---------------------------------------------------------------------------
// The one false claim, and the guard that keeps it out
//
// The page used to say, in seven places, that filing and asking for a collection
// were things "only a person can press" and that "an agent could not have
// pressed this button". That is not true. A browser driving agent clicks an
// ordinary DOM button like anyone else, which is exactly what the W3C security
// considerations for this API and OpenAI's own WebMCP note both say out loud,
// and one of those sentences was printed by the very click a script had made.
//
// The true claim is better than the false one, and it is the unusual design
// decision this page is actually making: NO TOOL ON THIS PAGE REACHES THOSE
// ACTIONS. src/webmcp/tools/validate_claim.js says it in the voice to copy.
//
// A lesson written as prose does not stop its own repeat, so it is a check.
//
// SCOPE. This covers the files this change owns: the page, the view, the wiring,
// src/core and the tool modules. src/webmcp/register.js and two documents still
// carry the same class of sentence and are owned elsewhere in this change; they
// are named in the handover rather than quietly excused here, and their paths
// belong in this list the moment they are fixed.
// ---------------------------------------------------------------------------

const FALSE_ABSOLUTES = [
  { pattern: /only a person can press/i, why: 'a browser driving agent presses ordinary buttons' },
  { pattern: /an agent cannot\b/i, why: 'states a limit on the agent rather than on the tool surface' },
  { pattern: /no agent can (change|press|move)/i, why: 'states a limit on the agent rather than on the tool surface' },
  { pattern: /could not have pressed/i, why: 'printed by the click itself, and not true of a scripted one' },
  { pattern: /can file nothing/i, why: 'says the agent cannot file, rather than that no tool files' },
  { pattern: /you cannot press it/i, why: 'says the agent cannot press, rather than that no tool reaches it' },
  { pattern: /only (a|the) (person|human)(?! presses)[^.]{0,20}can (do|press|arrange)/i, why: 'the same absolute in another shape' },
  // The last member of the class, and the one that hid the longest. It lived in the flagship
  // sentence, which is the most quoted string in the project and is pinned by three readiness rows,
  // so it was in five files at once and not one rule in this repository could see it. It is the
  // shape to watch for: a false absolute is most durable when it is inside the sentence everybody
  // copies rather than in the prose nobody rereads.
  { pattern: /only you can file/i, why: 'a scripted click files it too, so this states a limit on the agent rather than on the tool surface' },
  { pattern: /only the person on the page can commit/i, why: 'the same absolute, in the module header a reviewer opens first' },
];

function guardedFiles() {
  // register.js was carved out of this list while another agent owned it, and the carve-out
  // outlived the reason: its header held two sentences of exactly the class this rule exists to
  // catch, in the module a reviewer opens first to see how registration works. It is guarded now.
  //
  // THE WEBMCP LAYER IS READ AS A DIRECTORY, NOT LISTED BY NAME, and that change has a reason.
  // register.js was the only file from that directory on this list, so a NEW module beside it
  // would have been outside every rule here without anything reporting it. That is the failure
  // this file already documents one directory over: coverage chosen by naming files stops covering
  // the file somebody adds next. Both directories under src are walked now, so a module cannot
  // join the page and miss the guard.
  const files = ['index.html', 'src/ui/app.js', 'src/ui/render.js'];
  for (const name of readdirSync(new URL('src/core/', ROOT))) {
    if (name.endsWith('.js')) files.push(`src/core/${name}`);
  }
  for (const name of readdirSync(new URL('src/webmcp/', ROOT))) {
    if (name.endsWith('.js')) files.push(`src/webmcp/${name}`);
  }
  for (const name of readdirSync(new URL('src/webmcp/tools/', ROOT))) {
    if (name.endsWith('.js')) files.push(`src/webmcp/tools/${name}`);
  }
  return files;
}

test('the guarded surface is the whole page, the wiring and every tool module', () => {
  const files = guardedFiles();
  assert.ok(files.includes('index.html'));
  assert.ok(files.includes('src/ui/render.js'), 'the view prints most of these sentences');
  assert.ok(files.includes('src/webmcp/tools/apply_claim_patch.js'));
  assert.ok(files.includes('src/webmcp/tools/validate_claim.js'));
  assert.ok(files.includes('src/webmcp/register.js'), 'the whole webmcp layer is walked, not listed');
  assert.ok(files.includes('src/webmcp/declarative_form.js'), 'a module added beside register.js is guarded too');
  assert.ok(files.length >= 13, `only ${files.length} files are guarded`);
});

test('nothing the page says claims an agent is unable to press a button', () => {
  const findings = [];
  for (const file of guardedFiles()) {
    read(file).split(/\r?\n/).forEach((line, index) => {
      for (const rule of FALSE_ABSOLUTES) {
        if (rule.pattern.test(line)) {
          findings.push(`${file}:${index + 1} ${rule.why}: ${line.trim().slice(0, 110)}`);
        }
      }
    });
  }
  assert.deepEqual(findings, [], `a false absolute reached the page:\n${findings.join('\n')}`);
});

// A guard nobody has seen fail proves nothing, so it is broken on purpose once.
test('the guard fails on each sentence the audit found', () => {
  const planted = [
    'They are buttons only a person can press.',
    'Not requested. A person on this page asks for it, an agent cannot.',
    'Filed by you at 10:02:11. An agent could not have pressed this button.',
    'so an agent can draft and check a claim and can file nothing.',
    'you can pin a row so no agent can change it',
    'Tell the person on the page that they can press File this claim. You cannot press it.',
  ];
  for (const sentence of planted) {
    const caught = FALSE_ABSOLUTES.filter((rule) => rule.pattern.test(sentence));
    assert.ok(caught.length > 0, `the guard let this through: ${sentence}`);
  }
});

// And it has to leave the true statement alone, or the next person widens it.
test('the guard leaves the true statement about the tool surface alone', () => {
  const honest = [
    'Arranging the collection itself is a button on the page that the person presses, and is deliberately not available as a tool.',
    'There is no tool for it, so an agent has to ask the claimant to do it.',
    'No tool on this page reaches this button.',
    'No tool this page publishes reaches any of them.',
    'you can pin a row so no patch can move it',
    'No agent detected in this browser, so nothing is driving the page but you.',
    'A collection is arranged by the person on the page pressing the button.',
  ];
  for (const sentence of honest) {
    const caught = FALSE_ABSOLUTES.filter((rule) => rule.pattern.test(sentence));
    assert.deepEqual(caught.map((rule) => rule.why), [], `the guard fired on: ${sentence}`);
  }
});

// ---------------------------------------------------------------------------
// The faint ink has to be readable, and a value is easy to nudge back
//
// --ink-faint carries real text in 18 places, the tool count that is this entry's
// whole argument among them, which `grep -c "color: var(--ink-faint)"
// assets/styles.css` counts, and at #7b8894 it failed WCAG AA against
// every ground the page ships: 3.63:1 on white and 3.13:1 on --line-soft, which
// is what .tag-idle and .badge-none sit on, against a 4.5:1 threshold. Nothing in
// the repository could have said so, because a colour is one token and a token is
// one line, so this reads the shipped stylesheet and does the arithmetic.
//
// The pairs are named rather than discovered. A scan that worked out which ground
// each rule sits on would need a cascade, and a wrong answer from one would be a
// gate that passes for the wrong reason.
// ---------------------------------------------------------------------------

const AA_NORMAL_TEXT = 4.5;

/**
 * The grounds --ink-faint text is drawn on, in each scheme.
 *
 * --flash was missing from this list and the omission shipped a real failure. It is a
 * transient highlight ground, which is exactly why it was overlooked, but faint text
 * lands on it in two places that are not transient at all:
 *
 *   1. index.html:31-34 nests .revision-note, which is --ink-faint at styles.css:200,
 *      inside .revision, and .revision.is-bumped paints --flash at styles.css:202. That
 *      pair occurs on EVERY accepted change, from the page or from an agent.
 *   2. .field-row.is-changed paints --flash at styles.css:599 while
 *      .field-row.is-missing .field-value is --ink-faint at styles.css:580. render.js
 *      toggles is-missing at 331 and adds is-changed at 966, so clearing a field puts
 *      both classes on one row.
 *
 * In the dark scheme that pair measured 4.12:1 against the 4.5 threshold, at the
 * --ink-faint of #8a9aa9 that cleared the other four grounds. Adding the ground here is
 * what forces the token to be fixed rather than the check to be narrowed, and the token
 * that moved was --ink-faint rather than --flash: --flash is a highlight fill, so its own
 * separation from --surface is the thing that makes it read as a highlight, and darkening
 * it to win a text ratio would have paid for AA with the cue the fill exists to give.
 */
const FAINT_ON = ['--surface', '--bg', '--surface-2', '--line-soft', '--flash'];

function relativeLuminance(hex) {
  const channels = [1, 3, 5]
    .map((at) => parseInt(hex.slice(at, at + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrastRatio(a, b) {
  const [lighter, darker] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * The tokens as the browser would resolve them, light scheme or dark.
 *
 * The light values are declared on `:root` and the dark ones inside the
 * prefers-color-scheme block, which is later in the file, so reading the file in
 * order and letting the last declaration win is the same answer the cascade gives.
 */
function tokens(scheme) {
  const css = read('assets/styles.css');
  const darkAt = css.indexOf('@media (prefers-color-scheme: dark)');
  assert.ok(darkAt > 0, 'the dark scheme block has been renamed or removed');
  const source = scheme === 'dark' ? css : css.slice(0, darkAt);

  const out = {};
  for (const [, name, value] of source.matchAll(/(--[a-z0-9-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) {
    out[name] = value.toLowerCase();
  }
  return out;
}

test('the token reader finds every colour the contrast check needs, in both schemes', () => {
  for (const scheme of ['light', 'dark']) {
    const found = tokens(scheme);
    for (const name of ['--ink-faint', '--ink-soft', '--ink', ...FAINT_ON]) {
      assert.match(found[name] || '', /^#[0-9a-f]{6}$/, `${name} was not read in the ${scheme} scheme`);
    }
  }
  assert.notEqual(tokens('light')['--ink-faint'], tokens('dark')['--ink-faint'], 'one scheme is not being read');
});

test('every colour the page draws faint text in clears WCAG AA on every ground it ships on', () => {
  const failures = [];
  for (const scheme of ['light', 'dark']) {
    const found = tokens(scheme);
    for (const ink of ['--ink', '--ink-soft', '--ink-faint']) {
      for (const ground of FAINT_ON) {
        const ratio = contrastRatio(found[ink], found[ground]);
        if (ratio < AA_NORMAL_TEXT) {
          failures.push(`${scheme}: ${ink} ${found[ink]} on ${ground} ${found[ground]} is ${ratio.toFixed(2)}:1`);
        }
      }
    }
  }
  assert.deepEqual(failures, [], `text below 4.5:1 ships on the page:\n${failures.join('\n')}`);
});

// A guard nobody has seen fail proves nothing, so it is broken on purpose once,
// with the value that actually shipped.
test('the contrast guard fails on the value the audit found', () => {
  const grounds = { '--surface': '#ffffff', '--bg': '#f4f6f8', '--surface-2': '#f8fafc', '--line-soft': '#eaeff3' };
  const caught = Object.entries(grounds)
    .map(([name, ground]) => [name, contrastRatio('#7b8894', ground)])
    .filter(([, ratio]) => ratio < AA_NORMAL_TEXT);
  assert.equal(caught.length, 4, 'the arithmetic no longer catches the value that shipped');
  assert.equal(contrastRatio('#7b8894', '#ffffff').toFixed(2), '3.63', 'the ratio itself has drifted');
});
