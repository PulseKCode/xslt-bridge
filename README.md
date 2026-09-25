# xslt-bridge

A pure JavaScript, drop-in replacement for the browser's `XSLTProcessor` (XSLT 1.0 / XPath 1.0) for when browsers drop XSLT.
It runs in any modern browser and produces **the same output as Chrome's native `XSLTProcessor`**.
No WebAssembly, no dependencies, ES5 syntax, about 29 KB gzipped.

[한국어 README](README.ko.md)

## Why

Browsers are removing XSLT, both `XSLTProcessor` and `<?xml-stylesheet type="text/xsl"?>`:

- **Chrome** has a fixed schedule ([Chrome for Developers](https://developer.chrome.com/docs/web-platform/deprecating-xslt), [Chrome Platform Status](https://chromestatus.com/feature/4709671889534976)), shown below.
- **Edge** is built on Chromium and follows it. Edge 147 added the temporary `XSLTEnabled` policy for testing and transition ([Microsoft Learn](https://learn.microsoft.com/en-us/deployedge/microsoft-edge-policies/xsltenabled)).
- **Firefox** (Gecko) and **Safari** (WebKit) have also indicated plans to remove XSLT; no dates have been announced yet.

| Chrome | Date | What happens |
|---|---|---|
| 143 | December 2, 2025 | Deprecation warnings in the console |
| 146 | March 10, 2026 | Enterprise policy available (temporary opt-out) |
| 152 | August 25, 2026 | Origin trial available (temporary opt-out) |
| 158 | November 17, 2026 | XSLT stops working in stable, except for the opt-outs |
| 176 | August 17, 2027 | Opt-outs end; XSLT disabled for everyone |

Many line-of-business web applications call `XSLTProcessor` from JavaScript, for example to render grids and trees.
xslt-bridge lets such applications keep working in every browser after the removal by adding one script, without rewriting them.

This project was written by a maintainer who had to keep an existing service running through the removal. Moving to server-side transformation or JSON is the long-term path; xslt-bridge is for teams that need their current services to keep working without that rewrite.

## Browser support

- Works in any browser that has `DOMParser`, `XMLSerializer`, `document.implementation` and `Intl.Collator`: current Chrome, Edge, Firefox and Safari. The code is ES5 and uses no WebAssembly or `eval`.
- The output is Chrome's in every browser. Firefox and Safari have their own XSLT engines, whose results can differ in details such as whitespace, sort order or how an HTML result is parsed. While those browsers still ship XSLT, choose `fallback` mode to keep their native engine, or `compare` mode to see the differences first.
- The automated tests run under Node.js with jsdom. `selftest/index.html` checks the engine inside the browser you open it in; run it in each browser you target. Reports from Firefox and Safari are welcome.

## Quick start

Load the script before any code that uses `XSLTProcessor` (no `defer`/`async`):

```html
<script src="https://cdn.jsdelivr.net/npm/xslt-bridge@1/dist/xslt-bridge.min.js"></script>
```

or install it with `npm install xslt-bridge` and serve `dist/xslt-bridge.min.js`, or `import 'xslt-bridge'` in a bundled application.

Existing code keeps working unchanged:

```js
var processor = new XSLTProcessor();            // now an XsltBridge instance
processor.importStylesheet(xslDoc);
processor.setParameter(null, 'sortBy', 'name');
var fragment = processor.transformToFragment(xmlDoc, document);
```

`examples/without-engine.html` and `examples/with-engine.html` show the same page with and without the script.

## Modes

Set `window.XSLT_BRIDGE_MODE` before loading the script:

| Mode | Behavior |
|---|---|
| `replace` (default) | Always use this engine. The native constructor is not touched; it stays reachable as `window.XSLTProcessorNative`. |
| `fallback` | Use the browser's own `XSLTProcessor` while it exists, this engine afterwards. Useful for Firefox and Safari while they still ship XSLT. |
| `compare` | Render with the native processor, run this engine as well and report differences with `console.warn`. Useful to validate an application before switching. |
| `none` | Install nothing; use `new XsltBridge()` explicitly. |

## API

The standard `XSLTProcessor` methods: `importStylesheet`, `transformToFragment`, `transformToDocument`, `setParameter`, `getParameter`, `removeParameter`, `clearParameters`, `reset`.

Additions:

- `transformToString(source)` returns the serialized result, exactly as Chrome serializes it before parsing.
- `XsltBridge.loadDocument = function (url) { return xmlDocument; }` replaces the loader used by `xsl:include`, `xsl:import` and `document()`. The default loader uses a synchronous `XMLHttpRequest`.
- `XsltBridge.version`, and `XSLTProcessor.isXsltBridge === true` while the engine is installed.

As in Chrome, `transformToFragment` and `transformToDocument` return `null` when a transformation fails; the reason is logged with `console.error` (`[xslt-bridge] transformation failed: ...`).

## How closely it matches Chrome

Chrome's `XSLTProcessor` is libxslt and libxml2 plus a thin layer in Blink. Both parts are reproduced.

From libxslt 1.1.45 and libxml2 2.16.0, ported rule by rule: number-to-string conversion, `format-number`, `xsl:number`, template priorities and import precedence, `key()`, attribute-set merge order, namespace fix-up, whitespace stripping, the HTML/XML/text serializers (HTML element table, inline and empty elements, URI escaping, `<meta charset>`, DOCTYPE), and which errors abort a transformation and which only warn.

From Blink (checked against the Chromium sources), so the same results appear in every browser:

- `transformToFragment` into an HTML document implies the `html` output method, and the result is parsed in body context (so, for example, a `tbody` is inserted into tables);
- the XML declaration is always omitted and one trailing newline is removed;
- `xsl:sort` compares text with ICU collation (locale `en`, upper case first; `lang` and `case-order` are honored), implemented with `Intl.Collator`;
- `exsl:node-set` is the only extension function;
- text output returned by `transformToDocument` is wrapped in an XHTML document with a `<pre>` element;
- the stylesheet is re-read on every transformation, so later DOM changes to it take effect.

## Verification

`tools/oracle/blinkxslt.c` drives libxslt 1.1.45 and libxml2 2.16.0 (with ICU) the same way Chrome's `XSLTProcessor` does. Its results are stored in `test/cases/*/expected.json`.

The 132 test cases cover XSLT and XPath features, output methods, sorting, numbering, namespaces and error behavior. Each case is checked on two paths: the serialized result byte for byte, and the DOM produced by `transformToFragment(xml, document)`. All cases pass for both builds (`npm test`).

The libxml2/libxslt bundled in a particular Chrome version may differ slightly from the reference versions. `selftest/index.html` compares the engine with the browser's own `XSLTProcessor` while the browser still has one.

## Comparison with the WebAssembly polyfill

[xslt_polyfill](https://github.com/mfreed7/xslt_polyfill) from the Chrome team compiles libxslt to WebAssembly and is a good first choice for many sites.
Measured on 2026-09-22 with xslt-polyfill 1.0.29 on the same 132 cases (Node 22 + jsdom):

| | xslt-bridge | xslt-polyfill (WASM) |
|---|---|---|
| DOM identical to Chrome's pipeline | 132 / 132 | 113 / 132 (6 more with identical text) |
| `xsl:include` / `xsl:import` / `document()` with the synchronous API | works (synchronous XHR) | fails (resources are fetched asynchronously) |
| Synchronous call right after the script loads | works | throws until `xsltPolyfillReady()` resolves |
| `html` output method implied for HTML documents | yes | no |
| Size (gzip) | 29 KB | 520 KB, plus WebAssembly memory (32 MB initial, per the project's issue tracker) |
| Needs WebAssembly (`wasm-unsafe-eval` under CSP) | no, and no `eval` | yes |
| Engine core | new code | libxslt itself |

Prefer the polyfill if you want libxslt itself, the most battle-tested core maintained upstream, and your pages do not depend on the rows above.
xslt-bridge targets legacy applications that call `XSLTProcessor` synchronously, use `xsl:include`/`xsl:import`, run in many frames, or cannot load WebAssembly.

## Performance

`bench/bench.js` transforms a 3000 x 15 table with two sort keys and `format-number` on every cell: about 0.4 to 0.8 s per run in Node 22 + jsdom.
Native libxslt does the same transformation in about 0.1 s. Browser DOMs are much faster than jsdom, but very large tables will still be slower than the native engine was.

Recursion: about 1,800 levels of a recursive named template with the default V8 stack. libxslt itself stops at 3,000 nesting units, which is about 1,500 levels of the same template.

## Deploying into large legacy applications

When adding a script tag to every page or frame is impractical:

1. Prepend `dist/xslt-bridge.min.js` to the shared script that calls `XSLTProcessor`. Loading the engine more than once is harmless (it installs only once), and the dist files are ASCII-only, so concatenating them with scripts in any encoding is safe.
2. Serve a merged copy of that shared script from the web server (for example an Apache `Alias` plus a `ProxyPass` exclusion), leaving the application files untouched.
3. Inject the script tag into HTML responses at a reverse proxy (for example Apache `mod_substitute`).

In `replace` mode Chrome's "XSLT is deprecated" warning disappears wherever the engine is active. If the warning remains, its source location points at code that still reaches the native `XSLTProcessor`, typically a frame that does not load the script or a cached copy of the old file. `XSLTProcessor.isXsltBridge` in that frame's console tells you which one is in use.

## Limitations

- XSLT 1.0 only, as in browsers. Of EXSLT only `exsl:node-set`, as in Chrome.
- `xsl:include`, `xsl:import` and `document()` use synchronous `XMLHttpRequest`, which makes Chrome log its generic notice about synchronous XHR.
- A DOM is required (`DOMParser`, `XMLSerializer`, `document.implementation`). In Node.js, evaluate the script inside a jsdom window as the tests do; `require()` alone only returns the class.
- Reference versions are libxml2 2.16.0 and libxslt 1.1.45. Older Chrome builds may place some HTML whitespace differently.

## Development

```
npm install
npm run build       # dist/xslt-bridge.js (readable) and dist/xslt-bridge.min.js
npm test            # 132 cases x 2 paths and the API tests, for both builds
npm run selftest    # regenerates selftest/index.html
npm run bench
```

- `src/`: the engine in eight parts, concatenated in order by `scripts/build.js`. Code comments are in Korean; messages and documentation are in English.
- `test/cases/<case>/`: `in.xml`, `t.xsl`, optional `params.txt` and extra files, and `expected.json`.
- `tools/oracle/`: the reference transformer and the script that regenerates `expected.json` (see its README).

## License

[MIT](LICENSE). Portions are derived from libxml2 and libxslt (MIT-style licenses); see [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
