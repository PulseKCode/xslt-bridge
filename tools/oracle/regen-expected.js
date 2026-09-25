#!/usr/bin/env node
// Regenerates test/cases/<case>/expected.json with the reference transformer (blinkxslt).
// Usage: node tools/oracle/regen-expected.js [path/to/blinkxslt] [case-name]
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const oracle = process.argv[2] || process.env.BLINKXSLT || path.join(__dirname, 'blinkxslt');
const only = process.argv[3];
const casesDir = path.join(__dirname, '..', '..', 'test', 'cases');

function readParams(dir) {
  const f = path.join(dir, 'params.txt');
  if (!fs.existsSync(f)) return [];
  return fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => l.split('\t'));
}

function run(dir, params, html) {
  const args = html ? ['--html'] : [];
  for (const [k, v] of params) args.push('--param', k, v);
  args.push('t.xsl', 'in.xml');
  const r = spawnSync(oracle, args, { cwd: dir, encoding: 'buffer' });
  if (r.error) throw r.error;
  if (r.status !== 0) return { ok: false };
  const m = /MIME:(\S+)\s*$/.exec(r.stderr.toString('utf8'));
  return { ok: true, mime: m ? m[1] : null, output: r.stdout.toString('utf8') };
}

let n = 0;
for (const name of fs.readdirSync(casesDir).sort()) {
  if (only && name !== only) continue;
  const dir = path.join(casesDir, name);
  if (!fs.statSync(dir).isDirectory()) continue;
  const params = readParams(dir);
  const expected = { document: run(dir, params, false), fragment: run(dir, params, true) };
  fs.writeFileSync(path.join(dir, 'expected.json'), JSON.stringify(expected, null, 2) + '\n');
  n++;
}
console.log(`expected.json written for ${n} case(s)`);
