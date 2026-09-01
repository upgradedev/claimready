/**
 * What a browser has to have done for the probe to pass, expressed over the transcript it collects.
 *
 * WHY THIS IS ITS OWN FILE. `evals/browser_probe.mjs` used to drive a browser and print what it
 * saw. It printed `api: null` and exited 0, which is the worst shape a check can have: a run
 * against a page with no WebMCP at all looked the same to a reader as a run that proved the whole
 * lifecycle. Splitting the judgement out from the driving makes the judgement testable without a
 * browser, so `tests/unit/probe_assertions.test.js` can break the transcript eight ways and require
 * a failure each time. A gate nobody has watched fail is not a gate.
 *
 * PURE MODULE. Transcript in, findings out. No browser, no network, no I/O.
 */

/** The tools the page registers before anything on the claim has changed, plus the declared one. */
export const EXPECTED_BOOT_TOOLS = [
  'apply_claim_patch',
  'check_coverage',
  'describe_claim',
  'get_repair_estimate',
  'get_requirements',
  'read_claim_state',
  'read_evidence_notes',
  'record_supporting_details',
  'validate_claim',
];

/** The one that is published only while the claim says the car cannot be driven. */
export const CONDITIONAL_TOOL = 'get_assistance_options';

/** The one the page builds from four HTML attributes rather than registering. */
export const DECLARED_TOOL = 'record_supporting_details';

/**
 * Names that must never be on the surface. Filing, pinning and calling a recovery truck are the
 * page's, and a tool that offers any of them is the entry contradicting itself.
 */
export const FORBIDDEN_TOOLS = [
  'file_claim', 'file', 'submit_claim', 'submit', 'unpin_field', 'pin_field',
  'request_assistance', 'dispatch_assistance', 'export_packet', 'download_packet',
];

const sorted = (list) => [...list].sort();

/**
 * Judge a transcript.
 *
 * @param {object} transcript what browser_probe.mjs collected
 * @returns {{ok: boolean, failures: string[], checks: number}}
 */
export function checkTranscript(transcript) {
  const failures = [];
  let checks = 0;
  const fail = (message) => failures.push(message);
  const check = (condition, message) => {
    checks += 1;
    if (!condition) fail(message);
  };

  if (!transcript || typeof transcript !== 'object') {
    return { ok: false, failures: ['there is no transcript, so nothing was observed'], checks: 1 };
  }

  // 1. THE API ITSELF. A page with no WebMCP is the case this whole file exists for.
  check(
    transcript.api === 'document.modelContext' || transcript.api === 'navigator.modelContext',
    `no WebMCP API was found, so nothing below could have happened. The page reported: ${JSON.stringify(transcript.api)}`,
  );

  // 2. THE BOOT SURFACE, BY NAME. A count alone would pass a surface with the right size and the
  //    wrong contents.
  const boot = Array.isArray(transcript.bootTools) ? transcript.bootTools : [];
  check(
    JSON.stringify(sorted(boot)) === JSON.stringify(sorted(EXPECTED_BOOT_TOOLS)),
    `the tools at boot are not the ones this page publishes.\n    expected: ${sorted(EXPECTED_BOOT_TOOLS).join(', ')}\n    found:    ${sorted(boot).join(', ') || 'nothing'}`,
  );
  check(
    !boot.includes(CONDITIONAL_TOOL),
    `${CONDITIONAL_TOOL} was on the surface at boot, and it is only published while the claim says the car cannot be driven`,
  );

  // 3. NOTHING THE PAGE KEEPS FOR A PERSON MAY BE A TOOL, at any point in the run.
  const everySeen = new Set([...boot, ...(transcript.toolsWhenStuck || []), ...(transcript.toolsAfterRecovery || [])]);
  for (const forbidden of FORBIDDEN_TOOLS) {
    check(!everySeen.has(forbidden), `${forbidden} reached the tool surface, and the page says nothing there files, pins or dispatches`);
  }

  // 4. THE LIFECYCLE, BOTH WAYS. Registering is half of it. The half nobody tests is the removal.
  const stuck = Array.isArray(transcript.toolsWhenStuck) ? transcript.toolsWhenStuck : [];
  const recovered = Array.isArray(transcript.toolsAfterRecovery) ? transcript.toolsAfterRecovery : [];
  check(stuck.includes(CONDITIONAL_TOOL), `${CONDITIONAL_TOOL} did not appear when the claim said the car cannot be driven`);
  check(!recovered.includes(CONDITIONAL_TOOL), `${CONDITIONAL_TOOL} was still on the surface after a patch put the car back on the road, so the browser did not honour the withdrawal`);

  // 5. THE REFUSAL, AND THAT IT REFUSED. A code in a string is not proof on its own: the state has
  //    to be where it was.
  const stale = transcript.stalePatch || {};
  check(typeof stale.answer === 'string' && stale.answer.includes('PATCH_REJECTED_STALE'),
    `a patch quoting an old revision was not refused as stale. It answered: ${JSON.stringify(stale.answer)}`);
  check(stale.revisionBefore !== undefined && stale.revisionBefore === stale.revisionAfter,
    `the refused patch moved the revision from ${stale.revisionBefore} to ${stale.revisionAfter}, so it was not refused at all`);

  // 6. THE DECLARED HALF. Built by the browser from markup, with our own descriptions on it, and
  //    executing through the same revision safe path as everything else.
  const declared = transcript.declared || {};
  check(declared.name === DECLARED_TOOL, `the browser did not build ${DECLARED_TOOL} from the form's attributes`);
  check(typeof declared.description === 'string' && declared.description.length > 0,
    'the declared tool reached the surface with no description, so an agent cannot tell what it does');
  check(typeof declared.schema === 'string' && declared.schema.includes('witness_name')
    && declared.schema.includes('base_revision'),
    `the declared tool's schema is not the one the markup describes: ${JSON.stringify(declared.schema || null)}`);
  check(typeof declared.answer === 'string' && declared.answer.length > 0,
    'the declared tool did not answer when it was executed');
  check(declared.revisionAfter === declared.revisionBefore + 1,
    `the declared tool moved the draft from ${declared.revisionBefore} to ${declared.revisionAfter}, and an accepted change moves it by exactly one`);

  // 7. THE CONSOLE. A page that works and shouts is not a page that works.
  const console = Array.isArray(transcript.consoleProblems) ? transcript.consoleProblems : [];
  check(console.length === 0, `the page reported ${console.length} console or page error(s): ${console.slice(0, 3).join(' | ')}`);

  // 8. AND ANY TOOL THAT THREW RATHER THAN ANSWERING.
  const threw = Array.isArray(transcript.threw) ? transcript.threw : [];
  check(threw.length === 0, `${threw.length} tool call(s) threw instead of answering: ${threw.slice(0, 3).join(' | ')}`);

  return { ok: failures.length === 0, failures, checks };
}
