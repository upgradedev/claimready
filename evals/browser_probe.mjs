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
 * evals/probe_assertions.mjs, which tests/unit/probe_assertions.test.js breaks fourteen ways and
 * requires a failure each time, and this file exits 1 when that judgement says so.
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
import { checkTranscript } from './probe_assertions.mjs';

const port = process.argv.includes('--port')
  ? process.argv[process.argv.indexOf('--port') + 1]
  : '9222';

// This runs inside the page, so it is written as one source string rather than as a function.
const JOURNEY = [
  '(async () => {',
  '  const context = document.modelContext ?? navigator.modelContext;',
  '  const out = { api: null, bootTools: [], toolsWhenStuck: [], toolsAfterRecovery: [],',
  '    stalePatch: {}, declared: {}, threw: [] };',
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
  '',
  '  out.bootTools = await list();',
  '  await call("read_claim_state");',
  '  await call("apply_claim_patch", { baseRevision: 0, changes: [{ field: "vehicle_drivable", value: false }] });',
  '  out.toolsWhenStuck = await list();',
  '  await call("get_assistance_options");',
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

  const verdict = checkTranscript(transcript);

  console.log(JSON.stringify(transcript, null, 1));
  console.log('');
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
