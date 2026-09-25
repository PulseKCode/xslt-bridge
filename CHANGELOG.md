# Changelog

## 1.0.0 - 2026-09-23

First public release.

- Drop-in replacement for `XSLTProcessor`: `importStylesheet`, `transformToFragment`, `transformToDocument`, `setParameter`, `getParameter`, `removeParameter`, `clearParameters`, `reset`, plus `transformToString` and a pluggable document loader.
- XSLT 1.0 and XPath 1.0, with libxslt 1.1.45 / libxml2 2.16.0 behavior: number formatting, `format-number`, `xsl:number`, keys, imports and includes, attribute sets, whitespace stripping, HTML/XML/text output, error semantics.
- Chrome (Blink) behavior: `html` output method implied for HTML documents, XML declaration omitted, trailing newline removed, ICU collation for `xsl:sort`, only `exsl:node-set`, XHTML `<pre>` document for text output.
- Installation modes `replace`, `fallback`, `compare`, `none`. The native `XSLTProcessor` is never touched in `replace` mode, so Chrome's deprecation warning does not appear. Safe to load more than once.
- ASCII-only ES5 builds (`dist/xslt-bridge.js`, `dist/xslt-bridge.min.js`).
- 132 regression cases checked against a reference transformer that drives libxslt like Chrome does; browser self-test page; examples; benchmark.
