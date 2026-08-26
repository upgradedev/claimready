#!/usr/bin/env node
/**
 * ClaimReady style gate. Zero dependencies, Node 20, no network.
 *
 * Rules enforced, each one a hard failure:
 *   1. No em dash code points in any tracked text file. Counted by code point,
 *      not by a shell grep, so it survives encodings that hide the character.
 *   2. No annotation names that do not exist in WebMCP. The API defines exactly
 *      two, readOnlyHint and untrustedContentHint. Anything else is a copy paste
 *      from another MCP dialect and is rejected here.
 *   3. No mention of other competitions or sibling projects. This entry is
 *      judged on its own and must read that way.
 *   4. Tool budgets from the Chrome WebMCP tool security guide: tool name at most
 *      30 characters, tool description at most 500, parameter description at most 150.
 *
 * Usage:
 *   node scripts/check_style.mjs            scan the repo this script lives in
 *   node scripts/check_style.mjs --root DIR scan another directory (used by the
 *                                           readiness self test to prove the gate fails)
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, extname, basename } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SCRIPT_DIR = fileURLToPath(new URL('.', import.meta.url));
const DEFAULT_ROOT = join(SCRIPT_DIR, '..');

/* ------------------------------------------------------------------ rules */

// Em dash and its relatives, by code point. U+2014 em dash, U+2E3A two em dash,
// U+2E3B three em dash, U+2015 horizontal bar.
const DASH_CODE_POINTS = new Map([
  [0x2014, 'em dash U+2014'],
  [0x2e3a, 'two em dash U+2E3A'],
  [0x2e3b, 'three em dash U+2E3B'],
  [0x2015, 'horizontal bar U+2015'],
]);

// Assembled from fragments on purpose. If the joined word appeared as a literal
// in this file, the gate would report itself on every run.
const FORBIDDEN_ANNOTATION = ['destructive', 'Hint'].join('');

const FORBIDDEN_NAMES = [
  ['back', 'blaze'],
  ['cock', 'roach'],
  ['qw', 'en'],
  ['neb', 'ius'],
  ['kag', 'gle'],
  ['xpri', 'ze'],
  ['claim', 'scene'],
  ['cine', 'mory'],
  ['ker', 'don'],
  ['front', 'box'],
  ['share', 'loc'],
].map((parts) => parts.join(''));

const MAX_TOOL_NAME = 30;
const MAX_TOOL_DESCRIPTION = 500;
const MAX_PARAM_DESCRIPTION = 150;

const TEXT_EXTENSIONS = new Set([
  '.md', '.html', '.htm', '.js', '.mjs', '.cjs', '.css', '.json',
  '.yml', '.yaml', '.txt', '.svg', '.webmanifest',
]);

// Text files that carry no extension but still reach a reader.
const TEXT_FILENAMES = new Set(['LICENSE', 'NOTICE', 'CODEOWNERS']);

const SKIP_DIRECTORIES = new Set(['.git', 'node_modules', '.vercel', '.netlify', 'coverage', 'tmp']);

// Files that are allowed to name the forbidden strings, because naming them is
// their job. Kept to this gate alone.
const NAME_RULE_EXEMPT = new Set(['check_style.mjs']);

/* ------------------------------------------------------------- file lookup */

function walk(dir, root, out) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (SKIP_DIRECTORIES.has(entry)) continue;
    const full = join(dir, entry);
    let stats;
    try {
      stats = statSync(full);
    } catch {
      continue;
    }
    if (stats.isDirectory()) walk(full, root, out);
    else out.push(full);
  }
  return out;
}

export function collectFiles(root) {
  const git = spawnSync('git', ['-C', root, 'ls-files', '-z'], { encoding: 'utf8' });
  let files;
  if (git.status === 0 && typeof git.stdout === 'string' && git.stdout.length > 0) {
    files = git.stdout.split('\0').filter(Boolean).map((p) => join(root, p));
  } else {
    files = walk(root, root, []);
  }
  return files.filter(
    (f) => TEXT_EXTENSIONS.has(extname(f).toLowerCase()) || TEXT_FILENAMES.has(basename(f)),
  );
}

/* --------------------------------------------------------- literal scanner */

function unescapeLiteral(raw) {
  return raw.replace(/\\n/g, '\n').replace(/\\(.)/g, '$1');
}

/**
 * Pull `key: "value"` pairs out of source text without parsing JavaScript.
 * Returns { key, value, index } for every name and description literal found.
 *
 * Descriptions are written across several concatenated string literals so they stay readable
 * in the source, so a run of `+ '...'` after the first literal is part of the same value and is
 * added to it. Measuring only the first fragment would let a description four times over budget
 * walk straight through this gate.
 */
export function extractLiterals(source) {
  const found = [];
  const re = /(?:^|[\s{,(\[])(name|description)\s*:\s*(['"`])((?:\\.|(?!\2)[\s\S])*)\2/g;
  const continuation = /\s*\+\s*(['"`])((?:\\.|(?!\1)[\s\S])*)\1/y;
  let match;
  while ((match = re.exec(source)) !== null) {
    let value = unescapeLiteral(match[3]);
    let cursor = re.lastIndex;
    for (;;) {
      continuation.lastIndex = cursor;
      const more = continuation.exec(source);
      if (!more) break;
      value += unescapeLiteral(more[2]);
      cursor = continuation.lastIndex;
    }
    re.lastIndex = cursor;
    found.push({ key: match[1], value, index: match.index });
  }
  return found;
}

function lineOf(source, index) {
  let line = 1;
  for (let i = 0; i < index && i < source.length; i += 1) {
    if (source[i] === '\n') line += 1;
  }
  return line;
}

/* ------------------------------------------------------------------- scan */

export function scanFile(path, root) {
  const rel = relative(root, path).split('\\').join('/');
  const findings = [];
  let source;
  try {
    source = readFileSync(path, 'utf8');
  } catch {
    return findings;
  }

  // Rule 1: em dashes, by code point.
  const lines = source.split(/\r?\n/);
  lines.forEach((line, i) => {
    for (const ch of line) {
      const cp = ch.codePointAt(0);
      if (DASH_CODE_POINTS.has(cp)) {
        findings.push({
          file: rel,
          line: i + 1,
          rule: 'no-em-dash',
          message: `found ${DASH_CODE_POINTS.get(cp)}. Use a comma, a full stop or parentheses.`,
        });
        break;
      }
    }
  });

  // Rule 2: annotation names that WebMCP does not define.
  const lowered = source.toLowerCase();
  if (!NAME_RULE_EXEMPT.has(basename(path))) {
    const needle = FORBIDDEN_ANNOTATION.toLowerCase();
    let at = lowered.indexOf(needle);
    while (at !== -1) {
      findings.push({
        file: rel,
        line: lineOf(source, at),
        rule: 'annotation-does-not-exist',
        message: 'WebMCP defines readOnlyHint and untrustedContentHint only. Remove this annotation.',
      });
      at = lowered.indexOf(needle, at + needle.length);
    }

    // Rule 3: other competitions and sibling projects.
    for (const name of FORBIDDEN_NAMES) {
      let hit = lowered.indexOf(name);
      while (hit !== -1) {
        findings.push({
          file: rel,
          line: lineOf(source, hit),
          rule: 'foreign-project-name',
          message: `the name "${name}" belongs to another project and must not appear in this entry.`,
        });
        hit = lowered.indexOf(name, hit + name.length);
      }
    }
  }

  // Rule 4: tool budgets. Applied to files that actually define tools, which means
  // a module in a tools directory under src, or any page that calls registerTool. The
  // scripts in this directory talk ABOUT tools and their own strings are not tool
  // metadata, so they are out of scope for the budget rule and stay in scope for every
  // other rule.
  // The whole WebMCP layer is in scope by PATH, not by whether a file happens to contain the
  // literal registerTool. Coverage that depends on a substring silently disappears the day a
  // file is refactored, which is exactly what happened when the page stopped holding its own
  // tool list: app.js dropped out of this rule without anything reporting it.
  const isToolFile = /^src\/(?:[^/]+\/)*tools\/[^/]+\.js$/.test(rel);
  const isToolLayer = rel.startsWith('src/webmcp/');
  const describesTools =
    !rel.startsWith('scripts/') && (isToolFile || isToolLayer || source.includes('registerTool'));

  if (describesTools) {
    // Parameter descriptions live between inputSchema and the next top level key.
    let paramStart = -1;
    let paramEnd = -1;
    if (isToolFile) {
      paramStart = source.indexOf('inputSchema');
      if (paramStart !== -1) {
        const ends = ['annotations', 'execute']
          .map((k) => source.indexOf(k, paramStart))
          .filter((i) => i !== -1);
        paramEnd = ends.length ? Math.min(...ends) : source.length;
      }
    }

    for (const literal of extractLiterals(source)) {
      const inParams =
        paramStart !== -1 && literal.index > paramStart && literal.index < paramEnd;

      if (literal.key === 'name' && literal.value.length > MAX_TOOL_NAME) {
        findings.push({
          file: rel,
          line: lineOf(source, literal.index),
          rule: 'tool-name-too-long',
          message: `tool name is ${literal.value.length} characters, the budget is ${MAX_TOOL_NAME}.`,
        });
      }

      if (literal.key === 'description') {
        const limit = inParams ? MAX_PARAM_DESCRIPTION : MAX_TOOL_DESCRIPTION;
        const label = inParams ? 'parameter description' : 'tool description';
        if (literal.value.length > limit) {
          findings.push({
            file: rel,
            line: lineOf(source, literal.index),
            rule: inParams ? 'param-description-too-long' : 'tool-description-too-long',
            message: `${label} is ${literal.value.length} characters, the budget is ${limit}.`,
          });
        }
      }
    }
  }

  return findings;
}

export function checkStyle(root) {
  const files = collectFiles(root);
  const findings = [];
  for (const file of files) findings.push(...scanFile(file, root));
  return { files, findings };
}

/* ------------------------------------------------------------------- main */

function main() {
  const argv = process.argv.slice(2);
  const rootIndex = argv.indexOf('--root');
  const root = rootIndex === -1 ? DEFAULT_ROOT : argv[rootIndex + 1];
  const quiet = argv.includes('--quiet');

  const { files, findings } = checkStyle(root);

  if (findings.length === 0) {
    if (!quiet) {
      console.log(`style: PASS. ${files.length} text files scanned under ${root}.`);
      console.log('rules: no em dash, annotations that exist, no foreign project names, tool budgets.');
    }
    process.exit(0);
  }

  console.error(`style: FAIL. ${findings.length} finding(s) in ${files.length} scanned files.\n`);
  for (const f of findings) {
    console.error(`  ${f.file}:${f.line}  [${f.rule}]  ${f.message}`);
  }
  console.error('\nNothing here is negotiable. Fix the text, do not widen the rule.');
  process.exit(1);
}

const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) main();
