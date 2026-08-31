/**
 * Drive the deployed page through a real browser's own WebMCP implementation, and print what it
 * did. No dependencies: Node 20 and a Chrome you launched yourself.
 *
 * It exists because our other browser evidence comes from a CI runner. This asks the same question
 * on a desktop, in the stable channel, from a reader who has this repository and nothing else.
 *
 *   1. Launch Chrome with WebMCP on and a throwaway profile, pointed at the deployed page:
 *
 *      chrome --headless=new --disable-gpu --enable-features=WebMCP \
 *             --remote-debugging-port=9222 --user-data-dir=<a temp dir> \
 *             https://upgradedev.github.io/claimready/
 *
 *   2. node evals/browser_probe.mjs
 *
 * What this is NOT: the caller here is this script, not a model. It shows that the browser
 * publishes, executes and withdraws the tools this page declares, and that a refusal comes back
 * verbatim. What a model does with those tools is a different question and is not answered here.
 */
import http from 'node:http';
import net from 'node:net';
import crypto from 'node:crypto';

const port = process.argv.includes('--port')
  ? process.argv[process.argv.indexOf('--port') + 1]
  : '9222';

function getJson(path) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path }, response => {
      let body = '';
      response.on('data', chunk => (body += chunk));
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

let continued = Buffer.alloc(0);
function readFrames(buffer) {
  const messages = [];
  let offset = 0;
  while (offset + 2 <= buffer.length) {
    const final = (buffer[offset] & 0x80) !== 0;
    const opcode = buffer[offset] & 0x0f;
    let length = buffer[offset + 1] & 0x7f;
    let start = offset + 2;
    if (length === 126) {
      if (start + 2 > buffer.length) break;
      length = buffer.readUInt16BE(start);
      start += 2;
    } else if (length === 127) {
      if (start + 8 > buffer.length) break;
      length = Number(buffer.readBigUInt64BE(start));
      start += 8;
    }
    if (start + length > buffer.length) break;
    if (opcode === 1 || opcode === 0) {
      continued = Buffer.concat([continued, buffer.slice(start, start + length)]);
      if (final) {
        messages.push(continued.toString('utf8'));
        continued = Buffer.alloc(0);
      }
    }
    offset = start + length;
  }
  return { messages, rest: buffer.slice(offset) };
}

async function evaluate(expression) {
  const targets = await getJson('/json');
  const page = targets.find(target => target.type === 'page' && target.webSocketDebuggerUrl);
  if (!page) throw new Error('Chrome is running but has no page target. Give it the page URL.');
  const address = new URL(page.webSocketDebuggerUrl);
  const socket = net.connect(Number(address.port), address.hostname);
  await new Promise(resolve => socket.once('connect', resolve));
  socket.write(
    'GET ' + address.pathname + ' HTTP/1.1\r\n' +
    'Host: ' + address.hostname + ':' + address.port + '\r\n' +
    'Upgrade: websocket\r\nConnection: Upgrade\r\n' +
    'Sec-WebSocket-Key: ' + crypto.randomBytes(16).toString('base64') + '\r\n' +
    'Sec-WebSocket-Version: 13\r\n\r\n'
  );

  let buffer = Buffer.alloc(0);
  let upgraded = false;
  const answers = [];
  socket.on('data', chunk => {
    buffer = Buffer.concat([buffer, chunk]);
    if (!upgraded) {
      const end = buffer.indexOf('\r\n\r\n');
      if (end === -1) return;
      upgraded = true;
      buffer = buffer.slice(end + 4);
      socket.write(frame(JSON.stringify({
        id: 1,
        method: 'Runtime.evaluate',
        params: { expression, returnByValue: true, awaitPromise: true }
      })));
    }
    const { messages, rest } = readFrames(buffer);
    buffer = rest;
    for (const message of messages) {
      try {
        if (JSON.parse(message).id === 1) answers.push(message);
      } catch {
        // an event rather than the answer to the evaluation
      }
    }
  });

  const started = Date.now();
  while (answers.length === 0 && Date.now() - started < 30000) {
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  socket.destroy();
  if (!answers.length) throw new Error('Chrome never answered the evaluation.');
  const answer = JSON.parse(answers[0]);
  if (answer.result && answer.result.exceptionDetails) {
    throw new Error('the page threw: ' +
      JSON.stringify(answer.result.exceptionDetails).slice(0, 500));
  }
  return answer.result && answer.result.result ? answer.result.result.value : undefined;
}

// This runs inside the page, so it is written as one source string rather than as a function.
const JOURNEY = [
  '(async () => {',
  '  const context = document.modelContext ?? navigator.modelContext;',
  '  if (!context) return JSON.stringify([{ api: null,',
  '    note: "this browser exposes neither document.modelContext nor navigator.modelContext" }]);',
  '  const out = [];',
  '  const list = async () => (await context.getTools()).map(tool => String(tool.name));',
  '  const call = async (name, args) => {',
  '    const tool = (await context.getTools()).find(candidate => candidate.name === name);',
  '    if (!tool) { out.push({ step: name, published: false }); return; }',
  '    try {',
  '      const raw = await context.executeTool(tool, JSON.stringify(args ?? {}));',
  '      let parsed = raw;',
  '      if (typeof raw === "string") {',
  '        // A registered tool answers with an MCP envelope. The tool the browser builds from the',
  '        // form answers with the text the page passed to respondWith, and nothing wraps it.',
  '        try { parsed = JSON.parse(raw); } catch { parsed = { content: [{ text: raw }] }; }',
  '      }',
  '      const text = parsed && parsed.content && parsed.content[0]',
  '        ? parsed.content[0].text : JSON.stringify(parsed);',
  '      out.push({ step: name, published: true,',
  '        answered: String(text).split("\\n")[0].slice(0, 200) });',
  '    } catch (error) {',
  '      out.push({ step: name, published: true,',
  '        threw: String((error && error.message) || error).slice(0, 200) });',
  '    }',
  '  };',
  '  out.push({ api: document.modelContext ? "document.modelContext" : "navigator.modelContext" });',
  '  out.push({ step: "tools at boot", tools: await list() });',
  '  await call("read_claim_state");',
  '  await call("apply_claim_patch",',
  '    { baseRevision: 0, changes: [{ field: "vehicle_drivable", value: false }] });',
  '  out.push({ step: "tools while the car cannot be driven", tools: await list() });',
  '  await call("get_assistance_options");',
  '  await call("apply_claim_patch",',
  '    { baseRevision: 0, changes: [{ field: "severity", value: "dent" }] });',
  '  await call("apply_claim_patch",',
  '    { baseRevision: 1, changes: [{ field: "vehicle_drivable", value: true }] });',
  '  out.push({ step: "tools once it can be driven again", tools: await list() });',
  '  const declared = (await context.getTools())',
  '    .find(tool => tool.name === "record_supporting_details");',
  '  out.push({',
  '    step: "the tool the browser built from the form",',
  '    name: declared ? String(declared.name) : null,',
  '    origin: declared ? String(declared.origin) : null,',
  '    description: declared ? String(declared.description).slice(0, 200) : null,',
  '    schema: declared ? String(JSON.stringify(declared.inputSchema)).slice(0, 400) : null',
  '  });',
  '  await call("record_supporting_details", { witness_name: "M. Okafor", base_revision: 2 });',
  '  await call("read_claim_state");',
  '  return JSON.stringify(out, null, 1);',
  '})()'
].join('\n');

try {
  const transcript = await evaluate(JOURNEY);
  console.log(transcript);
} catch (error) {
  console.error(String((error && error.message) || error));
  process.exit(1);
}
