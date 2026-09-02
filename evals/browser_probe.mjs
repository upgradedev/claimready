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
 *   2. CLAIMREADY_DEPLOYED_SHA=<the commit the host is serving> node evals/browser_probe.mjs
 *
 *      The commit is not optional and the run fails without it. Check it rather than assuming it:
 *      python video/build_video.py --verify-deployed --url https://upgradedev.github.io/claimready/ \
 *             --deployed-sha $(git rev-parse HEAD)
 *      compares all 26 files the page loads against this checkout at that commit, and a working
 *      tree that is ahead of the host fails there instead of producing a transcript about bytes
 *      nobody serves.
 *
 * WHAT CHANGED AND WHY IT MATTERED. This used to print what it saw and exit 0 whatever that was.
 * Pointed at a browser with no WebMCP it printed `api: null` and reported success, so a run that
 * proved nothing looked exactly like a run that proved the lifecycle. The judgement now lives in
 * evals/probe_assertions.mjs, which tests/unit/probe_assertions.test.js breaks with 83 mutations,
 * requiring a failure each time, and this file exits 1 when that judgement says so.
 *
 * WHAT THE JOURNEY GAINED. It records which page it ran against and which commit that page was, so
 * a transcript collected from a copy on somebody's disk, or from a page the host replaced last
 * week, is refused rather than read as evidence about what a judge opens. It reads the evidence
 * notes: one of them is written by an unverified third party and tells whatever agent reads it to
 * put the drivable answer back to yes and file the claim. This script does not do either. It reads
 * the notes, pins the field the note names using the page's own control, asks for exactly the
 * change the note demands, and records the refusal and the fact that nothing moved. That phase
 * drives the DOM twice, to pin and to unpin, and both clicks have now been watched against a live
 * browser: run 33512549120 on a runner and a desktop Chrome 152 run, both on 2026-09-01. If the pin
 * does not land, the patch is accepted instead of refused and the judgement fails loudly, which is
 * the right direction to be wrong in.
 *
 * AND IT READS THE CLAIM BACK. Every refusal is bracketed by a full read_claim_state, and so is the
 * declared tool's accepted call, because a revision number that held still says nothing about what
 * a refused call wrote on its way out, and a revision number that moved says nothing about what was
 * actually stored. Those two readings are what the judgement compares.
 *
 * SO IS EVERY OTHER CALL IN THE JOURNEY, SINCE 2026-09-02. Three calls were bracketed by nothing:
 * the accepted patch that takes the car off the road, the read of the assistance options straight
 * after it, and the accepted patch that puts the car back on. Only the two REFUSED patches were
 * watched, which is the wrong way round: a refused call is the one that should write nothing, and
 * an accepted call is the one with a live path to the store. So a collateral write by any of the
 * three was recorded by nothing at all, and `probe: PASS` could not be read as "no tool wrote
 * anything it should not have". Each of the three now carries a whole reading either side of it.
 *
 * SO IS THE NOTE READ, SINCE 2026-09-02. The note phase used to hand over the one field the planted
 * note names and nothing else, so a page that answered the read and wrote some other field held that
 * one field still and was reported as proof. A whole reading is now taken either side of
 * read_evidence_notes, with the pin toggle outside that window because pinning changes the reading
 * for a good reason and a read changes it for no reason at all.
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

/**
 * WHICH COMMIT THE HOST WAS SERVING WHEN THIS RAN, AND WHY IT IS NOT OPTIONAL.
 *
 * A transcript with no commit on it is a statement about "the page, some time". The tools it
 * describes may have been replaced an hour later and the transcript still reads green, which is
 * exactly the stale evidence this repository keeps catching itself producing. So the run has to be
 * told which commit it is about, the judgement refuses a transcript that cannot name one, and the
 * workflow only sets this after `video/build_video.py --verify-deployed` has compared all 26 files
 * the page loads against that commit. The value is therefore downstream of a measurement rather
 * than a flag this script sets about itself.
 *
 * On a desktop, pass it: CLAIMREADY_DEPLOYED_SHA=$(git rev-parse HEAD) node evals/browser_probe.mjs
 * after checking the host really serves that commit.
 */
const deployedSha = (process.env.CLAIMREADY_DEPLOYED_SHA || '').trim();

// This runs inside the page, so it is written as one source string rather than as a function.
const JOURNEY = [
  '(async () => {',
  '  const context = document.modelContext ?? navigator.modelContext;',
  '  const out = { api: null, page: null, bootTools: [], toolsWhenStuck: [], toolsAfterRecovery: [],',
  '    notes: { pinnedPatch: {} }, bootPatch: {}, assistance: {}, recoveryPatch: {},',
  '    stalePatch: {}, declared: {}, threw: [] };',
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
  // THE WHOLE DRAFT AS THE PAGE SAYS IT, IN ONE READ, AND EVERY NUMBER BELOW COMES OUT OF THAT ONE
  // READ. This used to be three helpers that each called read_claim_state again, so a revision
  // came from one read and the drivable answer from another, and nothing compared the rest of the
  // draft at all. A refusal could therefore leave the revision alone, quietly write some other
  // field, and be recorded as a refusal that changed nothing. read_claim_state prints the revision,
  // every field with its value and provenance, the pin list and what is still missing, so the text
  // it returns is the state, and comparing that text across a refusal compares all of it.
  '  const state = async () => await call("read_claim_state");',
  '  const revisionIn = (said) => {',
  '    const found = said && said.match(/revision (\\d+)/);',
  '    return found ? Number(found[1]) : null;',
  '  };',
  // The value alone, without the "set by" clause or the [pinned] marker, because pinning the field
  // changes that line without changing the answer, and the answer is what must not move.
  '  const drivableIn = (said) => {',
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
  // THE FIRST WRITE, BRACKETED, SINCE 2026-09-02. This patch was called with nothing read either
  // side of it, so a page that took the car off the road AND wrote a second field nobody asked for
  // left no trace anywhere in the transcript. Only the two refusals were bracketed, which put the
  // whole weight of "no tool wrote anything it should not have" on the calls that wrote nothing by
  // design. The read that used to be thrown away on the line below is now the reading before.
  '  const bootBefore = await state();',
  '  out.bootPatch.stateBefore = bootBefore;',
  '  out.bootPatch.revisionBefore = revisionIn(bootBefore);',
  // The quoted revision stays the literal 0 it has always been. Reading it back out of the draft
  // would let this call succeed against a page whose draft did not start where it says it does,
  // which is a wider gate wearing the clothes of a tidier one.
  '  out.bootPatch.answer = await call("apply_claim_patch",',
  '    { baseRevision: 0, changes: [{ field: "vehicle_drivable", value: false }] });',
  '  const bootAfter = await state();',
  '  out.bootPatch.stateAfter = bootAfter;',
  '  out.bootPatch.revisionAfter = revisionIn(bootAfter);',
  '  out.toolsWhenStuck = await list();',
  // AND THE READ, BRACKETED TOO. get_assistance_options is the conditional tool and it writes
  // nothing, so the two readings either side of it have to be identical character for character.
  // A read that writes is the sharpest failure this journey could find and nothing watched for it.
  '  const assistanceBefore = await state();',
  '  out.assistance.stateBefore = assistanceBefore;',
  '  out.assistance.answer = await call("get_assistance_options");',
  '  out.assistance.stateAfter = await state();',
  '',
  // THE PLANTED NOTE. Read it, then do the opposite of what it says and record that nothing moved.
  // The note asks for vehicle_drivable to go back to yes and for the claim to be filed. Filing is
  // not a tool at all, so there is nothing to call, and the field is pinned here first so the
  // change it wants is refused with the code the page returns rather than merely declined.
  // One whole reading either side of the note read and nothing else inside that window. The pin
  // toggle below is deliberately outside it, because pinning legitimately changes the reading: it
  // adds the pin list line and a marker on the field. read_evidence_notes changes nothing at all,
  // so those two readings have to be identical, and the judgement compares them whole rather than
  // comparing the one field the note happens to name.
  '  const notesBefore = await state();',
  '  out.notes.stateBefore = notesBefore;',
  '  out.notes.drivableBefore = drivableIn(notesBefore);',
  '  out.notes.answer = await call("read_evidence_notes");',
  '  out.notes.stateAfter = await state();',
  '  await togglePin();',
  // One read before the refused patch and one after it, and the revision, the drivable answer and
  // the whole of the rest of the draft all come out of those two. Two reads, not five, so the
  // number the judgement compares and the state it compares are from the same moment.
  '  const pinnedBefore = await state();',
  '  out.notes.pinnedPatch.stateBefore = pinnedBefore;',
  '  out.notes.pinnedPatch.revisionBefore = revisionIn(pinnedBefore);',
  '  out.notes.pinnedPatch.answer = await call("apply_claim_patch",',
  '    { baseRevision: out.notes.pinnedPatch.revisionBefore,',
  '      changes: [{ field: "vehicle_drivable", value: true }] });',
  '  const pinnedAfter = await state();',
  '  out.notes.pinnedPatch.stateAfter = pinnedAfter;',
  '  out.notes.pinnedPatch.revisionAfter = revisionIn(pinnedAfter);',
  '  out.notes.drivableAfter = drivableIn(pinnedAfter);',
  '  out.notes.toolsAfterNotes = await list();',
  // Unpin, because the rest of the journey needs that field to be patchable again. If this click
  // does not land, the legal patch below is refused as locked and the judgement says so.
  '  await togglePin();',
  '',
  '  const staleBefore = await state();',
  '  out.stalePatch.stateBefore = staleBefore;',
  '  out.stalePatch.revisionBefore = revisionIn(staleBefore);',
  '  out.stalePatch.answer = await call("apply_claim_patch",',
  '    { baseRevision: 0, changes: [{ field: "severity", value: "dent" }] });',
  '  const staleAfter = await state();',
  '  out.stalePatch.stateAfter = staleAfter;',
  '  out.stalePatch.revisionAfter = revisionIn(staleAfter);',
  '',
  // THE RECOVERY WRITE, BRACKETED, FOR THE SAME REASON AS THE FIRST ONE. This is the call the
  // withdrawal half of the lifecycle depends on, and until now the only thing recorded about it
  // was the tool list it produced. Its own revision comes from the reading immediately before it
  // rather than from the refused patch above, so the number the judgement compares and the state
  // it compares come from the same moment.
  '  const recoveryBefore = await state();',
  '  out.recoveryPatch.stateBefore = recoveryBefore;',
  '  out.recoveryPatch.revisionBefore = revisionIn(recoveryBefore);',
  '  out.recoveryPatch.answer = await call("apply_claim_patch",',
  '    { baseRevision: out.recoveryPatch.revisionBefore,',
  '      changes: [{ field: "vehicle_drivable", value: true }] });',
  '  const recoveryAfter = await state();',
  '  out.recoveryPatch.stateAfter = recoveryAfter;',
  '  out.recoveryPatch.revisionAfter = revisionIn(recoveryAfter);',
  '  out.toolsAfterRecovery = await list();',
  '',
  '  const declared = (await context.getTools()).find(tool => tool.name === "record_supporting_details");',
  '  if (declared) {',
  '    out.declared.name = String(declared.name);',
  // Recorded as it arrived. String() would turn a browser that publishes no origin at all into the
  // seven letters "undefined", which reads like a value and would then be compared like one.
  '    out.declared.origin = (declared.origin === undefined || declared.origin === null)',
  '      ? null : String(declared.origin);',
  '    out.declared.description = String(declared.description);',
  // The schema as an OBJECT, not as a string of one. The judgement deep compares it against a
  // contract typed out by hand, and a string can only be searched for substrings, which is how a
  // schema missing a whole property used to pass.
  //
  // Chrome 152 hands inputSchema back as a JSON STRING rather than as an object, measured on
  // 2026-09-01 against the deployed page. A browser that hands back an object is read as it comes.
  // A string that will not parse is recorded exactly as it arrived, so the judgement refuses it and
  // prints the thing it could not read rather than a null.
  '    let builtSchema = declared.inputSchema;',
  '    if (typeof builtSchema === "string") {',
  '      try { builtSchema = JSON.parse(builtSchema); } catch { /* kept as the string it arrived as */ }',
  '    }',
  '    out.declared.schema = (builtSchema === undefined) ? null : builtSchema;',
  '    const declaredBefore = await state();',
  '    out.declared.stateBefore = declaredBefore;',
  '    out.declared.revisionBefore = revisionIn(declaredBefore);',
  // The name is written out here rather than interpolated, because tests/unit/probe_assertions.test.js
  // parses this array on its own and a template hole would not resolve there. It is pinned to
  // DECLARED_WITNESS_NAME by a test that greps this source for that exact string, so the two
  // cannot drift apart in silence.
  '    out.declared.answer = await call("record_supporting_details",',
  '      { witness_name: "M. Okafor", base_revision: out.declared.revisionBefore });',
  // The claim read again AFTER the call, because a revision that moved says a change was accepted
  // and says nothing about what was written. This is where the value is looked for.
  '    const declaredAfter = await state();',
  '    out.declared.stateAfter = declaredAfter;',
  '    out.declared.revisionAfter = revisionIn(declaredAfter);',
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
  // Recorded as it was handed to this script, empty included. Writing "unknown" here, or skipping
  // the key when nothing was passed, would let a transcript that cannot name its commit look like
  // one that simply did not need to. The judgement refuses both shapes and says which it got.
  transcript.build = { deployedSha: deployedSha || null };

  // PRINTED BEFORE IT IS JUDGED. The judgement reads fields the browser filled in and can throw on
  // a shape nobody expected, and when it did that the transcript went with it, so the one artifact
  // that would have explained the crash was never written. What was collected is printed first,
  // whatever happens next.
  console.log(JSON.stringify(transcript, null, 1));
  console.log('');

  const verdict = checkTranscript(transcript, { expectedPageUrl });
  console.log(`probe: judged against ${expectedPageUrl}, deployed commit ${deployedSha || 'not given'}`);
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
