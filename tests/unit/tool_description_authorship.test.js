import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';

/**
 * No tool description this page publishes may claim it knows who set a value.
 *
 * WHY THIS EXISTS. src/webmcp/tools/read_claim_state.js corrected its own body and left its
 * published description saying the opposite. The provenance strings at its lines 41 to 56 were
 * rewritten to name the surface a value arrived through, because the page cannot know who was at
 * the keyboard, and src/ui/render.js badges the same two values the same way. The description an
 * agent reads off the live surface still said "every field with the value and who set it last".
 * So the tool told an agent one thing and the values meant another, on the judged surface, and
 * nothing in this repository could see it: no test pinned that description at all.
 *
 * IT READS THE DESCRIPTOR OBJECTS, NOT THE FILE TEXT, and that is deliberate. The comment at
 * src/webmcp/tools/read_claim_state.js:46 quotes the two phrases that were removed, in order to
 * record what was wrong with them. A scan over the source text would fire on the very comment
 * that documents the fix, and the next person would carve that file out. A carve-out is worth
 * nothing, so this builds every tool the way the host does and reads the string the host is
 * handed.
 *
 * The directory is walked rather than listed, for the reason tests/unit/wording.test.js gives one
 * layer up: coverage chosen by naming files stops covering the file somebody adds next.
 */

const TOOLS = new URL('../../src/webmcp/tools/', import.meta.url);

/**
 * The phrases this repository has already ruled out, and only those.
 *
 * Narrow on purpose. index.html:356 says a bare hash "does not show which page made the packet,
 * who wrote it", which is an honest negative statement, and a guard that fires on honest prose is
 * a guard that gets widened.
 */
const AUTHORSHIP_CLAIMS = [
  { pattern: /who set/i, why: 'says the page knows who set a value, and it knows only the surface' },
  { pattern: /set by you/i, why: 'attributes a value to the caller, which nothing here authenticates' },
  { pattern: /set by the person/i, why: 'attributes a value to a human, and a driven control records as human too' },
];

async function publishedTools() {
  const found = [];
  for (const file of readdirSync(TOOLS).sort()) {
    if (!file.endsWith('.js')) continue;
    // No skip and no catch. A module in this directory that cannot be built is a red gate, not a
    // quietly unscanned file.
    const module = await import(new URL(file, TOOLS).href);
    const descriptor = module.default({});
    found.push({ file, tool: descriptor.name, says: descriptor.description });
  }
  return found;
}

test('every tool module in the directory is built and its published string is read', async () => {
  const tools = await publishedTools();

  assert.ok(tools.length >= 9, `only ${tools.length} tool modules were scanned`);
  const names = tools.map((entry) => entry.tool);
  assert.ok(names.includes('read_claim_state'), 'the tool this guard was written for is out of scope');
  assert.ok(names.includes('apply_claim_patch'), 'the writing tool is out of scope');
  for (const entry of tools) {
    assert.equal(typeof entry.says, 'string', `${entry.file} publishes no string to check`);
    assert.ok(entry.says.length > 0, `${entry.file} publishes an empty string`);
  }
});

test('no tool description on this page claims to know who set a value', async () => {
  const findings = [];
  for (const entry of await publishedTools()) {
    for (const rule of AUTHORSHIP_CLAIMS) {
      if (rule.pattern.test(entry.says)) {
        findings.push(`${entry.file} (${entry.tool}) ${rule.why}: ${entry.says.slice(0, 140)}`);
      }
    }
  }
  assert.deepEqual(findings, [], `an authorship claim reached a published tool description:\n${findings.join('\n')}`);
});

/**
 * A guard nobody has seen fail proves nothing, so it is broken on purpose here.
 *
 * These strings are typed out rather than read from any module, so this test cannot pass because
 * the shipped text happens to agree with itself. The first is the sentence that actually shipped.
 */
test('the guard fails on the wording that shipped, and on the two phrases before it', () => {
  const planted = [
    'Read the claim draft on this page: its revision, every field with the value and who set it '
      + 'last, any field the person pinned, what is still missing.',
    'Each value carries a note saying set by you or set by the agent.',
    'Each value carries a note saying set by the person on the page.',
  ];
  for (const sentence of planted) {
    const caught = AUTHORSHIP_CLAIMS.filter((rule) => rule.pattern.test(sentence));
    assert.ok(caught.length > 0, `the guard let this through: ${sentence}`);
  }
});

/**
 * And it has to leave the true wording alone, or the next person widens it.
 *
 * The first entry is the sentence read_claim_state ships today, typed out by hand. The rest are
 * the provenance sentences beside it and the words src/ui/render.js badges the same values with,
 * so the page, the badges and the tool are checked to be sayable under one rule.
 */
test('the guard leaves the surface wording the page, the badges and the tool all use alone', () => {
  const honest = [
    'Read the claim draft on this page: its revision, every field with the value and the surface '
      + 'each value arrived through last, any field the person pinned.',
    'arrived through a control on this page',
    'arrived through a WebMCP tool call',
    'already on file when the page opened',
    'worked out by the page',
    'via page',
    'via tool',
    'This answer arrived through a control on this page. That is the surface it came in on, not '
      + 'who was at the keyboard.',
  ];
  for (const sentence of honest) {
    const caught = AUTHORSHIP_CLAIMS.filter((rule) => rule.pattern.test(sentence));
    assert.deepEqual(caught.map((rule) => rule.why), [], `the guard fired on: ${sentence}`);
  }
});
