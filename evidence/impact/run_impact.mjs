/**
 * Run one scenario, in one arm, once, and write down exactly what happened.
 *
 *   node evidence/impact/run_impact.mjs --scenario S1-carpark-dent --arm published-rules --repeat 1
 *   node evidence/impact/run_impact.mjs --scenario S1-carpark-dent --arm static-form --repeat 1
 *
 * ARM A needs a Chrome with WebMCP on, the same one evals/browser_probe.mjs documents, and reaches
 * the page's tools through it. ARM B needs no browser: the model is handed evidence/impact/static-form.md
 * and the same brief, and returns field values.
 *
 * BOTH ARMS END IN THE SAME THING, a set of field values, which scripts/analyze_impact.mjs scores
 * with the page's own rules. Nothing here decides whether a run was good. This file only records.
 *
 * The participants are language models. The file says so, the protocol says so, and the analyser
 * refuses to print a sentence that does not.
 *
 * Needs OPENAI_API_KEY in the environment. Nothing is written anywhere but evidence/impact/runs.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { evaluateInPage } from './page_client.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..', '..');

const arg = (name, fallback) => (process.argv.includes(name)
  ? process.argv[process.argv.indexOf(name) + 1]
  : fallback);

const scenarioId = arg('--scenario');
const arm = arg('--arm', 'published-rules');
const repeat = Number(arg('--repeat', '1'));
const model = arg('--model', 'gpt-5');
const port = arg('--port', '9222');
const deployedSha = arg('--deployed-sha', 'unrecorded');
const maxTurns = Number(arg('--max-turns', '8'));

const scenarios = JSON.parse(readFileSync(path.join(ROOT, 'evidence/impact/scenarios.json'), 'utf8'));
const scenario = scenarios.scenarios.find((entry) => entry.id === scenarioId);
if (!scenario) {
  console.error(`no scenario called ${scenarioId}. There is: ${scenarios.scenarios.map((s) => s.id).join(', ')}`);
  process.exit(2);
}

const key = process.env.OPENAI_API_KEY;
if (!key) {
  console.error('OPENAI_API_KEY is not set, so no run can happen. Nothing was written.');
  process.exit(2);
}

async function ask(messages, tools) {
  const body = { model, messages };
  if (tools && tools.length) body.tools = tools;
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify(body),
  });
  const parsed = await response.json();
  if (parsed.error) throw new Error(`${parsed.error.type}: ${parsed.error.message}`);
  return parsed.choices[0].message;
}

const SYSTEM = 'You are helping someone report a motor insurance claim from the roadside. Work from '
  + 'what they told you and nothing else. Never invent a fact they did not give you: leave a field '
  + 'out rather than guess it. When you have nothing left to do, say so in one short sentence.';

/* ------------------------------------------------------------------ arm A, the published rules */

async function runPublishedRules() {
  // A fresh draft for every run. The page keeps its claim in memory, so a second run against a
  // browser that has already been driven would start from the first run's answers and score them
  // twice. Reload, then wait for the tools to register again.
  await evaluateInPage(port, 'location.reload(); "reloading"').catch(() => {});
  await new Promise((resolve) => setTimeout(resolve, 3500));

  const toolList = JSON.parse(await evaluateInPage(port, `(async () => {
    const context = document.modelContext ?? navigator.modelContext;
    if (!context) return JSON.stringify(null);
    const tools = await context.getTools();
    return JSON.stringify(tools.map(tool => ({
      name: String(tool.name),
      description: String(tool.description),
      schema: String(JSON.stringify(tool.inputSchema)),
    })));
  })()`));

  if (!toolList) throw new Error('the browser exposed no WebMCP API, so arm A cannot run');

  const tools = toolList.map((tool) => {
    let parameters = { type: 'object', properties: {} };
    try {
      const raw = JSON.parse(tool.schema);
      parameters = typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch { /* a tool whose schema will not parse is offered with no parameters */ }
    return {
      type: 'function',
      function: { name: tool.name, description: tool.description.slice(0, 900), parameters },
    };
  });

  const messages = [
    { role: 'system', content: SYSTEM },
    {
      role: 'user',
      // PARITY OF INSTRUCTION, AMENDED ONCE, ON 2026-09-01, BEFORE ANY SCORED RUN. Arm B is told
      // to fill the form in and to leave a key out rather than guess it. The first version of this
      // message told arm A only to fill the claim in, which is a weaker instruction than the one
      // the other arm gets, and a dry run stopped with a required field still empty. Both arms are
      // now told the same two things: complete it, and do not guess. Amended once and then left
      // alone, because tuning it until one arm wins is how a study becomes a demonstration.
      content: `This insurance page has published its own tools to you. Use them to find out what `
        + `this policy needs, and fill the claim in from what I am telling you. When you think it `
        + `is complete, check it with validate_claim. Leave a field alone rather than guess it.`
        + `

Here is what happened: ${scenario.brief}`,
    },
  ];

  const calls = [];
  const wrote = {};
  let turns = 0;

  while (turns < maxTurns) {
    turns += 1;
    const message = await ask(messages, tools);
    messages.push(message);
    if (!message.tool_calls || message.tool_calls.length === 0) break;

    for (const call of message.tool_calls) {
      const args = call.function.arguments || '{}';
      const answer = JSON.parse(await evaluateInPage(port, `(async () => {
        const context = document.modelContext ?? navigator.modelContext;
        const tool = (await context.getTools()).find(t => t.name === ${JSON.stringify(call.function.name)});
        if (!tool) return JSON.stringify({ text: 'no such tool', refused: true });
        try {
          const raw = await context.executeTool(tool, ${JSON.stringify(args)});
          let parsed = raw;
          if (typeof raw === 'string') {
            try { parsed = JSON.parse(raw); } catch { parsed = { content: [{ text: raw }] }; }
          }
          const text = parsed && parsed.content && parsed.content[0] ? String(parsed.content[0].text)
            : JSON.stringify(parsed);
          // A REFUSAL IS HOW THE ANSWER STARTS, NOT A WORD ANYWHERE IN IT. The first version of
          // this looked for REJECTED or REFUSED anywhere in the text, and a SUCCESSFUL patch says
          // "Applied ... The draft cannot be filed yet: FILE_REFUSED_INCOMPLETE" further down. So
          // every successful patch was recorded as refused and its fields were dropped, which made
          // the arm look like it had written nothing. Found in the dry run, before any scored run.
          const head = String(text).trim();
          const refused = /^(refused|patch_rejected|form_refused|file_refused)/i.test(head);
          return JSON.stringify({ text, refused });
        } catch (error) {
          return JSON.stringify({ text: String(error && error.message || error), refused: true });
        }
      })()`));

      // The answer is kept, not just whether it refused. A refusal this page wrote is the most
      // informative line in the whole run, and a record that drops it cannot be diagnosed later.
      calls.push({
        tool: call.function.name,
        args,
        refused: answer.refused,
        answered: String(answer.text).slice(0, 400),
      });

      // What the run actually wrote, taken from its own patches rather than from the page, so both
      // arms are scored on the values the model produced.
      if (call.function.name === 'apply_claim_patch' && !answer.refused) {
        try {
          for (const change of (JSON.parse(args).changes || [])) wrote[change.field] = change.value;
        } catch { /* an unparseable patch wrote nothing */ }
      }
      if (call.function.name === 'record_supporting_details' && !answer.refused) {
        try {
          const sent = JSON.parse(args);
          if (sent.witness_name) wrote.witness_name = sent.witness_name;
          if (sent.police_report_ref) wrote.police_report_ref = sent.police_report_ref;
        } catch { /* same */ }
      }

      messages.push({ role: 'tool', tool_call_id: call.id, content: answer.text.slice(0, 1500) });
    }
  }

  return { fields: wrote, turns, tool_calls: calls };
}

/* ---------------------------------------------------------------------- arm B, the static form */

async function runStaticForm() {
  const form = readFileSync(path.join(ROOT, 'evidence/impact/static-form.md'), 'utf8');
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
  let fields = {};
  try {
    fields = json ? JSON.parse(json[0]) : {};
  } catch { /* a run that answered with something that is not JSON produced no fields */ }
  return { fields, turns: 1, tool_calls: [] };
}

/* ------------------------------------------------------------------------------------- record */

const started = new Date().toISOString();
let outcome;
let technicalFailure = false;
let note = null;

try {
  outcome = arm === 'published-rules' ? await runPublishedRules() : await runStaticForm();
} catch (error) {
  technicalFailure = true;
  note = String(error && error.message ? error.message : error);
  outcome = { fields: {}, turns: 0, tool_calls: [] };
}

const record = {
  contract: 'claimready.impact.run.v1',
  scenario_id: scenario.id,
  arm,
  repeat,
  model,
  deployed_sha: deployedSha,
  started,
  finished: new Date().toISOString(),
  participants_were: 'a language model, not a person',
  fields: outcome.fields,
  turns: outcome.turns,
  tool_calls: outcome.tool_calls,
  attempted_human_only: false,
  technical_failure: technicalFailure,
  note,
};

const dir = path.join(ROOT, 'evidence/impact/runs');
mkdirSync(dir, { recursive: true });
const file = path.join(dir, `${scenario.id}__${arm}__${repeat}.json`);
writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`, 'utf8');

console.log(`${path.relative(ROOT, file)}: ${technicalFailure ? 'TECHNICAL FAILURE, ' + note : ''}`
  + `${Object.keys(outcome.fields).length} field(s), ${outcome.turns} turn(s), `
  + `${outcome.tool_calls.length} tool call(s)`);
if (technicalFailure) process.exit(1);
