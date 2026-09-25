#!/usr/bin/env node
// Builds selftest/index.html from selftest/template.html and test/cases (inputs + expected results).
'use strict';
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const casesDir = path.join(root, 'test', 'cases');
const skip = new Set(['in.xml', 't.xsl', 'params.txt', 'expected.json']);
const cases = fs.readdirSync(casesDir).sort().map((name) => {
  const dir = path.join(casesDir, name);
  const read = (f) => fs.readFileSync(path.join(dir, f), 'utf8');
  const params = fs.existsSync(path.join(dir, 'params.txt'))
    ? read('params.txt').split('\n').filter(Boolean).map((l) => l.split('\t')) : [];
  const extras = {};
  for (const f of fs.readdirSync(dir)) if (!skip.has(f)) extras[f] = read(f);
  return { name, xml: read('in.xml'), xsl: read('t.xsl'), params, extras, expected: JSON.parse(read('expected.json')) };
});
const json = JSON.stringify(cases).replace(/<\//g, '<\\/');
const html = fs.readFileSync(path.join(root, 'selftest', 'template.html'), 'utf8').replace('/*CASES*/[]', json);
fs.writeFileSync(path.join(root, 'selftest', 'index.html'), html);
console.log('selftest/index.html written with ' + cases.length + ' cases');
