/**
 * The handler packet is not on the tool surface, and this is the check rather than the claim.
 *
 * The page says filing is the claimant's, and the packet describes a filing. If a registered tool
 * could build one, or hand one back, or reach the module that makes them, then an agent could
 * produce the document that says a claim was filed, which is the same boundary the filing control
 * defends one step further along.
 *
 * So this reads the shipped source. Two assertions, both mechanical: nothing under src/webmcp
 * imports the packet module, and no registered tool descriptor mentions it.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEBMCP = path.join(HERE, '..', '..', 'src', 'webmcp');

function everyFileUnder(directory) {
  const found = [];
  for (const name of readdirSync(directory)) {
    const full = path.join(directory, name);
    if (statSync(full).isDirectory()) found.push(...everyFileUnder(full));
    else if (name.endsWith('.js')) found.push(full);
  }
  return found;
}

const files = everyFileUnder(WEBMCP);

test('the WebMCP layer has files to check, so an empty pass is not possible', () => {
  assert.ok(files.length >= 10, `expected the tool layer, found ${files.length} file(s)`);
});

test('nothing under src/webmcp imports the packet module', () => {
  const offenders = files
    .map((file) => ({ file, text: readFileSync(file, 'utf8') }))
    .filter((entry) => /from\s+['"][^'"]*core\/packet\.js['"]/.test(entry.text)
      || /import\(['"][^'"]*core\/packet\.js['"]\)/.test(entry.text))
    .map((entry) => path.relative(path.join(HERE, '..', '..'), entry.file));

  assert.deepEqual(offenders, [], 'a tool that can reach the packet module can hand one back');
});

test('no tool descriptor offers a packet, an export or a receipt', () => {
  const offenders = [];
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    // The descriptor is what a model reads. A name or a description that offers to export, file or
    // hand over a packet is an offer this page does not keep.
    for (const match of text.matchAll(/name:\s*'([a-z_]+)'/g)) {
      if (/packet|export|receipt|download/.test(match[1])) {
        offenders.push(`${path.basename(file)}: ${match[1]}`);
      }
    }
  }
  assert.deepEqual(offenders, []);
});

test('the page module is the only caller of buildFilingPacket', () => {
  const root = path.join(HERE, '..', '..');
  const callers = [];
  for (const directory of ['src/core', 'src/ui', 'src/webmcp']) {
    for (const file of everyFileUnder(path.join(root, directory))) {
      const text = readFileSync(file, 'utf8');
      if (/buildFilingPacket\s*\(/.test(text) && !file.endsWith(path.join('core', 'packet.js'))) {
        callers.push(path.relative(root, file).split(path.sep).join('/'));
      }
    }
  }
  assert.deepEqual(callers, ['src/ui/app.js']);
});
