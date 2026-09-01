/**
 * The smallest Chrome DevTools Protocol client this repository needs, and the only one it has.
 *
 * Two callers use it: evals/browser_probe.mjs, which drives the page and judges what happened, and
 * evidence/impact/run_impact.mjs, which lets a model drive the same page through the same tools. A
 * second copy of a WebSocket implementation would be two things to keep right, so there is one.
 *
 * No dependencies. Node 20 has no WebSocket client, so this speaks the frames itself: a masked text
 * frame out, continuation frames reassembled on the way back, commands answered by id and every
 * event kept in between. It is enough for Runtime.evaluate and for watching the console, and it is
 * not meant to be more.
 */
import http from 'node:http';
import net from 'node:net';
import crypto from 'node:crypto';


function getJson(port, path) {
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

export async function openSession(port) {
  const targets = await getJson(port, '/json');
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


/**
 * Evaluate one expression in the page and return its value. Opens a connection, asks, closes.
 *
 * @param {(string|number)} port the remote debugging port Chrome was started with
 * @param {string} expression
 * @returns {Promise<*>}
 */
export async function evaluateInPage(port, expression) {
  const { session, socket } = await openSession(port);
  try {
    return await session.evaluate(expression);
  } finally {
    socket.destroy();
  }
}

export { Session };
