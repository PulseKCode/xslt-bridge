#!/usr/bin/env node
// Simple benchmark: a 3000 x 15 table with two sort keys and format-number, run inside jsdom.
// jsdom's DOM is much slower than a browser's, so treat the numbers as an upper bound.
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const fileArg = process.argv.indexOf('--file');
const file = fileArg >= 0 ? path.resolve(process.argv[fileArg + 1]) : path.join(__dirname, '..', 'dist', 'xslt-bridge.js');
const w = new JSDOM('<!DOCTYPE html><html><body></body></html>', { runScripts: 'outside-only' }).window;
w.XSLT_BRIDGE_MODE = 'none';
w.eval(fs.readFileSync(file, 'utf8'));

let seed = 7;
const rand = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const rows = [];
for (let i = 0; i < 3000; i++) {
  let cells = '';
  for (let j = 0; j < 15; j++) {
    cells += '<c>' + (j === 0 ? 'Item-' + String(Math.floor(rand() * 100000)).padStart(5, '0') + ' &amp; X'
                               : (rand() * 100000).toFixed(3)) + '</c>';
  }
  rows.push('<r id="0,' + i + '" o="1.2.' + i + '" level="' + (i % 3) + '">' + cells + '</r>');
}
const xml = '<grid><rows>' + rows.join('') + '</rows></grid>';
const xsl = `<xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform">
<xsl:output method="html"/>
<xsl:key name="byLevel" match="r" use="@level"/>
<xsl:template match="/grid"><table><xsl:for-each select="rows/r"><xsl:sort select="c[2]" data-type="number" order="descending"/><xsl:sort select="c[1]"/>
<tr id="{@id}" class="lv{@level}"><xsl:for-each select="c"><td><xsl:choose><xsl:when test="position()=1"><a href="javascript:go('{../@o}')"><xsl:value-of select="."/></a></xsl:when><xsl:otherwise><xsl:value-of select="format-number(., '#,##0.00')"/></xsl:otherwise></xsl:choose></td></xsl:for-each></tr></xsl:for-each>
<tr><td><xsl:value-of select="count(key('byLevel','1'))"/></td></tr></table></xsl:template>
</xsl:stylesheet>`;

const parse = (s) => new w.DOMParser().parseFromString(s, 'application/xml');
const p = new w.XsltBridge();
p.importStylesheet(parse(xsl));
const source = parse(xml);
const times = [];
let out = '';
for (let i = 0; i < 5; i++) {
  const t0 = process.hrtime.bigint();
  out = p.transformToString(source);
  times.push(Number(process.hrtime.bigint() - t0) / 1e6);
}
console.log('input ' + (xml.length / 1024).toFixed(0) + ' KB, output ' + (out.length / 1024).toFixed(0) + ' KB');
console.log('transformToString (ms): ' + times.map((t) => t.toFixed(0)).join(', '));
