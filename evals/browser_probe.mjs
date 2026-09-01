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
import http from 'node:http';
import net from 'node:net';
import crypto from 'node:crypto';

import { checkTranscript } from './probe_assertions.mjs';

const port = process.argv.includes('--port')
  ? process.argv[process.argv.indexOf('--port') + 1]
  : '9222';

function getJson(path) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path }, (response) => {
      let body = '';
      response.on('data', (chunk) => (body += chunk));
      response.on('end', () => {
        try { resolve(JSON.parse(body)); } catch (error) { reject(error); }
      });
    }).on('error', reject);
  });
}

function frame(payload) {
  const data = Buffer.from(payload, 'utf8');
  const mask = crypto.randomBytes(4);
  const masked = Buffer.alloc(data.length);
  for (let i = 0; i < data.length; i++) masked[i] = data[i] ^ mask[i % 4];
  let header;
  if (data.length < 126) {
    header = Buffer.from([0x81, 0x80 | data.length]);
  } else if (data.length < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 0xfe;
    header.writeUInt16BE(data.length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 0xff;
    header.writeBigUInt64BE(BigInt(data.length), 2);
  }
  return Buffer.concat([header, mask, masked]);
}

/**
 * The smallest Chrome DevTools Protocol client that can do this job: send commands, collect
 * answers by id, and keep every event that arrives in between. No dependencies.
 */
class Session {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.answers = new Map();
    this.events = [];
    this.partial = Buffer.alloc(0);
    this.buffer = Buffer.alloc(0);
  }

  feed(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    let offset = 0;
    while (offset + 2 <= this.buffer.length) {
      const final = (this.buffer[offset] & 0x80) !== 0;
      const opcode = this.buffer[offset] & 0x0f;
      let length = this.buffer[offset + 1] & 0x7f;
      let start = offset + 2;
      if (length === 126) {
        if (start + 2 > this.buffer.length) break;
        length = this.buffer.readUInt16BE(start);
        start += 2;
      } else if (length === 127) {
        if (start + 8 > this.buffer.length) break;
        length = Number(this.buffer.readBigUInt64BE(start));
        start += 8;
      }
      if (start + length > this.buffer.length) break;
      if (opcode === 1 || opcode === 0) {
        this.partial = Buffer.concat([this.partial, this.buffer.slice(start, start + length)]);
        if (final) {
          const text = this.partial.toString('utf8');
          this.partial = Buffer.alloc(0);
          try {
            const message = JSON.parse(text);
            if (message.id !== undefined) this.answers.set(message.id, message);
            else this.events.push(message);
          } catch { /* a frame this client does not need */ }
        }
      }
      offset = start + length;
    }
    this.buffer = this.buffer.slice(offset);
  }

  async send(method, params = {}, timeoutMs = 30000) {
    const id = this.nextId++;
    this.socket.write(frame(JSON.stringify({ id, method, params })));
    const started = Date.now();
    while (!this.answers.has(id)) {
      if (Date.now() - started > timeoutMs) throw new Error(`${method} did not answer in time`);
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    const message = this.answers.get(id);
    this.answers.delete(id);
    if (message.error) throw new Error(`${method}: ${JSON.stringify(message.error)}`);
    return message.result;
  }

  async evaluate(expression, timeoutMs = 40000) {
    const result = await this.send('Runtime.evaluate', {
      expression, returnByValue: true, awaitPromise: true,
    }, timeoutMs);
    if (result.exceptionDetails) {
      throw new Error(`the page threw: ${JSON.stringify(result.exceptionDetails).slice(0, 400)}`);
    }
    return result.result ? result.result.value : undefined;
  }

  /** Console errors and warnings, and anything the page threw, since Runtime was enabled. */
  problems() {
    const found = [];
    for (const event of this.events) {
      if (event.method === 'Runtime.consoleAPICalled'
        && (event.params.type === 'error' || event.params.type === 'warning')) {
        found.push(`console.${event.params.type}: ${(event.params.args || [])
          .map((arg) => String(arg.value ?? arg.description ?? '')).join(' ').slice(0, 200)}`);
      }
      if (event.method === 'Runtime.exceptionThrown') {
        const details = event.params.exceptionDetails || {};
        found.push(`page error: ${String(details.text || '')} ${String(
          (details.exception && (details.exception.description || details.exception.value)) || '',
        )}`.slice(0, 200));
      }
      if (event.method === 'Log.entryAdded' && event.params.entry
        && (event.params.entry.level === 'error' || event.params.entry.level === 'warning')) {
        found.push(`log ${event.params.entry.level}: ${String(event.params.entry.text || '').slice(0, 200)}`);
      }
    }
    return found;
  }
}

async function connect() {
  const targets = await getJson('/json');
  const page = targets.find((target) => target.type === 'page' && target.webSocketDebuggerUrl);
  if (!page) throw new Error('Chrome is running but has no page target. Give it the page URL.');
  const address = new URL(page.webSocketDebuggerUrl);
  const socket = net.connect(Number(address.port), address.hostname);
  await new Promise((resolve) => socket.once('connect', resolve));
  socket.write(
    `GET ${address.pathname} HTTP/1.1\r\n`
    + `Host: ${address.hostname}:${address.port}\r\n`
    + 'Upgrade: websocket\r\nConnection: Upgrade\r\n'
    + `Sec-WebSocket-Key: ${crypto.randomBytes(16).toString('base64')}\r\n`
    + 'Sec-WebSocket-Version: 13\r\n\r\n',
  );

  const session = new Session(socket);
  let upgraded = false;
  socket.on('data', (chunk) => {
    if (!upgraded) {
      session.buffer = Buffer.concat([session.buffer, chunk]);
      const end = session.buffer.indexOf('\r\n\r\n');
      if (end === -1) return;
      upgraded = true;
      const rest = session.buffer.slice(end + 4);
      session.buffer = Buffer.alloc(0);
      if (rest.length) session.feed(rest);
      return;
    }
    session.feed(chunk);
  });

  const started = Date.now();
  while (!upgraded) {
    if (Date.now() - started > 10000) throw new Error('Chrome never completed the WebSocket upgrade.');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return { session, socket };
}

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
  const connection = await connect();
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
