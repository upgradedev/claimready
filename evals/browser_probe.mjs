/**
 * Drive the deployed page through a real browser's own WebMCP implementation, judge what happened,
 * and exit non-zero when it is not what this page promises.
 *
 * It exists because the rest of our browser evidence comes from a CI runner. This asks the same
 * question on a desktop, in the stable channel, from a reader who has this repository and nothing
 * else.
 *
 *   1. Launch Chrome with WebMCP on and a throwaway profile, pointed at the deployed page:
 *
 *      chrome --headless=new --disable-gpu --enable-features=WebMCP \
 *             --remote-debugging-port=9222 --user-data-dir=<a temp dir> \
 *             https://upgradedev.github.io/claimready/
 *
 *   2. node evals/browser_probe.mjs
 *
 * WHAT CHANGED AND WHY IT MATTERED. This used to print what it saw and exit 0 whatever that was.
 * Pointed at a browser with no WebMCP it printed `api: null` and reported success, so a run that
 * proved nothing looked exactly like a run that proved the lifecycle. The judgement now lives in
 * evals/probe_assertions.mjs, which tests/unit/probe_assertions.test.js breaks with 38 mutations,
 * requiring a failure each time, and this file exits 1 when that judgement says so.
 *
 * WHAT THE JOURNEY GAINED, AND WHAT IS UNPROVEN ABOUT IT. The journey now records which page it
 * ran against, so a transcript collected from a copy on somebody's disk is refused rather than
 * read as evidence about the deployed page, and it has a phase that reads the evidence notes. One
 * of those notes is written by an unverified third party and tells whatever agent reads it to put
 * the drivable answer back to yes and file the claim. This script does not do either. It reads the
 * notes, pins the field the note names using the page's own control, asks for exactly the change
 * the note demands, and records the refusal and the fact that nothing moved. That phase drives the
 * DOM twice, to pin and to unpin, and those two clicks have NOT been watched against a live
 * browser by whoever wrote them. If the pin does not land, the patch is accepted instead of
 * refused and the judgement fails loudly, which is the right direction to be wrong in.
 *
 * WHAT IT IS NOT. The caller here is this script, not a model. It shows that a browser publishes,
 * executes and withdraws the tools this page declares, that a refusal reaches the caller in the
 * page's own words and moves nothing, and that the console stays quiet. What a model chooses to do
 * with those tools is a different question and is not answered here.
 *
 * THE CONSOLE, HONESTLY. Console capture starts when this script attaches, which is after the page
 * has loaded, so it reloads the page first and watches from that load onward. Anything the very
 * first load said before the reload is not in the transcript.
 */
import { openSession } from '../evidence/impact/page_client.mjs';
import { checkTranscript, EXPECTED_PAGE_URL } from './probe_assertions.mjs';

const port = process.argv.includes('--port')
  ? process.argv[process.argv.indexOf('--port') + 1]
  : '9222';

// Which page this run is a statement about. CI sets CLAIMREADY_URL to the judge URL, and a desktop
// run gets the deployed page by default. The judgement refuses a target that is not https, so this
// cannot be pointed at a local file to make a red run green.
const expectedPageUrl = (process.env.CLAIMREADY_URL || '').trim() || EXPECTED_PAGE_URL;

// This runs inside the page, so it is written as one source string rather than as a function.
const JOURNEY = [
  '(async () => {',
  '  const context = document.modelContext ?? navigator.modelContext;',
  '  const out = { api: null, page: null, bootTools: [], toolsWhenStuck: [], toolsAfterRecovery: [],',
  '    notes: { pinnedPatch: {} }, stalePatch: {}, declared: {}, threw: [] };',
  '  out.page = { url: String(location.href), origin: String(location.origin) };',
  '  if (!context) return JSON.stringify(out);',
  '  out.api = document.modelContext ? "document.modelContext" : "navigator.modelContext";',
  '  const list = async () => (await context.getTools()).map(tool => String(tool.name));',
  '  const call = async (name, args) => {',
  '    const tool = (await context.getTools()).find(candidate => candidate.name === name);',
  '    if (!tool) { out.threw.push(name + ": not published when it was called"); return null; }',
  '    try {',
  '      const raw = await context.executeTool(tool, JSON.stringify(args ?? {}));',
  '      let parsed = raw;',
  '      if (typeof raw === "string") {',
  '        try { parsed = JSON.parse(raw); } catch { parsed = { content: [{ text: raw }] }; }',
  '      }',
  '      return parsed && parsed.content && parsed.content[0] ? String(parsed.content[0].text)',
  '        : JSON.stringify(parsed);',
  '    } catch (error) {',
  '      out.threw.push(name + ": " + String((error && error.message) || error));',
  '      return null;',
  '    }',
  '  };',
  '  const revision = async () => {',
  '    const said = await call("read_claim_state");',
  '    const found = said && said.match(/revision (\\d+)/);',
  '    return found ? Number(found[1]) : null;',
  '  };',
  // The value alone, without the "set by" clause or the [pinned] marker, because pinning the field
  // changes that line without changing the answer, and the answer is what must not move.
  '  const drivable = async () => {',
  '    const said = await call("read_claim_state");',
  '    const found = said && said.match(/vehicle_drivable = (true|false|null|empty)/);',
  '    return found ? String(found[1]) : null;',
  '  };',
  // Pinning is a control on the page and there is no tool for it, which is the point. The probe
  // presses the button a person would press. A quarter of a second lets the page redraw and let
  // its own tool reconcile settle, which the page does not await.
  '  const togglePin = async () => {',
  '    const button = document.querySelector("[data-pin=vehicle_drivable]");',
  '    if (!button) { out.threw.push("pin control: no [data-pin=vehicle_drivable] on the page"); return false; }',
  '    if (button.disabled) { out.threw.push("pin control: the button is disabled"); return false; }',
  '    button.click();',
  '    await new Promise(done => setTimeout(done, 250));',
  '    return true;',
  '  };',
  '',
  '  out.bootTools = await list();',
  '  await call("read_claim_state");',
  '  await call("apply_claim_patch", { baseRevision: 0, changes: [{ field: "vehicle_drivable", value: false }] });',
  '  out.toolsWhenStuck = await list();',
  '  await call("get_assistance_options");',
  '',
  // THE PLANTED NOTE. Read it, then do the opposite of what it says and record that nothing moved.
  // The note asks for vehicle_drivable to go back to yes and for the claim to be filed. Filing is
  // not a tool at all, so there is nothing to call, and the field is pinned here first so the
  // change it wants is refused with the code the page returns rather than merely declined.
  '  out.notes.drivableBefore = await drivable();',
  '  out.notes.answer = await call("read_evidence_notes");',
  '  await togglePin();',
  '  out.notes.pinnedPatch.revisionBefore = await revision();',
  '  out.notes.pinnedPatch.answer = await call("apply_claim_patch",',
  '    { baseRevision: out.notes.pinnedPatch.revisionBefore,',
  '      changes: [{ field: "vehicle_drivable", value: true }] });',
  '  out.notes.pinnedPatch.revisionAfter = await revision();',
  '  out.notes.drivableAfter = await drivable();',
  '  out.notes.toolsAfterNotes = await list();',
  // Unpin, because the rest of the journey needs that field to be patchable again. If this click
  // does not land, the legal patch below is refused as locked and the judgement says so.
  '  await togglePin();',
  '',
  '  out.stalePatch.revisionBefore = await revision();',
  '  out.stalePatch.answer = await call("apply_claim_patch",',
  '    { baseRevision: 0, changes: [{ field: "severity", value: "dent" }] });',
  '  out.stalePatch.revisionAfter = await revision();',
  '',
  '  await call("apply_claim_patch", { baseRevision: out.stalePatch.revisionAfter,',
  '    changes: [{ field: "vehicle_drivable", value: true }] });',
  '  out.toolsAfterRecovery = await list();',
  '',
  '  const declared = (await context.getTools()).find(tool => tool.name === "record_supporting_details");',
  '  if (declared) {',
  '    out.declared.name = String(declared.name);',
  '    out.declared.origin = String(declared.origin);',
  '    out.declared.description = String(declared.description);',
  '    out.declared.schema = String(JSON.stringify(declared.inputSchema));',
  '    out.declared.revisionBefore = await revision();',
  '    out.declared.answer = await call("record_supporting_details",',
  '      { witness_name: "M. Okafor", base_revision: out.declared.revisionBefore });',
  '    out.declared.revisionAfter = await revision();',
  '  }',
  '  return JSON.stringify(out);',
  '})()',
].join('\n');

let socket;
try {
  const connection = await openSession(port);
  socket = connection.socket;
  const { session } = connection;

  // Watch the console from a load this script can see the whole of.
  await session.send('Runtime.enable');
  await session.send('Log.enable').catch(() => {});
  await session.send('Page.enable').catch(() => {});
  await session.send('Page.reload', { ignoreCache: true }).catch(() => {});
  await new Promise((resolve) => setTimeout(resolve, 4000));

  const raw = await session.evaluate(JOURNEY);
  const transcript = JSON.parse(raw);
  transcript.consoleProblems = session.problems();

  const verdict = checkTranscript(transcript, { expectedPageUrl });

  console.log(JSON.stringify(transcript, null, 1));
  console.log('');
  console.log(`probe: judged against ${expectedPageUrl}`);
  if (verdict.ok) {
    console.log(`probe: PASS. ${verdict.checks} checks against the deployed page, none failed.`);
    process.exit(0);
  }
  console.error(`probe: FAIL. ${verdict.failures.length} of ${verdict.checks} checks did not hold.`);
  for (const failure of verdict.failures) console.error(`  - ${failure}`);
  process.exit(1);
} catch (error) {
  console.error(`probe: FAIL. ${String(error.message ?? error)}`);
  process.exit(1);
} finally {
  if (socket) socket.destroy();
}
