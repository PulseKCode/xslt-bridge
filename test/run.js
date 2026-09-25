#!/usr/bin/env node
// Regression test: runs every case in test/cases through the built engine (inside jsdom) and
// compares the results with expected.json, which was produced by the reference transformer
// (tools/oracle/blinkxslt: libxslt/libxml2 driven exactly like Chrome's XSLTProcessor).
//
//   document path : the serialized result of transformToDocument(), byte for byte
//   fragment path : the serialized result of transformToFragment(xml, htmlDocument), byte for
//                   byte, plus the DOM built from it (HTML results are parsed in body context)
//
// Usage: node test/run.js [--file dist/xslt-bridge.min.js] [--verbose] [case-name]
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const args = process.argv.slice(2);
const fileArg = args.indexOf('--file');
const file = fileArg >= 0 ? path.resolve(args[fileArg + 1]) : path.join(__dirname, '..', 'dist', 'xslt-bridge.js');
const verbose = args.includes('--verbose');
const only = args.filter((a, i) => !a.startsWith('--') && (fileArg < 0 || i !== fileArg + 1))[0];
const code = fs.readFileSync(file, 'utf8');
const casesDir = path.join(__dirname, 'cases');

function readParams(dir) {
  const f = path.join(dir, 'params.txt');
  if (!fs.existsSync(f)) return [];
  return fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => l.split('\t'));
}

function setup(dir, params) {
  const window = new JSDOM('<!DOCTYPE html><html><head></head><body></body></html>',
    { url: 'http://test.local/case/page.html', runScripts: 'outside-only' }).window;
  window.XSLT_BRIDGE_MODE = 'none';
  window.eval(code);
  const quiet = () => {};
  window.console.warn = quiet; window.console.error = quiet; window.console.log = quiet;
  const parse = (text) => new window.DOMParser().parseFromString(text, 'application/xml');
  window.XsltBridge.loadDocument = (url) =>
    parse(fs.readFileSync(path.join(dir, path.basename(new URL(url).pathname)), 'utf8'));
  const p = new window.XsltBridge();
  p.importStylesheet(parse(fs.readFileSync(path.join(dir, 't.xsl'), 'utf8')));
  for (const [k, v] of params) p.setParameter(null, k, v);
  const source = () => parse(fs.readFileSync(path.join(dir, 'in.xml'), 'utf8'));
  return { window, p, source };
}

function transform(dir, params, forceHtml) {
  const { p, source } = setup(dir, params);
  try {
    const r = p._transform(source(), forceHtml);
    return { ok: true, mime: r.mime, output: r.text };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function same(exp, act) {
  if (!exp.ok) return !act.ok;
  return act.ok && act.mime === exp.mime && act.output === exp.output;
}

function diff(exp, act) {
  if (!exp.ok) return '    expected a failure, got a result';
  if (!act.ok) return '    expected a result, got an error: ' + act.error;
  if (act.mime !== exp.mime) return '    MIME type: expected ' + exp.mime + ', got ' + act.mime;
  const a = exp.output, b = act.output;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  const ctx = (s) => JSON.stringify(s.substring(Math.max(0, i - 60), i + 60));
  return '    first difference at offset ' + i + '\n    expected: ' + ctx(a) + '\n    actual  : ' + ctx(b);
}

function domCheck(dir, params, exp) {
  if (!exp.ok || exp.mime !== 'text/html') return null;
  const { window, p, source } = setup(dir, params);
  const frag = p.transformToFragment(source(), window.document);
  const expected = window.document.createElement('body');
  expected.innerHTML = exp.output;
  const actual = window.document.createElement('body');
  if (frag) actual.appendChild(frag);
  return actual.innerHTML === expected.innerHTML ? null
    : '    DOM differs\n    expected: ' + JSON.stringify(expected.innerHTML.slice(0, 160)) +
      '\n    actual  : ' + JSON.stringify(actual.innerHTML.slice(0, 160));
}

const names = fs.readdirSync(casesDir).filter((n) => !only || n === only).sort();
let failures = 0;
for (const name of names) {
  const dir = path.join(casesDir, name);
  const expected = JSON.parse(fs.readFileSync(path.join(dir, 'expected.json'), 'utf8'));
  const params = readParams(dir);
  const problems = [];
  const doc = transform(dir, params, false);
  if (!same(expected.document, doc)) problems.push('  document path\n' + diff(expected.document, doc));
  const frag = transform(dir, params, true);
  if (!same(expected.fragment, frag)) problems.push('  fragment path\n' + diff(expected.fragment, frag));
  else {
    const d = domCheck(dir, params, expected.fragment);
    if (d) problems.push('  fragment DOM\n' + d);
  }
  if (problems.length) { failures++; console.log('FAIL ' + name + '\n' + problems.join('\n')); }
  else if (verbose) console.log('ok   ' + name);
}
console.log('\n' + path.relative(process.cwd(), file) + ': ' + (names.length - failures) + ' passed, ' +
  failures + ' failed (' + names.length + ' cases x 2 paths)');
process.exit(failures ? 1 : 0);
