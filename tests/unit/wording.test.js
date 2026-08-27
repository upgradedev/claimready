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
  const files = ['index.html', 'src/ui/app.js', 'src/ui/render.js', 'src/webmcp/register.js'];
  for (const name of readdirSync(new URL('src/core/', ROOT))) {
    if (name.endsWith('.js')) files.push(`src/core/${name}`);
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
