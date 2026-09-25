#!/usr/bin/env node
// Builds dist/xslt-bridge.js (readable) and dist/xslt-bridge.min.js (minified) from src/.
// Both outputs are ASCII-only (non-ASCII characters are \u-escaped) so they can be embedded
// in pages or scripts of any character encoding, and both are checked to be valid ES5.
'use strict';
const fs = require('fs');
const path = require('path');
const acorn = require('acorn');
const { minify } = require('terser');

const root = path.join(__dirname, '..');
const parts = [
  '01-core.js', '02-dom.js', '03-xpath-parse.js', '04-xpath-eval.js',
  '05-numbers.js', '06-compile.js', '07-runtime.js', '08-output-api.js'
];

function checkEs5(code, name) {
  acorn.parse(code, { ecmaVersion: 5, sourceType: 'script' });
  if (/[^\x00-\x7f]/.test(code)) throw new Error(name + ' contains non-ASCII characters');
}

(async () => {
  const src = parts.map((f) => fs.readFileSync(path.join(root, 'src', f), 'utf8')).join('');
  acorn.parse(src, { ecmaVersion: 5, sourceType: 'script' });

  const keepBanner = { comments: /^!/, ascii_only: true };
  const readable = await minify(src, {
    ecma: 5, compress: false, mangle: false,
    format: Object.assign({ beautify: true, indent_level: 2 }, keepBanner)
  });
  const min = await minify(src, {
    ecma: 5, compress: { passes: 2 }, mangle: true,
    format: keepBanner
  });

  fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
  const out = [
    ['dist/xslt-bridge.js', readable.code + '\n'],
    ['dist/xslt-bridge.min.js', min.code + '\n']
  ];
  for (const [name, code] of out) {
    checkEs5(code, name);
    fs.writeFileSync(path.join(root, name), code);
    console.log(name.padEnd(28) + String(Buffer.byteLength(code)).padStart(8) + ' bytes');
  }
})().catch((e) => { console.error(e); process.exit(1); });
