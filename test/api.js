#!/usr/bin/env node
// API and installation tests (jsdom has no native XSLTProcessor, so a fake one is used where needed).
// Usage: node test/api.js [--file dist/xslt-bridge.min.js]
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const fileArg = process.argv.indexOf('--file');
const file = fileArg >= 0 ? path.resolve(process.argv[fileArg + 1]) : path.join(__dirname, '..', 'dist', 'xslt-bridge.js');
const code = fs.readFileSync(file, 'utf8');
let failed = 0;
const ok = (cond, label) => { if (!cond) failed++; console.log((cond ? 'ok   ' : 'FAIL ') + label); };

const FAKE_NATIVE = `
  window.__nativeReads = 0; window.__nativeNews = 0;
  function FakeNative() { window.__nativeNews++; }
  ['importStylesheet','setParameter','removeParameter','clearParameters','reset'].forEach(function (m) { FakeNative.prototype[m] = function () {}; });
  FakeNative.prototype.getParameter = function () { return null; };
  FakeNative.prototype.transformToDocument = function () { return null; };
  FakeNative.prototype.transformToFragment = function (s, d) { var f = d.createDocumentFragment(); f.appendChild(d.createTextNode('NATIVE')); return f; };
  Object.defineProperty(window, 'XSLTProcessor', { configurable: true, enumerable: false,
    get: function () { window.__nativeReads++; return FakeNative; },
    set: function (v) { Object.defineProperty(window, 'XSLTProcessor', { value: v, writable: true, configurable: true }); } });`;

function makeWindow(mode, withNative) {
  const w = new JSDOM('<!DOCTYPE html><html><body></body></html>', { url: 'http://test.local/a/b.html', runScripts: 'outside-only' }).window;
  if (withNative) w.eval(FAKE_NATIVE);
  if (mode) w.XSLT_BRIDGE_MODE = mode;
  w.eval(code);
  return w;
}
const parse = (w, s) => new w.DOMParser().parseFromString(s, 'application/xml');
const XSL = '<xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform"><xsl:param name="p" select="\'d\'"/>' +
            '<xsl:template match="/"><b><xsl:value-of select="$p"/>:<xsl:value-of select="count(//i)"/></b></xsl:template></xsl:stylesheet>';

// installation modes
let w = makeWindow(null, true);
ok(w.XSLTProcessor.isXsltBridge && w.__nativeReads === 0 && w.__nativeNews === 0,
  'replace (default): installs without touching the native XSLTProcessor (no deprecation warning)');
ok(typeof w.XSLTProcessorNative === 'function' && w.__nativeReads === 1, 'replace: native constructor reachable lazily as XSLTProcessorNative');
w = makeWindow('fallback', true);
ok(!w.XSLTProcessor.isXsltBridge, 'fallback: keeps a working native XSLTProcessor');
w = makeWindow('fallback', false);
ok(w.XSLTProcessor === w.XsltBridge, 'fallback: installs when there is no native XSLTProcessor');
w = makeWindow('none', true);
ok(w.__nativeReads === 0 && !w.XSLTProcessor.isXsltBridge && typeof w.XsltBridge === 'function', 'none: exposes XsltBridge only');
w = makeWindow('compare', true);
const warnings = []; w.console.warn = (m) => warnings.push(m);
let p = new w.XSLTProcessor(); p.importStylesheet(parse(w, XSL));
const f = p.transformToFragment(parse(w, '<r><i/><i/></r>'), w.document);
ok(f.textContent === 'NATIVE' && warnings.length === 1 && /differs/.test(warnings[0]), 'compare: returns the native result and reports differences');
w = makeWindow(null, false);
const first = w.XSLTProcessor; w.eval(code); w.eval(code);
ok(w.XSLTProcessor === first, 'loading the script several times installs it only once');

// API
w = makeWindow(null, false);
p = new w.XSLTProcessor();
ok(p.transformToFragment(parse(w, '<r/>'), w.document) === null, 'transform without a stylesheet returns null');
let threw = false; try { p.importStylesheet('x'); } catch (e) { threw = e.name === 'TypeError'; } ok(threw, 'importStylesheet(non-node) throws TypeError');
threw = false; try { w.XSLTProcessor(); } catch (e) { threw = true; } ok(threw, 'calling without new throws');
const xsl = parse(w, XSL), xml = parse(w, '<r><i/><i/></r>');
p.importStylesheet(xsl);
let frag = p.transformToFragment(xml, w.document);
ok(frag && frag.firstChild.nodeName === 'B' && frag.textContent === 'd:2' && frag.childNodes.length === 1,
  'transformToFragment into an HTML document yields HTML elements (html output method is implied)');
p.setParameter(null, 'p', 'X');
ok(p.getParameter(null, 'p') === 'X' && p.transformToFragment(xml, w.document).textContent === 'X:2', 'setParameter / getParameter');
p.removeParameter(null, 'p'); ok(p.getParameter(null, 'p') === null, 'removeParameter');
p.setParameter('', 'p', 'Y'); p.clearParameters(); ok(p.getParameter('', 'p') === null, 'clearParameters');
xsl.getElementsByTagNameNS('http://www.w3.org/1999/XSL/Transform', 'param')[0].setAttribute('select', "'changed'");
ok(p.transformToFragment(xml, w.document).textContent === 'changed:2', 'stylesheet DOM changes are picked up by the next transform');
const doc = p.transformToDocument(xml);
ok(doc && doc.documentElement.nodeName === 'b' && doc.documentElement.textContent === 'changed:2', 'transformToDocument returns an XML document');
const xmlOut = new w.XMLSerializer().serializeToString(p.transformToFragment(xml, parse(w, '<x/>')));
ok(xmlOut === '<b>changed:2</b>', 'transformToFragment into an XML document yields an XML fragment');
ok(p.transformToString(xml) === '<b>changed:2</b>', 'transformToString returns the serialized result');
const tp = new w.XSLTProcessor();
tp.importStylesheet(parse(w, '<xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform"><xsl:output method="text"/><xsl:template match="/">a &lt; b</xsl:template></xsl:stylesheet>'));
const td = tp.transformToDocument(xml);
ok(td && td.documentElement.namespaceURI === 'http://www.w3.org/1999/xhtml' && td.getElementsByTagName('pre')[0].textContent === 'a < b',
  'text output via transformToDocument yields an XHTML document with <pre> (like Chrome)');
const errors = []; w.console.error = (m) => errors.push(m);
const bad = new w.XSLTProcessor();
bad.importStylesheet(parse(w, '<xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform"><xsl:template match="/"><xsl:value-of select="1 +"/></xsl:template></xsl:stylesheet>'));
ok(bad.transformToFragment(xml, w.document) === null && errors.length === 1 && /XPath error/.test(errors[0]), 'invalid XPath: returns null and logs an English error');
p.reset(); ok(p.transformToFragment(xml, w.document) === null, 'reset() clears the stylesheet');
ok(w.XsltBridge.version === '1.0.0', 'version is exposed');

console.log('\n' + path.relative(process.cwd(), file) + ': ' + (failed ? failed + ' failed' : 'all API tests passed'));
process.exit(failed ? 1 : 0);
