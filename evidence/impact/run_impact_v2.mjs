/**
 * The protocol v2 runner. It is finished, it is testable, and it has never been run.
 *
 *   node evidence/impact/run_impact_v2.mjs --selftest
 *   node evidence/impact/run_impact_v2.mjs --scenario S1-carpark-dent --arm static-form --repeat 1
 *   node evidence/impact/run_impact_v2.mjs --scenario S1-carpark-dent --arm static-form --repeat 1 \
 *        --out evidence/impact/runs-v2 --spend-credits
 *
 * NOTHING HERE REACHES THE NETWORK UNLESS `--spend-credits` IS ON THE COMMAND LINE. That is the
 * point of the file. v1's runner spent money the moment `OPENAI_API_KEY` was in the environment,
 * which is every shell on this machine, so the only thing standing between a stray command and a
 * bill was remembering not to type it. Here the default is a dry run: the same code path, the same
 * record assembly, the same guards, a stub transport, and nothing written. A run that costs money
 * has to be asked for by name.
 *
 * WHAT V2 CHANGES, all of it because of `evidence/impact/errata-v1.md`:
 *
 *   1. Records carry the request and runtime metadata v1 threw away, and this program REFUSES to
 *      write a record that is missing any of it. See `REQUIRED_METADATA` below. v1 recorded a model
 *      family alias, no settings, no response ids, no page URL, no browser version, and a build SHA
 *      that came off the command line rather than out of the page.
 *   2. The v1 runs are unreachable from here. `--out` is required and is refused if it resolves
 *      inside `evidence/impact/runs`, and an existing record file is never overwritten.
 *   3. The contract on every record is `claimready.impact.run.v2`, and the analyzer keeps the two
 *      generations apart by it.
 *   4. `attempted_human_only` is gone. It was never measured. Nothing replaces it until something
 *      actually watches for a tool call that tried to file, pin or dispatch.
 *
 * WHY IT CANNOT RUN TODAY, stated here rather than discovered later. `verified_runtime_sha` has to
 * be read back out of the running page, and the page does not publish its build SHA anywhere a
 * script can read. Until it does, a real run stops at the metadata gate with the message below.
 * That is deliberate: a SHA typed on the command line is an assertion, and v1 already has one of
 * those.
 *
 * The participants are language models. Every record says so and the analyzer refuses a sentence
 * that does not.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { formOnly } from './form.mjs';
import { evaluateInPage } from './page_client.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.join(HERE, '..', '..');

/** The contract every v2 record carries. The analyzer refuses a folder that mixes generations. */
export const V2_CONTRACT = 'claimready.impact.run.v2';

/** Where the frozen v1 evidence lives. Nothing this program does may land inside it. */
export const V1_RUNS_DIR = path.join(ROOT, 'evidence', 'impact', 'runs');

/**
 * The metadata v1 did not keep, listed once so the runner, the analyzer and the errata agree.
 *
 * Each entry says what the field has to hold, in the words the refusal uses. A future reader who
 * wants to know what "settings" means does not have to guess.
 */
export const REQUIRED_METADATA = {
  model_snapshot: 'the exact dated snapshot the provider names, not a family alias like gpt-5',
  request_settings: 'every sampling and tool setting sent, written out, including ones left default',
  response_ids: 'the response id for every request, and the system fingerprint where one comes back',
  page_url: 'the URL of the tab the run actually drove',
  browser_version: 'the browser build, read from the browser rather than typed',
  verified_runtime_sha: 'the build SHA read back out of the running page, not passed in on the command line',
};

/* --------------------------------------------------------------------------------- the guards */

/**
 * May a record be written here?
 *
 * The v1 folder is the one that matters. It backs a published claim, it is frozen, and the easiest
 * way to destroy it is a v2 command with a forgotten flag. A relative check on the string would
 * miss `evidence/impact/runs/../runs` and every absolute spelling, so both sides are resolved
 * first and the containment test is done on path segments rather than on a prefix, because
 * `runs-v2` starts with `runs`.
 *
 * @param {string} outDir where the caller wants records written
 * @returns {{ok: boolean, error?: string}}
 */
export function guardOutDir(outDir) {
  if (!outDir) {
    return { ok: false, error: '--out is required. v2 never writes to the v1 folder by default or by accident.' };
  }
  const resolved = path.resolve(ROOT, outDir);
  const relative = path.relative(V1_RUNS_DIR, resolved);
  const inside = relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
  if (inside) {
    return {
      ok: false,
      error: `${resolved} is inside the frozen v1 evidence at ${V1_RUNS_DIR}. Those 36 files back a `
        + 'published claim and nothing writes there. Pick another --out.',
    };
  }
  return { ok: true };
}

/**
 * Which of the required metadata fields this record has not actually got.
 *
 * A field that is present and empty counts as missing. That is the case worth catching: a runner
 * that could not read the browser version and wrote an empty string produces a record that passes
 * a key check and carries nothing, which is exactly the shape `attempted_human_only` had.
 *
 * @param {object} record
 * @returns {string[]} field names, in the order they are declared
 */
export function missingMetadata(record) {
  const out = [];
  for (const field of Object.keys(REQUIRED_METADATA)) {
    const value = record ? record[field] : undefined;
    if (value === undefined || value === null) { out.push(field); continue; }
    if (typeof value === 'string' && value.trim() === '') { out.push(field); continue; }
    if (Array.isArray(value) && value.length === 0) { out.push(field); continue; }
    if (typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0) {
      out.push(field);
    }
  }
  return out;
}

/**
 * Assemble a v2 record. Pure: it reads no clock of its own and touches no disk.
 *
 * @param {object} parts
 * @returns {object} the record as it would be written
 */
export function buildRecord(parts) {
  return {
    contract: V2_CONTRACT,
    protocol: 'evidence/impact/protocol-v2.md',
    scenario_id: parts.scenario_id,
    arm: parts.arm,
    repeat: parts.repeat,
    model: parts.model,
    model_snapshot: parts.model_snapshot ?? null,
    request_settings: parts.request_settings ?? null,
    response_ids: parts.response_ids ?? null,
    page_url: parts.page_url ?? null,
    browser_version: parts.browser_version ?? null,
    verified_runtime_sha: parts.verified_runtime_sha ?? null,
    started: parts.started,
    finished: parts.finished,
    participants_were: 'a language model, not a person',
    fields: parts.fields ?? {},
    turns: parts.turns ?? 0,
    tool_calls: parts.tool_calls ?? [],
    technical_failure: Boolean(parts.technical_failure),
    note: parts.note ?? null,
  };
}

/**
 * Where one record goes, and whether something is already there.
 *
 * @param {string} outDir
 * @param {object} record
 * @returns {{file: string, exists: boolean}}
 */
export function recordPath(outDir, record) {
  const file = path.join(
    path.resolve(ROOT, outDir),
    `${record.scenario_id}__${record.arm}__${record.repeat}.json`,
  );
  return { file, exists: existsSync(file) };
}

/**
 * The settings this study sends, written down rather than left to a provider default.
 *
 * v1 sent none and could not say afterwards what it had used. Naming them here means the record
 * says what was asked for even when the value is the boring one.
 */
export const REQUEST_SETTINGS = {
  temperature: 1,
  top_p: 1,
  max_completion_tokens: 4096,
  tool_choice: 'auto',
  parallel_tool_calls: false,
};

/* ------------------------------------------------------------------------- the stub transport */

/**
 * What a dry run uses instead of the provider and instead of a browser.
 *
 * It answers with a fixed shape, not a plausible claim. A stub that produced convincing field
 * values would tempt somebody to score it, and a scored dry run is fabricated evidence. So the
 * fields it returns are obviously not an answer, and nothing writes them anywhere.
 */
export function stubTransport() {
  return {
    fields: { description: 'DRY RUN. No model was asked anything.' },
    turns: 0,
    tool_calls: [],
    response_ids: ['dry-run, no request was made'],
    model_snapshot: 'dry-run, no snapshot was served',
  };
}

/* ----------------------------------------------------------------------------- reading the page */

/**
 * The three facts about the runtime that v1 never wrote down.
 *
 * The build SHA is read from a meta tag the page would have to publish. It does not publish one
 * today, so this comes back null and the metadata gate stops the run. That refusal is the honest
 * state of v2 and it is better than a SHA somebody typed.
 *
 * @param {string} port the browser debug port
 * @returns {Promise<{page_url: string|null, verified_runtime_sha: string|null, browser_version: string|null}>}
 */
export async function readRuntimeFacts(port) {
  const raw = await evaluateInPage(port, `(() => {
    const meta = document.querySelector('meta[name="claimready-build"]');
    return JSON.stringify({
      page_url: location.href,
      verified_runtime_sha: meta ? String(meta.content || '') : null,
      browser_version: navigator.userAgent || null,
    });
  })()`);
  return JSON.parse(raw);
}

/* -------------------------------------------------------------------------------- the dry runs */

/**
 * Every check this program can make about itself without a network, a browser or a key.
 *
 * They are assertions about the guards, not about a result. A guard that has never been watched
 * refusing is a guard nobody has tested, and this file exists precisely so that the expensive
 * version is not the first time anything runs.
 *
 * @returns {{name: string, ok: boolean, detail: string}[]}
 */
export function selfTests() {
  const checks = [];
  const add = (name, ok, detail) => checks.push({ name, ok, detail });

  const intoV1 = guardOutDir('evidence/impact/runs');
  add('writing into the frozen v1 folder is refused', intoV1.ok === false, String(intoV1.error));

  const intoV1Absolute = guardOutDir(V1_RUNS_DIR);
  add('the same folder by absolute path is refused', intoV1Absolute.ok === false, String(intoV1Absolute.error));

  const sneaky = guardOutDir('evidence/impact/runs-v2/../runs');
  add('a path that walks back into v1 is refused', sneaky.ok === false, String(sneaky.error));

  const sibling = guardOutDir('evidence/impact/runs-v2');
  add('the v2 folder is allowed', sibling.ok === true, sibling.error || 'evidence/impact/runs-v2');

  const noOut = guardOutDir(undefined);
  add('no --out at all is refused', noOut.ok === false, String(noOut.error));

  const bare = buildRecord({ scenario_id: 'S1-carpark-dent', arm: 'static-form', repeat: 1, model: 'x' });
  const missing = missingMetadata(bare);
  add(
    'a record with no metadata names all six fields',
    missing.length === Object.keys(REQUIRED_METADATA).length,
    missing.join(', '),
  );

  const halfFilled = buildRecord({
    scenario_id: 'S1-carpark-dent',
    arm: 'static-form',
    repeat: 1,
    model: 'x',
    model_snapshot: 'snapshot',
    request_settings: REQUEST_SETTINGS,
    response_ids: ['id'],
    page_url: 'https://example.invalid/',
    browser_version: '   ',
    verified_runtime_sha: null,
  });
  const half = missingMetadata(halfFilled);
  add(
    'a blank string and a null are both counted as missing',
    half.length === 2 && half.includes('browser_version') && half.includes('verified_runtime_sha'),
    half.join(', '),
  );

  add('the contract on a built record is the v2 one', bare.contract === V2_CONTRACT, bare.contract);
  add(
    'no built record carries the field nothing ever measured',
    Object.prototype.hasOwnProperty.call(bare, 'attempted_human_only') === false,
    'attempted_human_only is absent',
  );

  const stub = stubTransport();
  add(
    'the dry run transport does not produce a scorable answer',
    Object.keys(stub.fields).length === 1 && String(stub.fields.description).startsWith('DRY RUN'),
    JSON.stringify(stub.fields),
  );

  return checks;
}

/* ---------------------------------------------------------------------------------------- CLI */

// Nothing below runs when this file is imported, which is how the tests reach the functions above
// without any risk of a request going out.
const invokedDirectly = process.argv[1]
  && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (invokedDirectly) {
  const arg = (name, fallback) => (process.argv.includes(name)
    ? process.argv[process.argv.indexOf(name) + 1]
    : fallback);

  if (process.argv.includes('--selftest')) {
    const checks = selfTests();
    for (const check of checks) {
      console.log(`${check.ok ? '  ok  ' : '  NOT OK  '} ${check.name}`);
      console.log(`         ${check.detail}`);
    }
    const failed = checks.filter((check) => !check.ok);
    console.log(`\n${checks.length - failed.length} of ${checks.length} dry run check(s) passed. `
      + 'No network, no browser, no key, nothing written.');
    process.exit(failed.length === 0 ? 0 : 1);
  }

  const scenarioId = arg('--scenario');
  const arm = arg('--arm', 'published-rules');
  const repeat = Number(arg('--repeat', '1'));
  const model = arg('--model', 'unset');
  const port = arg('--port', '9222');
  const outDir = arg('--out');
  const spend = process.argv.includes('--spend-credits');

  const scenarios = JSON.parse(readFileSync(path.join(ROOT, 'evidence/impact/scenarios.json'), 'utf8'));
  const scenario = scenarios.scenarios.find((entry) => entry.id === scenarioId);
  if (!scenario) {
    console.error(`no scenario called ${scenarioId}. There is: ${scenarios.scenarios.map((s) => s.id).join(', ')}`);
    process.exit(2);
  }

  const started = new Date().toISOString();

  if (!spend) {
    // THE DEFAULT. It goes through record assembly and both guards, so the expensive path is not
    // the first time any of this executes, and it stops where a real run would stop.
    const outcome = stubTransport();
    const record = buildRecord({
      scenario_id: scenario.id,
      arm,
      repeat,
      model,
      model_snapshot: outcome.model_snapshot,
      request_settings: REQUEST_SETTINGS,
      response_ids: outcome.response_ids,
      page_url: 'dry-run, no page was opened',
      browser_version: 'dry-run, no browser was started',
      verified_runtime_sha: 'dry-run, nothing was read from a page',
      started,
      finished: new Date().toISOString(),
      fields: outcome.fields,
      turns: outcome.turns,
      tool_calls: outcome.tool_calls,
      note: 'DRY RUN. Nothing was sent and nothing was written.',
    });

    const guard = guardOutDir(outDir || 'evidence/impact/runs-v2');
    console.log('DRY RUN. No request was made and no file was written.');
    console.log(`out dir guard: ${guard.ok ? 'would allow' : `would refuse, ${guard.error}`}`);
    console.log(`metadata gate: ${missingMetadata(record).length === 0 ? 'complete' : `missing ${missingMetadata(record).join(', ')}`}`);
    console.log(JSON.stringify(record, null, 2));
    console.log('\nTo run this for real, add --spend-credits and an --out that is not the v1 folder.');
    process.exit(0);
  }

  /* Everything past here costs money. It is reached only with --spend-credits. */

  const guard = guardOutDir(outDir);
  if (!guard.ok) {
    console.error(`refused before spending anything: ${guard.error}`);
    process.exit(2);
  }

  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    console.error('OPENAI_API_KEY is not set, so no run can happen. Nothing was written.');
    process.exit(2);
  }

  const modelSnapshot = arg('--model-snapshot');
  if (!modelSnapshot) {
    console.error('--model-snapshot is required and has to name the exact dated snapshot. '
      + `v1 recorded a family alias and could not say afterwards what served it. ${REQUIRED_METADATA.model_snapshot}`);
    process.exit(2);
  }

  const responseIds = [];

  async function ask(messages, tools) {
    const body = { model, messages, ...REQUEST_SETTINGS };
    if (tools && tools.length) body.tools = tools;
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
    });
    const parsed = await response.json();
    if (parsed.error) throw new Error(`${parsed.error.type}: ${parsed.error.message}`);
    // THE LINE V1 DID NOT HAVE. Everything but the message used to be dropped here, which is why
    // the errata cannot say which snapshot answered any of the 36 recorded runs.
    responseIds.push({
      id: parsed.id ?? null,
      system_fingerprint: parsed.system_fingerprint ?? null,
      model: parsed.model ?? null,
    });
    return parsed.choices[0].message;
  }

  const SYSTEM = 'You are helping someone report a motor insurance claim from the roadside. Work from '
    + 'what they told you and nothing else. Never invent a fact they did not give you: leave a field '
    + 'out rather than guess it. When you have nothing left to do, say so in one short sentence.';

  let facts = { page_url: null, verified_runtime_sha: null, browser_version: null };
  let outcome = { fields: {}, turns: 0, tool_calls: [] };
  let technicalFailure = false;
  let note = null;

  try {
    if (arm === 'published-rules') {
      facts = await readRuntimeFacts(port);
      throw new Error('arm A is not wired to a v2 run yet. The v1 arm A loop is in run_impact.mjs '
        + 'and is not copied here until the page publishes a build SHA to verify against.');
    }
    const form = formOnly(readFileSync(path.join(ROOT, 'evidence/impact/static-form.md'), 'utf8'));
    const message = await ask([
      { role: 'system', content: SYSTEM },
      {
        role: 'user',
        content: `Here is the insurer's claim form:\n\n${form}\n\nHere is what happened: `
          + `${scenario.brief}\n\nFill the form in. Answer with JSON only, one object, using these `
          + 'keys where you have an answer: incident_date, incident_type, damage_zone, severity, '
          + 'vehicle_drivable, description, driver, location, police_report_ref, witness_name. '
          + 'Leave a key out rather than guess it.',
      },
    ]);
    const text = String(message.content || '');
    const json = text.match(/\{[\s\S]*\}/);
    outcome = { fields: json ? JSON.parse(json[0]) : {}, turns: 1, tool_calls: [] };
  } catch (error) {
    technicalFailure = true;
    note = String(error && error.message ? error.message : error);
  }

  const record = buildRecord({
    scenario_id: scenario.id,
    arm,
    repeat,
    model,
    model_snapshot: modelSnapshot,
    request_settings: REQUEST_SETTINGS,
    response_ids: responseIds,
    page_url: facts.page_url,
    browser_version: facts.browser_version,
    verified_runtime_sha: facts.verified_runtime_sha,
    started,
    finished: new Date().toISOString(),
    fields: outcome.fields,
    turns: outcome.turns,
    tool_calls: outcome.tool_calls,
    technical_failure: technicalFailure,
    note,
  });

  const missing = missingMetadata(record);
  if (missing.length) {
    console.error('the run happened and the record is NOT written, because it is missing:');
    for (const field of missing) console.error(`  ${field}: ${REQUIRED_METADATA[field]}`);
    console.error('v1 shipped without these and the errata is the result. A v2 record without them '
      + 'would be the same mistake with a bigger version number.');
    console.error(JSON.stringify(record, null, 2));
    process.exit(1);
  }

  const target = recordPath(outDir, record);
  if (target.exists) {
    console.error(`${target.file} already exists. v2 never overwrites a record: a rerun that `
      + 'replaces its own evidence is how a set of runs quietly becomes the best set of runs.');
    process.exit(1);
  }

  mkdirSync(path.dirname(target.file), { recursive: true });
  writeFileSync(target.file, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  console.log(`${path.relative(ROOT, target.file)}: ${technicalFailure ? `TECHNICAL FAILURE, ${note}, ` : ''}`
    + `${Object.keys(record.fields).length} field(s), ${record.turns} turn(s)`);
  if (technicalFailure) process.exit(1);
}
