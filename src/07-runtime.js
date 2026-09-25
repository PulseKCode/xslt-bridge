
  // ---------------------------------------------------------------------------
  // 결과 트리 빌더
  //   요소: { type:1, prefix, local, ns, attrs:[{prefix,local,ns,value}], nsDecls:[{prefix,uri}], children, parent }
  //   텍스트: { type:3, v, doe }, 주석: { type:8, v }, PI: { type:7, target, v }
  // ---------------------------------------------------------------------------
  function Out() {
    this.root = { type: 9, children: [], parent: null };
    this.cur = this.root;
  }

  Out.prototype.startElement = function (prefix, local, ns) {
    ns = ns || '';
    var e = { type: 1, prefix: ns ? (prefix || '') : '', local: local, ns: ns, attrs: [], nsDecls: [], children: [], parent: this.cur };
    this.cur.children.push(e);
    this.cur = e;
    return e;
  };

  Out.prototype.endElement = function () { this.cur = this.cur.parent; };

  Out.prototype.text = function (s, doe) {
    if (!s) return;
    doe = !!doe;
    var ch = this.cur.children, last = ch.length ? ch[ch.length - 1] : null;
    if (last && last.type === 3 && last.doe === doe) last.v += s;
    else ch.push({ type: 3, v: s, doe: doe });
  };

  Out.prototype.comment = function (s) { this.cur.children.push({ type: 8, v: s }); };

  Out.prototype.pi = function (target, s) { this.cur.children.push({ type: 7, target: target, v: s }); };

  Out.prototype.attribute = function (prefix, local, ns, value) {
    var e = this.cur;
    if (e.type !== 1) {
      // libxslt: 결과 루트·주석 내용 등 요소가 아닌 곳의 속성은 조용히 무시, 단 xsl:attribute 내용 바로 아래면 오류
      if (this.inAttr) throw XsltError('cannot add an attribute inside xsl:attribute (' + local + ')');
      return;
    }
    if (e.children.length) throw XsltError('cannot add attributes to an element after children have been added (' + local + ')');
    ns = ns || '';
    prefix = ns ? attrPrefixFor(e, prefix, ns) : '';
    for (var i = 0; i < e.attrs.length; i++) {
      var a = e.attrs[i];
      if (a.local === local && a.ns === ns) { a.value = value; return; }
    }
    e.attrs.push({ prefix: prefix, local: local, ns: ns, value: value });
  };

  function inScopeNamespaces(el) {
    var out = [], seen = {};
    for (var n = el; n && n.nodeType === 1; n = n.parentNode) {
      var at = n.attributes;
      for (var i = 0; i < at.length; i++) {
        var nm = at[i].name, p;
        if (nm === 'xmlns') p = '';
        else if (nm.substring(0, 6) === 'xmlns:') p = nm.substring(6);
        else continue;
        if (seen[p]) continue;
        seen[p] = true;
        if (p !== 'xml') out.push({ prefix: p, uri: at[i].value });
      }
    }
    return out;
  }

  Out.prototype.copyNode = function (n, top) {
    var c, i;
    switch (n.nodeType) {
      case 9: case 11:
        for (c = n.firstChild; c; c = c.nextSibling) this.copyNode(c, false);
        return;
      case 1: {
        var e = this.startElement(n.prefix || '', n.localName, nsOf(n));
        if (top) {
          var scope = inScopeNamespaces(n);
          for (i = 0; i < scope.length; i++) outDeclare(e, scope[i].prefix, scope[i].uri);
        } else {
          var own = n.attributes;
          for (i = 0; i < own.length; i++) {
            var nm = own[i].name;
            if (nm === 'xmlns') outDeclare(e, '', own[i].value);
            else if (nm.substring(0, 6) === 'xmlns:') outDeclare(e, nm.substring(6), own[i].value);
          }
        }
        fixElementNs(e);
        var at = n.attributes;
        for (i = 0; i < at.length; i++) {
          if (!isNsDecl(at[i])) this.attribute(at[i].prefix || '', at[i].localName, nsOf(at[i]), at[i].value);
        }
        for (c = n.firstChild; c; c = c.nextSibling) this.copyNode(c, false);
        this.endElement();
        return;
      }
      case 2: this.attribute(n.prefix || '', n.localName, nsOf(n), n.value); return;
      case 3: case 4: this.text(n.nodeValue, false); return;
      case 8: this.comment(n.nodeValue); return;
      case 7: this.pi(n.target, n.nodeValue); return;
    }
  };

  Out.prototype.copyResult = function (children) {
    for (var i = 0; i < children.length; i++) {
      var c = children[i], j;
      if (c.type === 1) {
        var e = this.startElement(c.prefix, c.local, c.ns);
        for (j = 0; j < c.nsDecls.length; j++) outDeclare(e, c.nsDecls[j].prefix, c.nsDecls[j].uri);
        fixElementNs(e);
        for (j = 0; j < c.attrs.length; j++) this.attribute(c.attrs[j].prefix, c.attrs[j].local, c.attrs[j].ns, c.attrs[j].value);
        this.copyResult(c.children);
        this.endElement();
      } else if (c.type === 3) this.text(c.v, c.doe);
      else if (c.type === 8) this.comment(c.v);
      else if (c.type === 7) this.pi(c.target, c.v);
    }
  };

  // 결과 트리 네임스페이스 관리 (libxslt xsltGetSpecialNamespace 규칙)
  function outLookupNs(e, prefix) {
    for (var n = e; n && n.type === 1; n = n.parent) {
      var d = n.nsDecls;
      for (var i = 0; i < d.length; i++) if (d[i].prefix === prefix) return d[i].uri;
    }
    if (prefix === 'xml') return XML_NS;
    return prefix === '' ? '' : null;
  }

  function declaredOn(e, prefix) {
    for (var i = 0; i < e.nsDecls.length; i++) if (e.nsDecls[i].prefix === prefix) return e.nsDecls[i];
    return null;
  }

  function outDeclare(e, prefix, uri) {
    if (prefix === 'xml') return true;
    if (outLookupNs(e, prefix) === uri) return true;
    if (declaredOn(e, prefix)) return false;
    e.nsDecls.push({ prefix: prefix, uri: uri });
    return true;
  }

  function outForceDeclare(e, prefix, uri) {
    if (!declaredOn(e, prefix)) e.nsDecls.push({ prefix: prefix, uri: uri });
  }

  function newPrefix(e, base) {
    var i = 1, p;
    do { p = base + '_' + (i++); } while (outLookupNs(e, p) !== null && i < 1000);
    return p;
  }

  function findPrefixByUri(e, uri) {
    for (var n = e; n && n.type === 1; n = n.parent) {
      var d = n.nsDecls;
      for (var i = 0; i < d.length; i++) {
        if (d[i].prefix && d[i].uri === uri && outLookupNs(e, d[i].prefix) === uri) return d[i].prefix;
      }
    }
    return null;
  }

  function fixElementNs(e) {
    if (!e.ns) {
      e.prefix = '';
      var d = declaredOn(e, '');
      if (!d && outLookupNs(e, '') !== '') e.nsDecls.push({ prefix: '', uri: '' });
      return;
    }
    if (!outDeclare(e, e.prefix, e.ns)) {
      var p = findPrefixByUri(e, e.ns);
      if (p) { e.prefix = p; return; }
      e.prefix = newPrefix(e, e.prefix || 'ns');
      e.nsDecls.push({ prefix: e.prefix, uri: e.ns });
    }
  }

  function attrPrefixFor(e, prefix, uri) {
    if (!prefix || prefix === 'xmlns') prefix = 'ns_1';
    if (prefix === 'xml') return 'xml';
    var own = declaredOn(e, prefix), p;
    if (own) {
      if (own.uri === uri) return prefix;
      p = findPrefixByUri(e, uri);
      if (p) return p;
    } else {
      if (e.parent && e.parent.type === 1) {
        var bound = outLookupNs(e.parent, prefix);
        if (bound === uri) return prefix;
        if (bound !== null) {
          for (var i = 0; i < e.attrs.length; i++) {
            if (e.attrs[i].ns && e.attrs[i].prefix === prefix) {
              p = findPrefixByUri(e, uri);
              if (p) return p;
              p = newPrefix(e, prefix);
              e.nsDecls.push({ prefix: p, uri: uri });
              return p;
            }
          }
        }
      }
      e.nsDecls.push({ prefix: prefix, uri: uri });
      return prefix;
    }
    p = newPrefix(e, prefix);
    e.nsDecls.push({ prefix: p, uri: uri });
    return p;
  }

  // ---------------------------------------------------------------------------
  // 변환 실행기
  // ---------------------------------------------------------------------------
  function Transform(sheet, params) {
    this.sheet = sheet;
    this.params = params || {};
    this.globalVals = {};
    this.globalBusy = {};
    this.depth = 0;
    this.keyIndexes = new WeakMap();
    this.docs = {};
    this.root = null;
  }

  var TP = Transform.prototype;

  TP.ctx = function (node) {
    return { node: node, pos: 1, size: 1, vars: EMPTY_SCOPE, params: null, tpl: null, mode: '', out: null, t: this };
  };

  TP.globalValue = function (key) {
    if (hasOwn.call(this.globalVals, key)) return this.globalVals[key];
    var g = this.sheet.globals[key];
    if (!g) throw XsltError('undefined variable $' + key);
    if (this.globalBusy[key]) throw XsltError('global variable $' + key + ' references itself');
    this.globalBusy[key] = true;
    var v;
    try {
      if (g.isParam && hasOwn.call(this.params, key)) v = this.params[key];
      else v = g.value(this.ctx(this.root));
    } finally {
      this.globalBusy[key] = false;
    }
    this.globalVals[key] = v;
    return v;
  };

  TP.run = function (root) {
    this.root = root;
    for (var k in this.sheet.globals) if (hasOwn.call(this.sheet.globals, k)) this.globalValue(k);
    var out = new Out();
    this.applyTemplates([root], '', null, out);
    return out;
  };

  TP.findTemplate = function (node, mode, minPrec, maxPrec) {
    var list = this.sheet.candidates(mode, node), px = null;
    for (var i = 0; i < list.length; i++) {
      var r = list[i];
      if (maxPrec !== undefined && (r.prec > maxPrec || r.prec < minPrec)) continue;
      if (!px) px = this.ctx(node);
      if (r.match(node, px)) return r.tpl;
    }
    return null;
  };

  TP.applyTemplates = function (nodes, mode, params, out) {
    var n = nodes.length;
    for (var i = 0; i < n; i++) {
      var node = nodes[i], tpl = this.findTemplate(node, mode);
      if (tpl) this.invoke(tpl, node, i + 1, n, mode, params, out);
      else this.builtin(node, mode, params, out);
    }
  };

  TP.invoke = function (tpl, node, pos, size, mode, params, out) {
    if (++this.depth > MAX_DEPTH) {
      this.depth--;
      throw XsltError('template recursion exceeded ' + MAX_DEPTH + ' levels (possible infinite recursion)');
    }
    var x = { node: node, pos: pos, size: size, vars: EMPTY_SCOPE, params: params, tpl: tpl, mode: mode, out: out, t: this };
    try { tpl.body(x); } finally { this.depth--; }
  };

  TP.builtin = function (node, mode, params, out) {
    switch (node.nodeType) {
      case 1: case 9: case 11: {
        var kids = [];
        for (var c = node.firstChild; c; c = c.nextSibling) if (c.nodeType !== 10) kids.push(c);
        if (kids.length) this.applyTemplates(kids, mode, params, out);
        break;
      }
      case 3: case 4: out.text(node.nodeValue, false); break;
      case 2: out.text(node.value, false); break;
    }
  };

  TP.applyImports = function (x) {
    var tpl = x.tpl;
    if (!tpl) throw XsltError('xsl:apply-imports: no current template rule (not allowed inside xsl:for-each)');
    var found = this.findTemplate(x.node, x.mode, tpl.minPrec, tpl.prec - 1);
    if (found) this.invoke(found, x.node, x.pos, x.size, x.mode, null, x.out);
    else this.builtin(x.node, x.mode, null, x.out);
  };

  TP.keyLookup = function (name, value, ctxNode) {
    var defs = this.sheet.keys[name];
    if (!defs) { warn('key(): unknown key "' + name + '"'); return []; }
    var idx = this.keyIndex(name, defs, rootNode(ctxNode)), vals = [], i;
    if (isArray(value)) { for (i = 0; i < value.length; i++) vals.push(stringValue(value[i])); }
    else if (value instanceof Rtf) vals.push(value.text());
    else vals.push(toString(value));
    if (vals.length === 1) { var l = idx[vals[0]]; return l ? l.slice() : []; }
    var res = [];
    for (i = 0; i < vals.length; i++) if (idx[vals[i]]) res = res.concat(idx[vals[i]]);
    return sortUniq(res);
  };

  TP.keyIndex = function (name, defs, root) {
    var perRoot = this.keyIndexes.get(root);
    if (!perRoot) { perRoot = {}; this.keyIndexes.set(root, perRoot); }
    if (perRoot[name]) return perRoot[name];
    var idx = Object.create(null);
    perRoot[name] = idx;
    var wantAttr = false, i, j;
    for (i = 0; i < defs.length; i++) {
      for (j = 0; j < defs[i].match.length; j++) {
        var b = defs[i].match[j].buckets[0];
        if (b === 'any' || b.charAt(0) === 'a') wantAttr = true;
      }
    }
    var x = this.ctx(root);
    function add(key, node) {
      var l = idx[key];
      if (!l) idx[key] = [node];
      else if (l[l.length - 1] !== node) l.push(node);
    }
    function visit(node) {
      for (var d = 0; d < defs.length; d++) {
        x.node = node;
        if (!patternMatches(defs[d].match, node, x)) continue;
        var v = evalExpr(defs[d].use, x);
        if (isArray(v)) { for (var k = 0; k < v.length; k++) add(stringValue(v[k]), node); }
        else add(toString(v), node);
      }
    }
    var stack = [root];
    while (stack.length) {
      var n = stack.pop();
      visit(n);
      if (wantAttr && n.nodeType === 1) {
        var at = n.attributes;
        for (i = 0; i < at.length; i++) if (!isNsDecl(at[i])) visit(at[i]);
      }
      for (var c = n.lastChild; c; c = c.previousSibling) stack.push(c);
    }
    return idx;
  };

  TP.loadDoc = function (url) {
    var hash = url.indexOf('#');
    if (hash >= 0) url = url.substring(0, hash);
    if (hasOwn.call(this.docs, url)) return this.docs[url];
    var doc = null;
    try {
      var src = loadXmlDocument(url);
      doc = prepareDocument(src, this.sheet, url);
    } catch (e) {
      warn('document(): ' + e.message);
    }
    this.docs[url] = doc;
    return doc;
  };

  TP.styleDoc = function (file) {
    if (file.styleDoc) return file.styleDoc;
    var doc = newXmlDocument();
    doc.appendChild(doc.importNode(file.root, true));
    stripStylesheetBlanks(doc.documentElement, false);
    numberTree(doc);
    docBaseMap.set(doc, file.base);
    file.styleDoc = doc;
    return doc;
  };

  TP.documentFn = function (arg, baseNodes, cc) {
    var self = this, out = [];
    function load(uri, base) {
      if (uri === '') return self.styleDoc(cc.file);
      return self.loadDoc(resolveUrl(uri, base));
    }
    if (isArray(arg)) {
      for (var i = 0; i < arg.length; i++) {
        var base = baseNodes ? (baseNodes.length ? nodeBase(baseNodes[0]) : null) : nodeBase(arg[i]);
        var d = load(stringValue(arg[i]), base);
        if (d) out.push(d);
      }
      return sortUniq(out);
    }
    var b = baseNodes ? (baseNodes.length ? nodeBase(baseNodes[0]) : null) : cc.file.base;
    var d2 = load(toString(arg), b);
    return d2 ? [d2] : [];
  };

  function nodeBase(n) {
    var r = rootNode(n), b = docBaseMap.get(r);
    if (b) return b;
    return global.location ? global.location.href : '';
  }

  // ---------------------------------------------------------------------------
  // 입력 문서 정규화: 텍스트 병합, CDATA -> 텍스트, strip-space 적용, 문서 순서 번호
  // ---------------------------------------------------------------------------
  function newXmlDocument() {
    return global.document.implementation.createDocument(null, null, null);
  }

  function makeStripper(sheet) {
    var rules = sheet.strip;
    if (!rules.length) return null;
    return function (el) {
      var best = null, ns = nsOf(el), local = el.localName;
      for (var i = 0; i < rules.length; i++) {
        var r = rules[i];
        if (r.local === '*') { if (r.uri !== null && r.uri !== ns) continue; }
        else if (r.local !== local || r.uri !== ns) continue;
        if (!best || r.prec > best.prec ||
            (r.prec === best.prec && (r.priority > best.priority || (r.priority === best.priority && r.order > best.order)))) best = r;
      }
      return !!best && best.strip;
    };
  }

  function normalizeTree(root, stripper) {
    var stack = [{ node: root, preserve: false }];
    while (stack.length) {
      var item = stack.pop(), p = item.node, preserve = item.preserve;
      if (p.nodeType === 1 && p.hasAttributeNS(XML_NS, 'space')) {
        var sp = p.getAttributeNS(XML_NS, 'space');
        if (sp === 'preserve') preserve = true;
        else if (sp === 'default') preserve = false;
      }
      var strip = !preserve && !!stripper && p.nodeType === 1 && stripper(p);
      var k = p.firstChild;
      while (k) {
        var next = k.nextSibling;
        if (k.nodeType === 3 || k.nodeType === 4) {
          var doc = p.ownerDocument || p;
          if (k.nodeType === 4) {
            var t = doc.createTextNode(k.data);
            p.replaceChild(t, k);
            k = t;
          }
          while (next && (next.nodeType === 3 || next.nodeType === 4)) {
            k.appendData(next.data);
            var nn = next.nextSibling;
            p.removeChild(next);
            next = nn;
          }
          if (k.data === '' || (strip && isBlank(k.data))) p.removeChild(k);
        } else if (k.nodeType === 1) {
          stack.push({ node: k, preserve: preserve });
        } else if (k.nodeType === 10 || k.nodeType === 5) {
          p.removeChild(k);
        }
        k = next;
      }
    }
  }

  // 스타일시트 문서(document('') 용): libxslt 처럼 공백만 있는 텍스트를 제거
  function stripStylesheetBlanks(el, preserve) {
    if (el.hasAttributeNS(XML_NS, 'space')) preserve = el.getAttributeNS(XML_NS, 'space') === 'preserve';
    var keep = preserve || (el.namespaceURI === XSL_NS && el.localName === 'text');
    var k = el.firstChild;
    while (k) {
      var next = k.nextSibling;
      if (k.nodeType === 4) {
        var t = el.ownerDocument.createTextNode(k.data);
        el.replaceChild(t, k);
        k = t;
      }
      if (k.nodeType === 3) {
        while (next && (next.nodeType === 3 || next.nodeType === 4)) {
          k.appendData(next.data);
          var nn = next.nextSibling;
          el.removeChild(next);
          next = nn;
        }
        if (!keep && isBlank(k.data)) el.removeChild(k);
      } else if (k.nodeType === 1) stripStylesheetBlanks(k, preserve);
      k = next;
    }
  }

  // 입력 문서를 그대로 써도 되는지 검사 (CDATA·인접 텍스트·strip-space 가 없으면 복사 생략 -> 대용량에서 빠름)
  function canUseDirectly(src, stripper) {
    if (stripper || src.nodeType !== 9) return false;
    var stack = [src];
    while (stack.length) {
      var n = stack.pop();
      for (var k = n.firstChild; k; k = k.nextSibling) {
        var t = k.nodeType;
        if (t === 4 || t === 5) return false;
        if (t === 3) {
          var nx = k.nextSibling;
          if (k.data === '' || (nx && (nx.nodeType === 3 || nx.nodeType === 4))) return false;
        } else if (t === 1 && k.firstChild) stack.push(k);
      }
    }
    return true;
  }

  function prepareDocument(src, sheet, base) {
    var stripper = makeStripper(sheet);
    if (canUseDirectly(src, stripper)) {
      numberTree(src);            // 호출할 때마다 다시 번호를 매겨서 DOM 이 바뀌어도 문서 순서가 맞게 한다
      if (base && !docBaseMap.get(src)) docBaseMap.set(src, base);
      return src;
    }
    var doc = newXmlDocument(), nodes = [], c;
    if (src.nodeType === 9 || src.nodeType === 11) { for (c = src.firstChild; c; c = c.nextSibling) nodes.push(c); }
    else nodes.push(src);
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      if (n.nodeType === 10) continue;
      if (n.nodeType === 3 || n.nodeType === 4) {
        if (isBlank(n.data)) continue;
        throw XsltError('the source document has text at the top level');
      }
      doc.appendChild(doc.importNode(n, true));
    }
    normalizeTree(doc, stripper);
    numberTree(doc);
    if (base) docBaseMap.set(doc, base);
    return doc;
  }
