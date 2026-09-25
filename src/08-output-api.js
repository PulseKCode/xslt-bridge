
  // ---------------------------------------------------------------------------
  // 직렬화 : libxml2 xmlsave.c / HTMLtree.c 규칙 이식
  // ---------------------------------------------------------------------------
  var HTML_KNOWN = {}, HTML_EMPTY = {}, HTML_INLINE = {}, HTML_RAW = {};
  (function () {
    var i, list;
    list = ('a abbr acronym address applet area b base basefont bdo bgsound big blockquote body br button caption ' +
      'center cite code col colgroup dd del dfn dir div dl dt em embed fieldset font form frame frameset h1 h2 h3 ' +
      'h4 h5 h6 head hr html i iframe img input ins isindex kbd keygen label legend li link map menu meta noembed ' +
      'noframes noscript object ol optgroup option p param plaintext pre q s samp script select small source span ' +
      'strike strong style sub sup table tbody td textarea tfoot th thead title tr track tt u ul var wbr xmp').split(' ');
    for (i = 0; i < list.length; i++) HTML_KNOWN[list[i]] = true;
    list = 'area base basefont bgsound br col embed frame hr img input isindex keygen link meta param source track wbr'.split(' ');
    for (i = 0; i < list.length; i++) HTML_EMPTY[list[i]] = true;
    // libxml2 html40ElementTable 의 isinline != 0 (2 = block/inline 겸용도 포맷 시 inline 으로 취급)
    list = ('a abbr acronym applet b basefont bdo big br button cite code del dfn em embed font i iframe img input ' +
      'ins kbd label map object q s samp script select small span strike strong sub sup textarea tt u var xmp').split(' ');
    for (i = 0; i < list.length; i++) HTML_INLINE[list[i]] = true;
    list = 'iframe noembed noframes plaintext script style xmp'.split(' ');
    for (i = 0; i < list.length; i++) HTML_RAW[list[i]] = true;
  })();
  var HTML_BOOLEAN_ATTRS = { checked: 1, compact: 1, declare: 1, defer: 1, disabled: 1, ismap: 1, multiple: 1,
    nohref: 1, noresize: 1, noshade: 1, nowrap: 1, readonly: 1, selected: 1 };

  function htmlInfo(e) {
    if (e.ns) return null;
    var n = e.local.toLowerCase();
    if (!HTML_KNOWN[n]) return null;
    return { empty: !!HTML_EMPTY[n], inline: !!HTML_INLINE[n], raw: !!HTML_RAW[n] };
  }

  function escXmlText(s) {
    return s.replace(/[&<>\r\x00-\x08\x0B\x0C\x0E-\x1F\uFFFE\uFFFF]/g, function (c) {
      switch (c) {
        case '&': return '&amp;';
        case '<': return '&lt;';
        case '>': return '&gt;';
        case '\r': return '&#13;';
        default: return '&#xFFFD;';
      }
    });
  }

  function escXmlAttr(s) {
    return s.replace(/[&<>"\t\n\r\x00-\x08\x0B\x0C\x0E-\x1F\uFFFE\uFFFF]/g, function (c) {
      switch (c) {
        case '&': return '&amp;';
        case '<': return '&lt;';
        case '>': return '&gt;';
        case '"': return '&quot;';
        case '\t': return '&#9;';
        case '\n': return '&#10;';
        case '\r': return '&#13;';
        default: return '&#xFFFD;';
      }
    });
  }

  function escHtmlText(s) {
    return s.replace(/[&<>]/g, function (c) { return c === '&' ? '&amp;' : (c === '<' ? '&lt;' : '&gt;'); });
  }

  function escHtmlAttr(s) {
    return s.replace(/[&<>"]/g, function (c) {
      return c === '&' ? '&amp;' : (c === '<' ? '&lt;' : (c === '>' ? '&gt;' : '&quot;'));
    });
  }

  // href/src/action/name 속성: htmlSerializeUri (앞쪽 공백 유지, 0x21-0x7E 외 문자는 %XX)
  function htmlSerializeUri(s) {
    var out = '', i = 0, n = s.length;
    while (i < n && /[ \t\n\f\r]/.test(s.charAt(i))) { out += s.charAt(i); i++; }
    for (; i < n; i++) {
      var c = s.charCodeAt(i);
      if (c === 0x22) out += '&quot;';
      else if (c === 0x26) out += '&amp;';
      else if (c >= 0x21 && c <= 0x7E) out += s.charAt(i);
      else {
        var ch = s.charAt(i);
        if (c >= 0xD800 && c <= 0xDBFF && i + 1 < n) { ch += s.charAt(i + 1); i++; }
        var bytes = utf8Bytes(ch);
        for (var b = 0; b < bytes.length; b++) out += '%' + (bytes[b] < 16 ? '0' : '') + bytes[b].toString(16).toUpperCase();
      }
    }
    return out;
  }

  function utf8Bytes(ch) {
    var enc = unescape(encodeURIComponent(ch)), out = [];
    for (var i = 0; i < enc.length; i++) out.push(enc.charCodeAt(i));
    return out;
  }

  function qnameOf(n) { return n.prefix ? n.prefix + ':' + n.local : n.local; }

  function nsDeclsXml(e) {
    var s = '';
    for (var i = 0; i < e.nsDecls.length; i++) {
      var d = e.nsDecls[i];
      s += ' xmlns' + (d.prefix ? ':' + d.prefix : '') + '="' + escXmlAttr(d.uri) + '"';
    }
    return s;
  }

  function writeCdata(v) {
    // "]]>" 는 두 개의 CDATA 로 나눈다 (libxml2 xmlSaveWriteCData)
    var out = '', start = 0, idx;
    while ((idx = v.indexOf(']]>', start)) >= 0) {
      out += '<![CDATA[' + v.substring(start, idx + 2) + ']]>';
      start = idx + 2;
    }
    return out + '<![CDATA[' + v.substring(start) + ']]>';
  }

  function serializeXml(out, opts) {
    var buf = [], st = { format: opts.indent === 1 ? 1 : 0, level: 0 }, cdata = opts.cdata;
    function indent() { var n = Math.min(st.level, 30); for (var i = 0; i < n; i++) buf.push('  '); }
    function dump(n, isRoot) {
      switch (n.type) {
        case 1: {
          if (!isRoot && st.format === 1) indent();
          var q = qnameOf(n), s = '<' + q + nsDeclsXml(n);
          for (var i = 0; i < n.attrs.length; i++) {
            var a = n.attrs[i];
            s += ' ' + (a.prefix ? a.prefix + ':' + a.local : a.local) + '="' + escXmlAttr(a.value) + '"';
          }
          if (!n.children.length) { buf.push(s + '/>'); return; }
          var saved = st.format, unformatted = false, isCdata = cdata && cdata[varKey(n.ns, n.local)];
          if (st.format === 1) {
            for (var k = 0; k < n.children.length; k++) {
              if (n.children[k].type === 3) { st.format = 0; unformatted = true; break; }
            }
          }
          buf.push(s + '>');
          if (st.format === 1) buf.push('\n');
          st.level++;
          for (var j = 0; j < n.children.length; j++) {
            var c = n.children[j];
            if (c.type === 3 && isCdata && !c.doe) buf.push(writeCdata(c.v));
            else dump(c, false);
            if (st.format === 1) buf.push('\n');
          }
          st.level--;
          if (st.format === 1) indent();
          buf.push('</' + q + '>');
          if (unformatted) st.format = saved;
          return;
        }
        case 3: buf.push(n.doe ? n.v : escXmlText(n.v)); return;
        case 8:
          if (!isRoot && st.format === 1) indent();
          buf.push('<!--' + n.v + '-->');
          return;
        case 7:
          if (!isRoot && st.format === 1) indent();
          buf.push('<?' + n.target + (n.v ? ' ' + n.v : '') + '?>');
          return;
      }
    }
    if (!opts.omitDecl) {
      buf.push('<?xml version="' + (opts.version || '1.0') + '"');
      if (opts.encoding) buf.push(' encoding="' + opts.encoding + '"');
      if (opts.standalone === 1) buf.push(' standalone="yes"');
      else if (opts.standalone === 0) buf.push(' standalone="no"');
      buf.push('?>\n');
    }
    var top = out.root.children;
    if (opts.doctype) {
      var dt = opts.doctype;
      buf.push('<!DOCTYPE ' + dt.name +
        (dt.pub !== null ? ' PUBLIC "' + dt.pub + '" "' + (dt.sys || '') + '"' : (dt.sys !== null ? ' SYSTEM "' + dt.sys + '"' : '')) + '>');
      if (opts.indent !== 0) buf.push('\n');
    }
    for (var i = 0; i < top.length; i++) {
      dump(top[i], true);
      if (opts.indent !== 0 && top[i].type === 8 && i + 1 < top.length) buf.push('\n');
    }
    if (opts.indent !== 0) buf.push('\n');
    return buf.join('');
  }

  function serializeHtml(out, opts) {
    var buf = [], format = opts.indent !== 0, state = { raw: false };
    if (opts.doctype) {
      var dt = opts.doctype;
      buf.push('<!DOCTYPE ' + dt.name);
      if (dt.pub !== null) {
        buf.push(' PUBLIC "' + dt.pub + '"');
        if (dt.sys !== null) buf.push(' "' + dt.sys + '"');
      } else if (dt.sys !== null && dt.sys !== 'about:legacy-compat') {
        buf.push(' SYSTEM "' + dt.sys + '"');
      }
      buf.push('>\n');
    }
    function attrHtml(e, a) {
      var name = a.prefix ? a.prefix + ':' + a.local : a.local;
      if (HTML_BOOLEAN_ATTRS[a.local.toLowerCase()] && !a.prefix) return ' ' + name;
      var lname = a.local.toLowerCase(), v;
      if (!a.ns && !e.ns && (lname === 'href' || lname === 'action' || lname === 'src' ||
          (lname === 'name' && e.local.toLowerCase() === 'a'))) v = htmlSerializeUri(a.value);
      else v = escHtmlAttr(a.value);
      return ' ' + name + '="' + v + '"';
    }
    function dump(cur, parent) {
      var info, i;
      switch (cur.type) {
        case 1: {
          info = format ? htmlInfo(cur) : null;
          var full = htmlInfo(cur);
          var q = qnameOf(cur), s = '<' + q + nsDeclsXml(cur);
          for (i = 0; i < cur.attrs.length; i++) s += attrHtml(cur, cur.attrs[i]);
          buf.push(s);
          var ch = cur.children;
          if (full && full.empty) {
            buf.push('>');
          } else if (!ch.length) {
            buf.push('></' + q + '>');
          } else {
            buf.push('>');
            var first = ch[0], last = ch[ch.length - 1];
            if (info && !info.inline && first.type !== 3 && ch.length > 1 && cur.local.charAt(0) !== 'p') buf.push('\n');
            if (full && full.raw) state.raw = true;
            for (i = 0; i < ch.length; i++) dump(ch[i], cur);
            state.raw = false;
            if (info && !info.inline && last.type !== 3 && ch.length > 1 && cur.local.charAt(0) !== 'p') buf.push('\n');
            buf.push('</' + q + '>');
          }
          if (info && !info.inline) {
            var sib = parent.children, idx = sib.indexOf(cur), next = sib[idx + 1];
            if (next && next.type !== 3 && parent.type === 1 && parent.local.charAt(0) !== 'p') buf.push('\n');
          }
          return;
        }
        case 3:
          buf.push(cur.doe || state.raw ? cur.v : escHtmlText(cur.v));
          return;
        case 8:
          buf.push('<!--' + cur.v + '-->');
          return;
        case 7:
          buf.push('<?' + cur.target + (cur.v ? ' ' + cur.v : '') + '>');
          return;
      }
    }
    var top = out.root.children;
    for (var k = 0; k < top.length; k++) dump(top[k], out.root);
    buf.push('\n');
    return buf.join('');
  }

  function serializeText(out) {
    var buf = [];
    (function walk(list) {
      for (var i = 0; i < list.length; i++) {
        var c = list[i];
        if (c.type === 3) buf.push(c.v);
        else if (c.type === 1) walk(c.children);
      }
    })(out.root.children);
    return buf.join('');
  }

  // HTML 출력 시 <head> 의 meta charset 갱신/삽입 (libxml2 htmlSetMetaEncoding)
  function findChildIgnoreCase(parent, name) {
    for (var i = 0; i < parent.children.length; i++) {
      var c = parent.children[i];
      if (c.type === 1 && c.local.toLowerCase() === name) return c;
    }
    return null;
  }

  function metaCharsetRange(meta) {
    if (meta.type !== 1 || meta.local.toLowerCase() !== 'meta') return null;
    var i, a, httpEquiv = false, content = null;
    for (i = 0; i < meta.attrs.length; i++) {
      a = meta.attrs[i];
      if (a.ns) continue;
      var ln = a.local.toLowerCase();
      if (ln === 'charset') {
        var v = a.value, s = 0, e = v.length;
        while (s < e && /[ \t\n\f\r]/.test(v.charAt(s))) s++;
        while (e > s && /[ \t\n\f\r]/.test(v.charAt(e - 1))) e--;
        return { attr: a, start: s, end: e };
      }
      if (ln === 'http-equiv' && a.value.toLowerCase() === 'content-type') httpEquiv = true;
      if (ln === 'content') content = a;
    }
    if (!httpEquiv || !content) return null;
    var cv = content.value, m = /charset\s*=\s*/i.exec(cv);
    if (!m) return null;
    var st = m.index + m[0].length, en = st;
    var q = cv.charAt(st);
    if (q === '"' || q === "'") { st++; en = cv.indexOf(q, st); if (en < 0) en = cv.length; }
    else { while (en < cv.length && !/[ \t\n\f\r;]/.test(cv.charAt(en))) en++; }
    return { attr: content, start: st, end: en };
  }

  function setMetaEncoding(out, encoding) {
    var html = findChildIgnoreCase(out.root, 'html');
    if (!html) return;
    var head = findChildIgnoreCase(html, 'head');
    if (!head) return;
    var found = false;
    for (var i = 0; i < head.children.length; i++) {
      var r = metaCharsetRange(head.children[i]);
      if (r) {
        found = true;
        r.attr.value = r.attr.value.substring(0, r.start) + encoding + r.attr.value.substring(r.end);
      }
    }
    if (found) return;
    head.children.unshift({ type: 1, prefix: '', local: 'meta', ns: '', nsDecls: [], children: [], parent: head,
      attrs: [{ prefix: '', local: 'charset', ns: '', value: encoding }] });
  }

  var HTML_VERSIONS = {
    '5': [null, 'about:legacy-compat'],
    '4.01frame': ['-//W3C//DTD HTML 4.01 Frameset//EN', 'http://www.w3.org/TR/1999/REC-html401-19991224/frameset.dtd'],
    '4.01strict': ['-//W3C//DTD HTML 4.01//EN', 'http://www.w3.org/TR/1999/REC-html401-19991224/strict.dtd'],
    '4.01trans': ['-//W3C//DTD HTML 4.01 Transitional//EN', 'http://www.w3.org/TR/1999/REC-html401-19991224/loose.dtd'],
    '4.01': ['-//W3C//DTD HTML 4.01 Transitional//EN', 'http://www.w3.org/TR/1999/REC-html401-19991224/loose.dtd'],
    '4.0strict': ['-//W3C//DTD HTML 4.01//EN', 'http://www.w3.org/TR/html4/strict.dtd'],
    '4.0trans': ['-//W3C//DTD HTML 4.01 Transitional//EN', 'http://www.w3.org/TR/html4/loose.dtd'],
    '4.0frame': ['-//W3C//DTD HTML 4.01 Frameset//EN', 'http://www.w3.org/TR/html4/frameset.dtd'],
    '4.0': ['-//W3C//DTD HTML 4.01 Transitional//EN', 'http://www.w3.org/TR/html4/loose.dtd'],
    '3.2': ['-//W3C//DTD HTML 3.2//EN', null]
  };

  // 결과 트리 -> { text, mime } (libxslt xsltSaveResultTo + Blink ResultMIMEType)
  function serializeResult(sheet, out, forceHtml) {
    var o = sheet.output;
    function get(k) { return o[k] ? o[k].value : null; }
    var method = get('method'), version = get('version'), encoding = get('encoding');
    var dpub = get('doctype-public'), dsys = get('doctype-system');
    var indentAttr = get('indent'), indent = indentAttr === 'yes' ? 1 : (indentAttr === 'no' ? 0 : -1);
    if (forceHtml && !(o.method && o.method.prec === sheet.prec)) method = 'html';

    var top = out.root.children, rootEl = null, i;
    for (i = 0; i < top.length; i++) if (top[i].type === 1) { rootEl = top[i]; break; }
    var htmlDoc = false, doctype = null;

    if (method === 'html') {
      htmlDoc = true;
      if (dpub !== null || dsys !== null) doctype = { name: 'html', pub: dpub, sys: dsys };
      else if (version !== null) {
        var ids = HTML_VERSIONS[version.toLowerCase()];
        if (ids) doctype = { name: 'html', pub: ids[0], sys: ids[1] };
        else doctype = { name: 'html', pub: '-//W3C//DTD HTML 4.0 Transitional//EN', sys: 'http://www.w3.org/TR/REC-html40/loose.dtd' };
      }
    } else if (method === null && rootEl && !rootEl.ns && rootEl.local.toLowerCase() === 'html') {
      var ok = true;
      for (i = 0; i < top.length && top[i] !== rootEl; i++) {
        if (top[i].type === 3 && !isBlank(top[i].v)) { ok = false; break; }
      }
      if (ok) {
        htmlDoc = true;
        var dname = qnameOf(rootEl);
        if (dpub !== null || dsys !== null) doctype = { name: dname, pub: dpub, sys: dsys };
        else if (version !== null) {
          var ids2 = HTML_VERSIONS[version.toLowerCase()];
          if (ids2 && (ids2[0] !== null || ids2[1] !== null)) doctype = { name: dname, pub: ids2[0], sys: ids2[1] };
        }
      }
    }
    if (!htmlDoc && method !== 'text' && rootEl && (dpub !== null || dsys !== null)) {
      doctype = { name: qnameOf(rootEl), pub: dpub, sys: dsys };
    }

    var effective = method === null && htmlDoc ? 'html' : method;
    var mime = effective === 'html' ? 'text/html' : (effective === 'text' ? 'text/plain' : 'application/xml');
    if (!top.length) return { text: '', mime: mime };
    // (Blink xslt_processor_libxslt.cc) 결과는 곧바로 다시 파싱되므로 XML 선언은 항상 생략한다

    var text;
    if (effective === 'html') {
      setMetaEncoding(out, encoding || 'UTF-8');
      text = serializeHtml(out, { indent: indent === -1 ? 1 : indent, doctype: doctype });
    } else if (effective === 'text') {
      text = serializeText(out);
    } else {
      var sa = get('standalone');
      text = serializeXml(out, {
        indent: indent, doctype: doctype, cdata: sheet.cdata, version: version, encoding: encoding,
        omitDecl: true,
        standalone: sa === 'yes' ? 1 : (sa === 'no' ? 0 : -1)
      });
    }
    // Blink SaveResultToString: libxslt 가 붙이는 마지막 줄바꿈 1개를 제거
    if (text.charAt(text.length - 1) === '\n') text = text.substring(0, text.length - 1);
    return { text: text, mime: mime };
  }

  // ---------------------------------------------------------------------------
  // 문자열 -> DOM (Blink 의 transformToFragment / transformToDocument 와 같은 방식)
  // ---------------------------------------------------------------------------
  function isHtmlDocument(doc) {
    if (!doc) return false;
    if (typeof global.HTMLDocument !== 'undefined' && doc instanceof global.HTMLDocument) return true;
    return doc.contentType === 'text/html';
  }

  function buildFragment(result, outDoc) {
    var frag = outDoc.createDocumentFragment();
    if (result.mime === 'text/plain') {
      frag.appendChild(outDoc.createTextNode(result.text));
      return frag;
    }
    if (result.mime === 'text/html') {
      var body;
      if (isHtmlDocument(outDoc)) {
        body = outDoc.createElement('body');
        body.innerHTML = result.text;
      } else {
        var hdoc = new global.DOMParser().parseFromString('<!DOCTYPE html><html><head></head><body></body></html>', 'text/html');
        hdoc.body.innerHTML = result.text;
        body = outDoc.importNode(hdoc.body, true);
      }
      while (body.firstChild) frag.appendChild(body.firstChild);
      return frag;
    }
    // XML : 선언을 떼고 임시 루트로 감싸서 파싱한다
    var src = result.text.replace(/^<\?xml[^>]*\?>\s*/, '');
    var wrapped = '<xsltjs-fragment-root>' + src + '</xsltjs-fragment-root>';
    var xdoc = new global.DOMParser().parseFromString(wrapped, 'application/xml');
    if (isParseError(xdoc)) return null;
    var r = xdoc.documentElement;
    for (var c = r.firstChild; c; c = c.nextSibling) {
      if (c.nodeType === 10) continue;
      frag.appendChild(outDoc.importNode(c, true));
    }
    return frag;
  }

  function buildDocument(result) {
    var parser = new global.DOMParser();
    if (result.mime === 'text/html') return parser.parseFromString(result.text, 'text/html');
    if (result.mime === 'text/plain') {
      // Blink TransformTextStringToXHTMLDocumentString 과 같은 XHTML 문서
      var t = result.text.replace(/&/g, '&amp;').replace(/</g, '&lt;');
      return parser.parseFromString('<?xml version="1.0" encoding="UTF-8"?>\n' +
        '<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Strict//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-strict.dtd">\n' +
        '<html xmlns="http://www.w3.org/1999/xhtml">\n<head><title/></head>\n<body>\n<pre>' + t +
        '</pre>\n</body>\n</html>\n', 'application/xhtml+xml');
    }
    return parser.parseFromString(result.text, 'application/xml');
  }

  // ---------------------------------------------------------------------------
  // 공개 API : XSLTProcessor 와 같은 메서드
  // ---------------------------------------------------------------------------
  var serializer = null;
  function serializeNode(n) {
    if (!serializer) serializer = new global.XMLSerializer();
    return serializer.serializeToString(n);
  }

  function reportError(e) {
    if (global.console && global.console.error) {
      global.console.error('[xslt-bridge] transformation failed: ' + (e && e.message ? e.message : e));
    }
  }

  function XsltBridge() {
    if (!(this instanceof XsltBridge)) throw new TypeError("Failed to construct 'XSLTProcessor': Please use the 'new' operator");
    this._node = null;
    this._key = null;
    this._sheet = null;
    this._params = {};
  }

  XsltBridge.prototype.importStylesheet = function (node) {
    if (!node || (node.nodeType !== 9 && node.nodeType !== 1)) {
      throw new TypeError("Failed to execute 'importStylesheet' on 'XSLTProcessor': parameter 1 is not of type 'Node'.");
    }
    this._node = node;
    this._key = null;
    this._sheet = null;
  };

  // 스타일시트 DOM 이 바뀌었으면 다시 컴파일한다 (크롬은 변환할 때마다 스타일시트를 다시 읽음)
  XsltBridge.prototype._compiled = function () {
    var key = serializeNode(this._node);
    if (!this._sheet || key !== this._key) {
      this._sheet = compileStylesheet(this._node);
      this._key = key;
    }
    return this._sheet;
  };

  XsltBridge.prototype._transform = function (source, forceHtml) {
    var sheet = this._compiled();
    var srcDoc = source.nodeType === 9 ? source : source.ownerDocument;
    var base = (srcDoc && docBaseMap.get(srcDoc)) || (srcDoc && srcDoc.URL) || '';
    var doc = prepareDocument(source, sheet, base);
    var t = new Transform(sheet, this._params);
    var out = t.run(doc);
    return serializeResult(sheet, out, forceHtml);
  };

  XsltBridge.prototype.transformToString = function (source) {
    return this._transform(source, false).text;
  };

  XsltBridge.prototype.transformToFragment = function (source, output) {
    if (!source || !output) {
      throw new TypeError("Failed to execute 'transformToFragment' on 'XSLTProcessor': 2 arguments required.");
    }
    if (!this._node) return null;
    try {
      return buildFragment(this._transform(source, isHtmlDocument(output)), output);
    } catch (e) {
      reportError(e);
      return null;
    }
  };

  XsltBridge.prototype.transformToDocument = function (source) {
    if (!source) throw new TypeError("Failed to execute 'transformToDocument' on 'XSLTProcessor': 1 argument required.");
    if (!this._node) return null;
    try {
      return buildDocument(this._transform(source, false));
    } catch (e) {
      reportError(e);
      return null;
    }
  };

  XsltBridge.prototype.setParameter = function (ns, name, value) {
    this._params[String(name)] = String(value);
  };

  XsltBridge.prototype.getParameter = function (ns, name) {
    name = String(name);
    return hasOwn.call(this._params, name) ? this._params[name] : null;
  };

  XsltBridge.prototype.removeParameter = function (ns, name) {
    delete this._params[String(name)];
  };

  XsltBridge.prototype.clearParameters = function () { this._params = {}; };

  XsltBridge.prototype.reset = function () {
    this._node = null;
    this._key = null;
    this._sheet = null;
    this._params = {};
  };

  XsltBridge.version = '1.0.0';
  XsltBridge.isXsltBridge = true;
  XsltBridge.loadDocument = null;   // (url) -> Document : 외부 문서 로더를 바꿀 때 사용

  // ---------------------------------------------------------------------------
  // compare 모드: 브라우저 결과를 쓰면서 이 구현과 결과가 다른지 콘솔로 알려준다
  // ---------------------------------------------------------------------------
  function fragmentMarkup(v) {
    if (!v) return String(v);
    if (v.nodeType === 11) {
      var s = '';
      for (var c = v.firstChild; c; c = c.nextSibling) s += serializeNode(c);
      return s;
    }
    return serializeNode(v);
  }

  function reportDiff(kind, a, b) {
    if (a === b) return;
    var i = 0;
    while (i < a.length && i < b.length && a.charAt(i) === b.charAt(i)) i++;
    if (global.console && global.console.warn) {
      global.console.warn('[xslt-bridge compare] ' + kind + ' result differs from the native processor (offset ' + i + ')\n' +
        '  native: ' + JSON.stringify(a.substring(Math.max(0, i - 60), i + 60)) + '\n' +
        '  engine: ' + JSON.stringify(b.substring(Math.max(0, i - 60), i + 60)));
    }
  }

  function makeCompareProcessor(Native) {
    function CompareProcessor() {
      this._n = new Native();
      this._j = new XsltBridge();
    }
    function both(name) {
      CompareProcessor.prototype[name] = function () {
        var r = this._n[name].apply(this._n, arguments);
        try { this._j[name].apply(this._j, arguments); } catch (e) { reportError(e); }
        return r;
      };
    }
    both('importStylesheet'); both('setParameter'); both('removeParameter'); both('clearParameters'); both('reset');
    CompareProcessor.prototype.getParameter = function (ns, name) { return this._n.getParameter(ns, name); };
    CompareProcessor.prototype.transformToFragment = function (src, doc) {
      var r = this._n.transformToFragment(src, doc);
      try { reportDiff('transformToFragment', fragmentMarkup(r), fragmentMarkup(this._j.transformToFragment(src, doc))); }
      catch (e) { reportError(e); }
      return r;
    };
    CompareProcessor.prototype.transformToDocument = function (src) {
      var r = this._n.transformToDocument(src);
      try { reportDiff('transformToDocument', fragmentMarkup(r), fragmentMarkup(this._j.transformToDocument(src))); }
      catch (e) { reportError(e); }
      return r;
    };
    return CompareProcessor;
  }

  // ---------------------------------------------------------------------------
  // 설치
  // ---------------------------------------------------------------------------
  // CommonJS (번들러) 에서는 클래스를 내보낸다. 브라우저 창이 없으면(Node 등) 설치하지 않는다.
  if (typeof module === 'object' && module && module.exports) module.exports = XsltBridge;
  if (!global) return;

  // 이미 설치되어 있으면 아무것도 하지 않는다.
  // (여러 공통 JS 파일 앞에 이 엔진을 붙여 놓아도 안전하게 한 번만 설치된다)
  if (global.XsltBridge && global.XsltBridge.isXsltBridge) return;

  global.XsltBridge = XsltBridge;
  var mode = global.XSLT_BRIDGE_MODE || 'replace';

  // 브라우저 기본 XSLTProcessor 는 건드리지 않는다.
  // 값을 읽거나 new 로 만들기만 해도 크롬이 "XSLT 지원 중단" 경고를 콘솔/Issues 에 남기기 때문에,
  // replace 모드에서는 속성 설명자만 보고 넘어가고 실제 접근은 XSLTProcessorNative 를 쓸 때로 미룬다.
  var desc = null;
  try { desc = Object.getOwnPropertyDescriptor(global, 'XSLTProcessor'); } catch (e0) { desc = null; }

  function readNative() {
    if (!desc) return undefined;
    try { return desc.get ? desc.get.call(global) : desc.value; } catch (e1) { return undefined; }
  }

  function installProcessor(impl) {
    try {
      Object.defineProperty(global, 'XSLTProcessor', {
        value: impl, writable: true, configurable: true, enumerable: desc ? !!desc.enumerable : false
      });
    } catch (e2) {
      global.XSLTProcessor = impl;
    }
  }

  function exposeNativeLazily() {
    if (!desc) return;
    try {
      Object.defineProperty(global, 'XSLTProcessorNative', { configurable: true, get: readNative });
    } catch (e3) { /* 무시: 기본 XSLT 참조는 없어도 된다 */ }
  }

  if (mode === 'replace') {
    exposeNativeLazily();
    installProcessor(XsltBridge);
  } else if (mode === 'fallback' || mode === 'compare') {
    var Native = readNative(), nativeWorks = false;
    if (typeof Native === 'function' && !Native.isXsltBridge) {
      try { new Native(); nativeWorks = true; } catch (e4) { nativeWorks = false; }
    }
    if (nativeWorks) global.XSLTProcessorNative = Native;
    if (mode === 'fallback') {
      if (!nativeWorks) installProcessor(XsltBridge);
    } else if (nativeWorks) {
      installProcessor(makeCompareProcessor(Native));
    }
  }
})(typeof window !== 'undefined' ? window : null);
