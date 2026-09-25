
  // ---------------------------------------------------------------------------
  // 공통: 경고/오류 출력
  // ---------------------------------------------------------------------------
  function warn(msg) {
    if (global.console && global.console.warn) global.console.warn('[xslt-bridge] ' + msg);
  }

  // ---------------------------------------------------------------------------
  // 스타일시트 요소의 네임스페이스 범위
  // ---------------------------------------------------------------------------
  var nsScopeCache = new WeakMap();
  var nsScopeCounter = 0;
  var BASE_NS_SCOPE = { id: 0, map: { xml: XML_NS } };

  function nsScopeOf(el) {
    if (!el || el.nodeType !== 1) return BASE_NS_SCOPE;
    var s = nsScopeCache.get(el);
    if (s) return s;
    var parent = nsScopeOf(el.parentNode), own = null, at = el.attributes;
    for (var i = 0; i < at.length; i++) {
      var nm = at[i].name;
      if (nm === 'xmlns') { own = own || []; own.push(['', at[i].value]); }
      else if (nm.substring(0, 6) === 'xmlns:') { own = own || []; own.push([nm.substring(6), at[i].value]); }
    }
    if (!own) s = parent;
    else {
      var map = {};
      for (var p in parent.map) if (hasOwn.call(parent.map, p)) map[p] = parent.map[p];
      for (var j = 0; j < own.length; j++) map[own[j][0]] = own[j][1];
      s = { id: ++nsScopeCounter, map: map };
    }
    nsScopeCache.set(el, s);
    return s;
  }

  function makeCC(sheet, file, el) {
    var scope = nsScopeOf(el);
    return {
      sheet: sheet, file: file, el: el, scope: scope, nsKey: scope.id, cache: sheet.cache,
      ns: function (prefix) {
        if (prefix === '') return scope.map[''] || '';
        var u = scope.map[prefix];
        if (u === undefined) throw XsltError('undeclared namespace prefix "' + prefix + '"');
        return u;
      }
    };
  }

  function getAttr(el, name) { return el.hasAttribute(name) ? el.getAttribute(name) : null; }

  function needAttr(el, name) {
    var v = getAttr(el, name);
    if (v === null) throw XsltError('xsl:' + el.localName + ': missing required attribute "' + name + '"');
    return v;
  }

  function qnameKey(qn, cc, useDefault) {
    var q = splitQName(qn);
    var uri = q.prefix ? cc.ns(q.prefix) : (useDefault ? cc.ns('') : '');
    return varKey(uri, q.local);
  }

  function isXsl(el, local) { return el.nodeType === 1 && el.namespaceURI === XSL_NS && (!local || el.localName === local); }

  // ---------------------------------------------------------------------------
  // 속성값 템플릿 (AVT)
  // ---------------------------------------------------------------------------
  function compileAVT(str, cc) {
    if (str.indexOf('{') < 0 && str.indexOf('}') < 0) {
      var constant = function () { return str; };
      constant.isConst = true;
      constant.value = str;
      return constant;
    }
    var parts = [], lit = '', i = 0, n = str.length;
    while (i < n) {
      var ch = str.charAt(i);
      if (ch === '{') {
        if (str.charAt(i + 1) === '{') { lit += '{'; i += 2; continue; }
        var j = i + 1;
        while (j < n && str.charAt(j) !== '}') {
          var cj = str.charAt(j);
          if (cj === '"' || cj === "'") {
            var close = str.indexOf(cj, j + 1);
            j = close < 0 ? n : close + 1;
          } else j++;
        }
        if (j >= n) throw XsltError('unterminated "{" in attribute value template: ' + str);
        if (lit) { parts.push(lit); lit = ''; }
        parts.push(compileXPath(str.substring(i + 1, j), cc));
        i = j + 1;
      } else if (ch === '}') {
        lit += '}';
        i += str.charAt(i + 1) === '}' ? 2 : 1;
      } else {
        lit += ch;
        i++;
      }
    }
    if (lit) parts.push(lit);
    return function (x) {
      var s = '';
      for (var k = 0; k < parts.length; k++) s += typeof parts[k] === 'string' ? parts[k] : toString(evalExpr(parts[k], x));
      return s;
    };
  }

  // ---------------------------------------------------------------------------
  // 패턴 매칭
  // ---------------------------------------------------------------------------
  var BOOLEAN_FNS = { 'not': 1, 'true': 1, 'false': 1, 'boolean': 1, 'contains': 1, 'starts-with': 1, 'lang': 1,
    'function-available': 1, 'element-available': 1 };
  var STRING_FNS = { 'string': 1, 'concat': 1, 'substring': 1, 'substring-before': 1, 'substring-after': 1,
    'normalize-space': 1, 'translate': 1, 'local-name': 1, 'name': 1, 'namespace-uri': 1, 'generate-id': 1,
    'format-number': 1, 'system-property': 1, 'unparsed-entity-uri': 1 };
  var NODESET_FNS = { 'id': 1, 'key': 1, 'document': 1, 'current': 1 };

  function staticType(ast) {
    switch (ast.k) {
      case 'or': case 'and': case 'cmp': return 'boolean';
      case 'lit': return 'string';
      case 'path': case 'union': case 'filter': return 'nodeset';
      case 'group': return staticType(ast.a);
      case 'fn':
        if (ast.prefix) return 'unknown';
        if (BOOLEAN_FNS[ast.local]) return 'boolean';
        if (STRING_FNS[ast.local]) return 'string';
        if (NODESET_FNS[ast.local]) return 'nodeset';
        return 'unknown';
      default: return 'unknown';
    }
  }

  function usesPositionFn(ast) {
    if (!ast || typeof ast !== 'object') return false;
    if (ast.k === 'fn' && !ast.prefix && (ast.local === 'position' || ast.local === 'last')) return true;
    for (var p in ast) {
      if (!hasOwn.call(ast, p)) continue;
      var v = ast[p];
      if (isArray(v)) { for (var i = 0; i < v.length; i++) if (usesPositionFn(v[i])) return true; }
      else if (v && typeof v === 'object' && usesPositionFn(v)) return true;
    }
    return false;
  }

  function predIsPositional(ast) {
    var t = staticType(ast);
    return !(t === 'boolean' || t === 'string' || t === 'nodeset') || usesPositionFn(ast);
  }

  function inList(n, list) { for (var i = 0; i < list.length; i++) if (list[i] === n) return true; return false; }

  function compilePatternAlt(alt, cc) {
    var steps = [], i;
    for (i = 0; i < alt.steps.length; i++) {
      var st = alt.steps[i], preds = [], positional = false;
      for (var j = 0; j < st.preds.length; j++) {
        preds.push(compilePredicate(st.preds[j], cc));
        if (predIsPositional(st.preds[j])) positional = true;
      }
      steps.push({
        axis: st.axis, sep: st.sep, preds: preds, positional: positional,
        test: makeNodeTest(st.test, st.axis === 'attribute' ? 'attribute' : 'child', cc),
        rawTest: st.test
      });
    }
    var anchor = alt.anchor, anchorArgs = alt.anchorArgs;
    var keyName = null;
    if (anchor === 'key') {
      var q = splitQName(anchorArgs[0]);
      keyName = varKey(q.prefix ? cc.ns(q.prefix) : '', q.local);
    }

    function anchorNodes(n, x) {
      if (anchor === 'id') {
        var fake = { n: n, p: 1, s: 1, x: x };
        return FUNCS.id.fn(fake, [function () { return anchorArgs[0]; }]);
      }
      return x.t.keyLookup(keyName, anchorArgs[1] === undefined ? '' : anchorArgs[1], n);
    }

    function predsMatch(st, n, x) {
      var k;
      if (!st.positional) {
        for (k = 0; k < st.preds.length; k++) {
          var pr = st.preds[k];
          var r = pr.fn({ n: n, p: 1, s: 1, x: x });
          if (!toBoolean(r)) return false;
        }
        return true;
      }
      var parent = parentOf(n), cands = [];
      if (!parent) return false;
      if (st.axis === 'attribute') AXES.attribute(parent, st.test, cands);
      else AXES.child(parent, st.test, cands);
      for (k = 0; k < st.preds.length && cands.length; k++) cands = applyPredicate(cands, st.preds[k], x);
      return inList(n, cands);
    }

    function matchStep(i, n, x) {
      var st = steps[i], t = n.nodeType;
      if (st.axis === 'attribute') {
        if (t !== 2 || isNsDecl(n)) return false;
      } else if (st.axis === 'child') {
        if (t === 2 || t === 9 || t === 11 || t === 10) return false;
      }
      if (!st.test(n)) return false;
      if (st.preds.length && !predsMatch(st, n, x)) return false;
      var parent = parentOf(n), a;
      if (i === 0) {
        if (anchor === 'root') return !!parent && (parent.nodeType === 9 || parent.nodeType === 11);
        if (anchor === 'id' || anchor === 'key') {
          var set = anchorNodes(n, x);
          if (st.sep === '/') return !!parent && inList(parent, set);
          for (a = parent; a; a = parentOf(a)) if (inList(a, set)) return true;
          return false;
        }
        return true;
      }
      if (!parent) return false;
      if (st.sep === '/') return matchStep(i - 1, parent, x);
      for (a = parent; a; a = parentOf(a)) if (matchStep(i - 1, a, x)) return true;
      return false;
    }

    var match;
    if (!steps.length) {
      if (anchor === 'root') match = function (n) { return n.nodeType === 9 || n.nodeType === 11; };
      else match = function (n, x) { return inList(n, anchorNodes(n, x)); };
    } else {
      var last = steps.length - 1;
      match = function (n, x) { return matchStep(last, n, x); };
    }

    // 기본 우선순위
    var prio = 0.5;
    if (!anchor && !alt.desc && steps.length === 1 && !alt.steps[0].preds.length) {
      var tt = alt.steps[0].test;
      if (tt.t === 'name' || (tt.t === 'pi' && tt.target !== undefined)) prio = 0;
      else if (tt.t === 'nsany') prio = -0.25;
      else prio = -0.5;
    }

    // 템플릿 색인용 분류
    var bucket;
    if (!steps.length) bucket = anchor === 'root' ? ['root'] : ['any'];
    else {
      var ls = steps[steps.length - 1], lt = ls.rawTest;
      if (ls.axis === 'attribute') {
        bucket = lt.t === 'name' ? ['a:' + (lt.prefix ? cc.ns(lt.prefix) : '') + '|' + lt.local] : ['a*'];
      } else if (ls.axis === 'self') {
        bucket = ['any'];
      } else {
        switch (lt.t) {
          case 'name': bucket = ['e:' + (lt.prefix ? cc.ns(lt.prefix) : '') + '|' + lt.local]; break;
          case 'nsany': case 'any': bucket = ['e*']; break;
          case 'text': bucket = ['t']; break;
          case 'comment': bucket = ['c']; break;
          case 'pi': bucket = ['p']; break;
          default: bucket = ['n'];
        }
      }
    }
    return { match: match, priority: prio, buckets: bucket };
  }

  function compilePattern(str, cc) {
    var alts = parsePattern(str), out = [];
    for (var i = 0; i < alts.length; i++) out.push(compilePatternAlt(alts[i], cc));
    return out;
  }

  function patternMatches(pat, n, x) {
    for (var i = 0; i < pat.length; i++) if (pat[i].match(n, x)) return true;
    return false;
  }

  function nodeBuckets(n) {
    switch (n.nodeType) {
      case 1: return ['e:' + nsOf(n) + '|' + n.localName, 'e*', 'n', 'any'];
      case 2: return ['a:' + nsOf(n) + '|' + n.localName, 'a*', 'any'];
      case 3: case 4: return ['t', 'n', 'any'];
      case 8: return ['c', 'n', 'any'];
      case 7: return ['p', 'n', 'any'];
      case 9: case 11: return ['root', 'any'];
    }
    return ['any'];
  }

  // ---------------------------------------------------------------------------
  // 스타일시트
  // ---------------------------------------------------------------------------
  function Stylesheet() {
    this.rules = {};          // mode -> bucket -> [rule]
    this.ruleCache = {};
    this.named = {};
    this.globals = {};
    this.keys = {};
    this.output = {};
    this.cdata = {};
    this.strip = [];
    this.decimalFormats = { '': DEFAULT_DECIMAL_FORMAT };
    this.attrSets = {};
    this.aliases = {};
    this.prec = 0;
    this.order = 0;
    this.cache = {};
    this.files = [];
  }

  Stylesheet.prototype.addRule = function (rule) {
    var byMode = this.rules[rule.mode] || (this.rules[rule.mode] = {});
    for (var i = 0; i < rule.buckets.length; i++) {
      var b = rule.buckets[i];
      (byMode[b] || (byMode[b] = [])).push(rule);
    }
    this.ruleCache = {};
  };

  Stylesheet.prototype.candidates = function (mode, n) {
    var kinds = nodeBuckets(n), ck = mode + '\u0000' + kinds[0];
    var list = this.ruleCache[ck];
    if (list) return list;
    var byMode = this.rules[mode] || {};
    list = [];
    for (var i = 0; i < kinds.length; i++) {
      var b = byMode[kinds[i]];
      if (b) list = list.concat(b);
    }
    list.sort(function (a, b) {
      if (a.prec !== b.prec) return b.prec - a.prec;
      if (a.priority !== b.priority) return b.priority - a.priority;
      if (a.order !== b.order) return b.order - a.order;
      return b.alt - a.alt;
    });
    this.ruleCache[ck] = list;
    return list;
  };

  function isParseError(doc) {
    if (!doc || !doc.documentElement) return true;
    var de = doc.documentElement;
    if (de.localName === 'parsererror') return true;
    return doc.getElementsByTagNameNS('*', 'parsererror').length > 0 &&
      doc.getElementsByTagNameNS(XHTML_NS, 'parsererror').length > 0;
  }

  var docBaseMap = new WeakMap();

  function resolveUrl(href, base) {
    try { return new URL(href, base || undefined).href; } catch (e) {
      try { return new URL(href, global.location.href).href; } catch (e2) { return href; }
    }
  }

  function baseOf(node) {
    var doc = node.nodeType === 9 ? node : node.ownerDocument;
    var b = doc && docBaseMap.get(doc);
    if (b) return b;
    if (node.baseURI && node.baseURI !== 'about:blank') return node.baseURI;
    if (doc && doc.URL && doc.URL !== 'about:blank') return doc.URL;
    return global.location ? global.location.href : '';
  }

  function loadXmlDocument(url) {
    var hook = XsltBridge.loadDocument;
    var doc;
    if (hook) doc = hook(url);
    else {
      var xhr = new global.XMLHttpRequest();
      xhr.open('GET', url, false);
      try { xhr.overrideMimeType('text/xml'); } catch (e) { /* 무시 */ }
      xhr.send(null);
      if (xhr.status !== 0 && (xhr.status < 200 || xhr.status >= 300)) {
        throw XsltError('failed to load document (HTTP ' + xhr.status + '): ' + url);
      }
      doc = xhr.responseXML;
      if (!doc || isParseError(doc)) doc = new global.DOMParser().parseFromString(xhr.responseText, 'application/xml');
    }
    if (!doc || isParseError(doc)) throw XsltError('failed to parse XML document: ' + url);
    docBaseMap.set(doc, url);
    return doc;
  }

  function compileStylesheet(node) {
    var sheet = new Stylesheet();
    var root = node.nodeType === 9 ? node.documentElement : node;
    if (!root) throw XsltError('the stylesheet is empty');
    loadModule(sheet, root, baseOf(node), 0);
    return sheet;
  }

  function loadModule(sheet, root, base, depth) {
    if (depth > 64) throw XsltError('xsl:import / xsl:include nested too deeply');
    var decls = [], imports = [];
    var file = { base: base, root: root, doc: root.ownerDocument, prec: 0, minPrec: 0, excl: null, ext: null, fwd: false };
    collectModule(sheet, root, file, decls, imports, depth);
    var minPrec = sheet.prec + 1;
    for (var i = 0; i < imports.length; i++) loadModule(sheet, imports[i].root, imports[i].base, depth + 1);
    var prec = ++sheet.prec;
    for (var j = 0; j < decls.length; j++) {
      decls[j].file.prec = prec;
      decls[j].file.minPrec = minPrec;
    }
    for (var k = 0; k < decls.length; k++) compileDecl(sheet, decls[k].file, decls[k].el);
  }

  function prefixListToUris(list, cc) {
    var out = {};
    if (!list) return out;
    var toks = normalizeSpace(list).split(' ');
    for (var i = 0; i < toks.length; i++) {
      var t = toks[i];
      if (!t) continue;
      if (t === '#default') out[cc.ns('')] = true;
      else {
        var u = cc.scope.map[t];
        if (u === undefined) warn('exclude-result-prefixes: undeclared prefix "' + t + '"');
        else out[u] = true;
      }
    }
    return out;
  }

  function collectModule(sheet, root, file, decls, imports, depth) {
    sheet.files.push(file);
    var cc = makeCC(sheet, file, root);
    if (isXsl(root, 'stylesheet') || isXsl(root, 'transform')) {
      var version = getAttr(root, 'version');
      file.fwd = version !== null && version !== '1.0';
      file.excl = prefixListToUris(getAttr(root, 'exclude-result-prefixes'), cc);
      file.ext = prefixListToUris(getAttr(root, 'extension-element-prefixes'), cc);
      for (var k in file.ext) if (hasOwn.call(file.ext, k)) file.excl[k] = true;
      for (var c = root.firstChild; c; c = c.nextSibling) {
        if (c.nodeType !== 1) {
          if ((c.nodeType === 3 || c.nodeType === 4) && !isBlank(c.data)) {
            throw XsltError('text is not allowed directly inside xsl:stylesheet');
          }
          continue;
        }
        if (isXsl(c, 'import')) {
          var iurl = resolveUrl(needAttr(c, 'href'), file.base);
          var idoc = loadXmlDocument(iurl);
          imports.push({ root: idoc.documentElement, base: iurl });
        } else if (isXsl(c, 'include')) {
          var url = resolveUrl(needAttr(c, 'href'), file.base);
          var doc = loadXmlDocument(url);
          var sub = { base: url, root: doc.documentElement, doc: doc, prec: 0, minPrec: 0, excl: null, ext: null, fwd: false };
          collectModule(sheet, doc.documentElement, sub, decls, imports, depth + 1);
        } else {
          decls.push({ el: c, file: file });
        }
      }
    } else {
      // 단순화된 스타일시트: 최상위가 리터럴 결과 요소 + xsl:version
      if (!root.hasAttributeNS(XSL_NS, 'version')) throw XsltError('not an XSLT stylesheet (no xsl:stylesheet element)');
      file.excl = {};
      file.ext = {};
      decls.push({ el: root, file: file });
      file.simplified = true;
    }
  }

  function compileDecl(sheet, file, el) {
    var cc = makeCC(sheet, file, el);
    if (file.simplified && el === file.root) {
      var tpl0 = { prec: file.prec, minPrec: file.minPrec, order: ++sheet.order, file: file, name: null };
      var body0 = compileSequence([el], cc, { excl: file.excl, ext: file.ext, fwd: false, preserve: false, templateInherit: null });
      tpl0.body = body0;
      sheet.addRule({ tpl: tpl0, match: function (n) { return n.nodeType === 9 || n.nodeType === 11; }, priority: 0.5,
        prec: file.prec, order: tpl0.order, alt: 0, mode: '', buckets: ['root'] });
      return;
    }
    if (el.namespaceURI !== XSL_NS) return;   // 사용자 정의 최상위 요소는 무시
    switch (el.localName) {
      case 'template': compileTemplate(sheet, file, el, cc); break;
      case 'variable': case 'param': {
        var key = qnameKey(needAttr(el, 'name'), cc);
        var prev = sheet.globals[key];
        if (!prev || prev.prec <= file.prec) {
          sheet.globals[key] = { isParam: el.localName === 'param', prec: file.prec, value: compileVarValue(el, cc, file), name: key };
        }
        break;
      }
      case 'output': {
        var props = ['method', 'version', 'encoding', 'omit-xml-declaration', 'standalone', 'doctype-public',
          'doctype-system', 'indent', 'media-type'];
        for (var i = 0; i < props.length; i++) {
          var v = getAttr(el, props[i]);
          if (v === null) continue;
          var cur = sheet.output[props[i]];
          if (!cur || cur.prec <= file.prec) sheet.output[props[i]] = { value: normalizeSpace(v), prec: file.prec };
        }
        var cd = getAttr(el, 'cdata-section-elements');
        if (cd) {
          var names = normalizeSpace(cd).split(' ');
          for (var j = 0; j < names.length; j++) if (names[j]) sheet.cdata[qnameKey(names[j], cc, true)] = true;
        }
        break;
      }
      case 'key': {
        var kname = qnameKey(needAttr(el, 'name'), cc);
        (sheet.keys[kname] || (sheet.keys[kname] = [])).push({
          match: compilePattern(needAttr(el, 'match'), cc),
          use: compileXPath(needAttr(el, 'use'), cc)
        });
        break;
      }
      case 'strip-space': case 'preserve-space': {
        var list = normalizeSpace(needAttr(el, 'elements')).split(' ');
        for (var s = 0; s < list.length; s++) {
          var tok = list[s];
          if (!tok) continue;
          var rule = { strip: el.localName === 'strip-space', prec: file.prec, order: ++sheet.order };
          if (tok === '*') { rule.uri = null; rule.local = '*'; rule.priority = -0.5; }
          else {
            var q = splitQName(tok);
            rule.uri = q.prefix ? cc.ns(q.prefix) : '';
            rule.local = q.local;
            rule.priority = q.local === '*' ? -0.25 : 0;
          }
          sheet.strip.push(rule);
        }
        break;
      }
      case 'decimal-format': {
        var dname = getAttr(el, 'name');
        var dkey = dname === null ? '' : qnameKey(dname, cc);
        var df = {}, base = DEFAULT_DECIMAL_FORMAT;
        for (var p in base) if (hasOwn.call(base, p)) df[p] = base[p];
        var map = { 'decimal-separator': 'decimalPoint', 'grouping-separator': 'grouping', 'infinity': 'infinity',
          'minus-sign': 'minusSign', 'NaN': 'noNumber', 'percent': 'percent', 'per-mille': 'permille',
          'zero-digit': 'zeroDigit', 'digit': 'digit', 'pattern-separator': 'patternSeparator' };
        for (var an in map) if (hasOwn.call(map, an)) { var av = getAttr(el, an); if (av !== null) df[map[an]] = av; }
        sheet.decimalFormats[dkey] = df;
        break;
      }
      case 'attribute-set': {
        var akey = qnameKey(needAttr(el, 'name'), cc);
        var attrs = [];
        for (var ch = el.firstChild; ch; ch = ch.nextSibling) {
          if (ch.nodeType === 1 && isXsl(ch, 'attribute')) {
            var acc = makeCC(sheet, file, ch);
            var ins = compileInstruction(ch, acc, { excl: file.excl, ext: file.ext, fwd: file.fwd, preserve: false });
            ins.id = attributeIdentity(ch, acc);
            attrs.push(ins);
          }
        }
        (sheet.attrSets[akey] || (sheet.attrSets[akey] = [])).push({
          prec: file.prec, order: ++sheet.order, attrs: attrs,
          uses: useAttributeSetKeys(getAttr(el, 'use-attribute-sets'), cc)
        });
        break;
      }
      case 'namespace-alias': {
        var sp = needAttr(el, 'stylesheet-prefix'), rp = needAttr(el, 'result-prefix');
        var suri = sp === '#default' ? cc.ns('') : cc.ns(sp);
        var ruri = rp === '#default' ? cc.ns('') : cc.ns(rp);
        sheet.aliases[suri] = { uri: ruri, prefix: rp === '#default' ? '' : rp };
        break;
      }
      case 'import': case 'include':
        break;
      default:
        if (!file.fwd) throw XsltError('unknown top-level element xsl:' + el.localName);
    }
  }

  function useAttributeSetKeys(v, cc) {
    if (!v) return [];
    var toks = normalizeSpace(v).split(' '), out = [];
    for (var i = 0; i < toks.length; i++) if (toks[i]) out.push(qnameKey(toks[i], cc));
    return out;
  }

  function compileTemplate(sheet, file, el, cc) {
    var match = getAttr(el, 'match'), name = getAttr(el, 'name');
    var modeAttr = getAttr(el, 'mode'), prioAttr = getAttr(el, 'priority');
    if (match === null && name === null) throw XsltError('xsl:template requires a match or name attribute');
    var tpl = { prec: file.prec, minPrec: file.minPrec, order: ++sheet.order, file: file, name: name };
    // 템플릿 바로 아래 LRE 가 물려받는 네임스페이스 (libxslt xsltGetInheritedNsList)
    var inherit = [], seen = {}, scope = nsScopeOf(el).map;
    for (var p in scope) {
      if (!hasOwn.call(scope, p) || p === 'xml') continue;
      var u = scope[p];
      if (u === XSL_NS || (file.excl && file.excl[u])) continue;
      if (!seen[p]) { seen[p] = true; inherit.push({ prefix: p, uri: u }); }
    }
    tpl.body = compileSequence(childList(el), cc, {
      excl: file.excl, ext: file.ext, fwd: file.fwd, preserve: xmlSpacePreserve(el, false),
      templateInherit: inherit, inTemplate: true
    });
    if (match !== null) {
      var mode = modeAttr !== null ? qnameKey(modeAttr, cc) : '';
      var alts = compilePattern(match, cc);
      var prio = prioAttr !== null ? stringToNumber(prioAttr) : null;
      for (var i = 0; i < alts.length; i++) {
        sheet.addRule({ tpl: tpl, match: alts[i].match, priority: prio !== null ? prio : alts[i].priority,
          prec: file.prec, order: tpl.order, alt: i, mode: mode, buckets: alts[i].buckets });
      }
    }
    if (name !== null) {
      var key = qnameKey(name, cc);
      var prev = sheet.named[key];
      if (!prev || prev.prec <= tpl.prec) sheet.named[key] = tpl;
    }
  }

  function childList(el) {
    var out = [];
    for (var c = el.firstChild; c; c = c.nextSibling) out.push(c);
    return out;
  }

  function xmlSpacePreserve(el, inherited) {
    if (el.hasAttributeNS && el.hasAttributeNS(XML_NS, 'space')) return el.getAttributeNS(XML_NS, 'space') === 'preserve';
    return inherited;
  }

  // ---------------------------------------------------------------------------
  // 명령어 컴파일
  //   명령어 = { exec: function(x) } 또는 변수 바인딩 { bind: key, value: function(x) }
  // ---------------------------------------------------------------------------
  function compileSequence(nodes, cc, opts) {
    var instrs = [], i = 0;
    while (i < nodes.length) {
      var n = nodes[i];
      if (n.nodeType === 3 || n.nodeType === 4) {
        var text = '';
        while (i < nodes.length && (nodes[i].nodeType === 3 || nodes[i].nodeType === 4)) { text += nodes[i].data; i++; }
        if (opts.preserve || !isBlank(text)) instrs.push(textInstr(text));
        continue;
      }
      if (n.nodeType === 1) instrs.push(compileInstruction(n, makeCC(cc.sheet, cc.file, n), opts));
      i++;
    }
    return makeSeq(instrs);
  }

  function textInstr(text) {
    return { exec: function (x) { x.out.text(text, false); } };
  }

  function makeSeq(instrs) {
    var n = instrs.length, hasBind = false, i;
    for (i = 0; i < n; i++) if (instrs[i].bind) hasBind = true;
    if (n === 0) return function () {};
    if (!hasBind) {
      if (n === 1) return instrs[0].exec;
      return function (x) { for (var k = 0; k < n; k++) instrs[k].exec(x); };
    }
    return function (x) {
      var saved = x.vars;
      x.vars = Object.create(saved);
      try {
        for (var k = 0; k < n; k++) {
          var ins = instrs[k];
          if (ins.bind) {
            // libxslt: 같은 템플릿 안에서 이미 보이는 지역 변수/매개변수를 다시 정의하면 실행 오류
            if (ins.bind in x.vars) throw XsltError("redefinition of variable '" + ins.bind + "'");
            x.vars[ins.bind] = ins.value(x);
          } else ins.exec(x);
        }
      } finally {
        x.vars = saved;
      }
    };
  }

  function childOpts(opts, el) {
    return {
      excl: opts.excl, ext: opts.ext, fwd: opts.fwd, preserve: xmlSpacePreserve(el, opts.preserve),
      templateInherit: null, inTemplate: false
    };
  }

  function bodyOf(el, cc, opts, skip) {
    var nodes = [], leading = true;
    for (var c = el.firstChild; c; c = c.nextSibling) {
      if (skip && leading && c.nodeType === 1 && c.namespaceURI === XSL_NS && skip[c.localName]) continue;
      if (!((c.nodeType === 3 || c.nodeType === 4) && isBlank(c.data))) leading = false;
      nodes.push(c);
    }
    return compileSequence(nodes, cc, childOpts(opts, el));
  }

  function hasContent(el) {
    for (var c = el.firstChild; c; c = c.nextSibling) {
      if (c.nodeType === 1) return true;
      if ((c.nodeType === 3 || c.nodeType === 4) && (!isBlank(c.data) || xmlSpacePreserve(el, false))) return true;
    }
    return false;
  }

  var NCNAME_RE = /^[A-Za-z_\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u02FF\u0370-\u037D\u037F-\u1FFF\u200C\u200D\u2070-\u218F\u2C00-\u2FEF\u3001-\uD7FF\uF900-\uFDCF\uFDF0-\uFFFD\uD800-\uDBFF\uDC00-\uDFFF][A-Za-z_0-9.\-\u00B7\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u037D\u037F-\u1FFF\u200C\u200D\u203F\u2040\u2070-\u218F\u2C00-\u2FEF\u3001-\uD7FF\uF900-\uFDCF\uFDF0-\uFFFD\uD800-\uDBFF\uDC00-\uDFFF]*$/;
  function isQName(s) {
    var i = s.indexOf(':');
    if (i < 0) return NCNAME_RE.test(s);
    return NCNAME_RE.test(s.substring(0, i)) && NCNAME_RE.test(s.substring(i + 1));
  }

  // 이름 계산 결과 검사 (libxslt: 모두 변환 실패)
  function checkElementName(kind, qn, hasNsAttr, scope) {
    if (!isQName(qn)) throw XsltError(kind + ": computed name '" + qn + "' is not a valid QName");
    if (kind === 'xsl:attribute' && qn === 'xmlns') throw XsltError("xsl:attribute: the name 'xmlns' is not allowed");
    var q = splitQName(qn);
    if (!hasNsAttr && q.prefix && q.prefix !== 'xml' && scope[q.prefix] === undefined) {
      throw XsltError(kind + ": no namespace binding in scope for prefix '" + q.prefix + "' (" + qn + ')');
    }
    return q;
  }

  function compileVarValue(el, cc, opts) {
    var sel = getAttr(el, 'select');
    if (sel !== null && hasContent(el)) {
      throw XsltError('xsl:' + el.localName + " '" + getAttr(el, 'name') + "': must be empty when the select attribute is present");
    }
    if (sel !== null) {
      var f = compileXPath(sel, cc);
      return function (x) { return evalExpr(f, x); };
    }
    if (!hasContent(el)) return function () { return ''; };
    var body = bodyOf(el, cc, opts && opts.excl ? opts : { excl: {}, ext: {}, fwd: false, preserve: false });
    return function (x) { return buildRtf(body, x); };
  }

  function buildRtf(body, x) {
    var out = new Out(), saved = x.out;
    x.out = out;
    try { body(x); } finally { x.out = saved; }
    return new Rtf(out.root.children);
  }

  // 내용을 실행해서 바로 아래 텍스트만 모은다 (libxslt xsltEvalTemplateString)
  function bodyToString(body, x, inAttr) {
    var out = new Out(), saved = x.out;
    out.inAttr = !!inAttr;
    x.out = out;
    try { body(x); } finally { x.out = saved; }
    return new Rtf(out.root.children).text();
  }

  function compileSorts(el, cc) {
    var sorts = [];
    for (var c = el.firstChild; c; c = c.nextSibling) {
      if ((c.nodeType === 3 || c.nodeType === 4) && isBlank(c.data)) continue;
      if (c.nodeType === 1 && isXsl(c, 'with-param')) continue;
      if (c.nodeType !== 1 || !isXsl(c, 'sort')) break;
      {
        var scc = makeCC(cc.sheet, cc.file, c);
        var langAttr = getAttr(c, 'lang'), caseOrder = getAttr(c, 'case-order');
        sorts.push({
          select: compileXPath(getAttr(c, 'select') || '.', scc),
          dataType: sortAttr(c, 'data-type', 'text', { text: 1, number: 1 }, scc),
          order: sortAttr(c, 'order', 'ascending', { ascending: 1, descending: 1 }, scc),
          // Blink: Collator(lang 이 있으면 lang, 없으면 "en"), case-order="lower-first" 일 때만 소문자 우선
          collator: getCollator(langAttr === null ? 'en' : (langAttr.indexOf('{') >= 0 ? null : langAttr),
                                caseOrder === 'lower-first')
        });
      }
    }
    return sorts.length ? sorts : null;
  }

  // data-type / order: 고정값이 잘못되면 libxslt 처럼 경고 후 기본값, AVT 결과가 잘못되면 크롬처럼 변환 실패
  function sortAttr(el, name, def, allowed, cc) {
    var raw = getAttr(el, name);
    if (raw === null) return function () { return def; };
    if (raw.indexOf('{') < 0) {
      if (!allowed[raw]) { warn('xsl:sort: unsupported ' + name + '="' + raw + '", using ' + def); raw = def; }
      var fixed = raw;
      return function () { return fixed; };
    }
    var avt = compileAVT(raw, cc);
    return function (x) {
      var v = avt(x);
      if (!allowed[v]) throw XsltError('xsl:sort: unsupported ' + name + ' value "' + v + '"');
      return v;
    };
  }

  // ICU 정렬기 (크롬 WTF::Collator 와 같은 설정: 대문자 우선이 기본, 정규화 켬 - Intl.Collator 가 동일하게 동작)
  var collatorCache = {};
  function getCollator(lang, lowerFirst) {
    var key = (lang === null ? '' : lang) + '|' + (lowerFirst ? 'l' : 'u');
    if (collatorCache[key]) return collatorCache[key];
    var opts = { caseFirst: lowerFirst ? 'lower' : 'upper' }, loc = 'en', coll;
    if (lang === null) loc = undefined;                         // AVT 로 된 lang: ICU 기본 로캘
    else {
      var tag = String(lang).split('@')[0].replace(/_/g, '-');
      try { if (tag && global.Intl.Collator.supportedLocalesOf([tag]).length) loc = tag; } catch (e) { loc = 'en'; }
    }
    try { coll = new global.Intl.Collator(loc, opts); } catch (e2) { coll = null; }
    var cmp = coll ? coll.compare : function (a, b) { return a < b ? -1 : (a > b ? 1 : 0); };
    collatorCache[key] = cmp;
    return cmp;
  }

  function sortNodes(nodes, sorts, x) {
    var n = nodes.length;
    if (n < 2) return nodes;
    var specs = [], keys = [], i, k;
    for (k = 0; k < sorts.length; k++) {
      specs.push({ number: sorts[k].dataType(x) === 'number', desc: sorts[k].order(x) === 'descending', collate: sorts[k].collator });
      keys.push(new Array(n));
    }
    var sx = { node: null, pos: 0, size: n, vars: x.vars, params: null, tpl: null, mode: x.mode, out: x.out, t: x.t };
    for (i = 0; i < n; i++) {
      sx.node = nodes[i];
      sx.pos = i + 1;
      for (k = 0; k < sorts.length; k++) {
        var v = evalExpr(sorts[k].select, sx);
        keys[k][i] = specs[k].number ? toNumber(v) : toString(v);
      }
    }
    var idx = new Array(n);
    for (i = 0; i < n; i++) idx[i] = i;
    idx.sort(function (a, b) {
      for (var k = 0; k < specs.length; k++) {
        var ka = keys[k][a], kb = keys[k][b], r;
        if (specs[k].number) {
          if (ka !== ka) r = kb !== kb ? 0 : -1;
          else if (kb !== kb) r = 1;
          else r = ka === kb ? 0 : (ka > kb ? 1 : -1);
        } else {
          r = specs[k].collate(ka, kb);
          r = r < 0 ? -1 : (r > 0 ? 1 : 0);
        }
        if (specs[k].desc) r = -r;
        if (r) return r;
      }
      return a - b;
    });
    var out = new Array(n);
    for (i = 0; i < n; i++) out[i] = nodes[idx[i]];
    return out;
  }

  function compileWithParams(el, cc, opts) {
    var params = [];
    for (var c = el.firstChild; c; c = c.nextSibling) {
      if (c.nodeType === 1 && isXsl(c, 'with-param')) {
        var pcc = makeCC(cc.sheet, cc.file, c);
        params.push({ key: qnameKey(needAttr(c, 'name'), pcc), value: compileVarValue(c, pcc, opts) });
      }
    }
    return params.length ? params : null;
  }

  function evalParams(params, x) {
    if (!params) return null;
    var out = {};
    for (var i = 0; i < params.length; i++) out[params[i].key] = params[i].value(x);
    return out;
  }

  var XSL_INSTRUCTIONS = {
    'apply-imports': 1, 'apply-templates': 1, 'attribute': 1, 'call-template': 1, 'choose': 1, 'comment': 1,
    'copy': 1, 'copy-of': 1, 'element': 1, 'fallback': 1, 'for-each': 1, 'if': 1, 'message': 1, 'number': 1,
    'processing-instruction': 1, 'text': 1, 'value-of': 1, 'variable': 1
  };

  function fallbackOf(el, cc, opts) {
    var nodes = [];
    for (var c = el.firstChild; c; c = c.nextSibling) if (c.nodeType === 1 && isXsl(c, 'fallback')) nodes.push(c);
    if (!nodes.length) return null;
    var seqs = [];
    for (var i = 0; i < nodes.length; i++) seqs.push(bodyOf(nodes[i], makeCC(cc.sheet, cc.file, nodes[i]), opts));
    return function (x) { for (var k = 0; k < seqs.length; k++) seqs[k](x); };
  }

  function compileInstruction(el, cc, opts) {
    if (el.namespaceURI === XSL_NS) return compileXslInstruction(el, cc, opts);
    var uri = el.namespaceURI || '';
    var lreExt = prefixListToUris(el.getAttributeNS(XSL_NS, 'extension-element-prefixes'), cc);
    if ((opts.ext && opts.ext[uri]) || lreExt[uri]) {
      var fb = fallbackOf(el, cc, opts);
      if (fb) return { exec: fb };
      return { exec: function () { throw XsltError('unknown extension element <' + el.nodeName + '> (no xsl:fallback)'); } };
    }
    return compileLiteralElement(el, cc, opts);
  }

  function compileLiteralElement(el, cc, opts) {
    var excl = {}, k;
    for (k in opts.excl) if (hasOwn.call(opts.excl, k)) excl[k] = true;
    var lreExcl = prefixListToUris(el.getAttributeNS(XSL_NS, 'exclude-result-prefixes'), cc);
    var lreExt = prefixListToUris(el.getAttributeNS(XSL_NS, 'extension-element-prefixes'), cc);
    for (k in lreExcl) if (hasOwn.call(lreExcl, k)) excl[k] = true;
    for (k in lreExt) if (hasOwn.call(lreExt, k)) excl[k] = true;
    excl[XSL_NS] = true;
    var ext = {};
    for (k in opts.ext) if (hasOwn.call(opts.ext, k)) ext[k] = true;
    for (k in lreExt) if (hasOwn.call(lreExt, k)) ext[k] = true;

    var prefix = el.prefix || '', local = el.localName, uri = el.namespaceURI || '';
    // 이 요소에서 직접 선언된 네임스페이스 (제외 목록 적용)
    var ownNs = [], at = el.attributes, attrs = [], useSets = [];
    for (var i = 0; i < at.length; i++) {
      var a = at[i], nm = a.name;
      if (nm === 'xmlns' || nm.substring(0, 6) === 'xmlns:') {
        var p = nm === 'xmlns' ? '' : nm.substring(6);
        // libxslt: 제외 대상 중 접두어가 있는 선언만 빠진다 (기본 네임스페이스 선언은 남음), XSLT 네임스페이스는 항상 제외
        if (a.value === XSL_NS) continue;
        if (p !== '' && excl[a.value]) continue;
        ownNs.push({ prefix: p, uri: a.value });
        continue;
      }
      if (a.namespaceURI === XSL_NS) {
        if (a.localName === 'use-attribute-sets') useSets = useAttributeSetKeys(a.value, cc);
        continue;
      }
      attrs.push({ prefix: a.prefix || '', local: a.localName, uri: a.namespaceURI || '', avt: compileAVT(a.value, cc) });
    }
    var inherit = opts.templateInherit;
    var body = compileSequence(childList(el), cc, {
      excl: excl, ext: ext, fwd: opts.fwd, preserve: xmlSpacePreserve(el, opts.preserve),
      templateInherit: null, inTemplate: false
    });
    return {
      exec: function (x) {
        var aliases = x.t.sheet.aliases, al = aliases[uri];
        var ePrefix = prefix, eUri = uri;
        if (al) { eUri = al.uri; ePrefix = al.prefix; }
        var out = x.out, e = out.startElement(ePrefix, local, eUri), i;
        for (i = 0; i < ownNs.length; i++) {
          var o = ownNs[i], oa = aliases[o.uri];
          if (oa) outDeclare(e, o.prefix, oa.uri);
          else outDeclare(e, o.prefix, o.uri);
        }
        fixElementNs(e);
        if (inherit) {
          for (i = 0; i < inherit.length; i++) {
            var ih = inherit[i], iu = aliases[ih.uri] ? aliases[ih.uri].uri : ih.uri;
            if (outLookupNs(e, ih.prefix) !== iu) outForceDeclare(e, ih.prefix, iu);
          }
        }
        if (useSets.length) applyAttributeSets(useSets, x);
        for (i = 0; i < attrs.length; i++) {
          var ad = attrs[i], au = ad.uri, ap = ad.prefix, aal = au ? aliases[au] : null;
          if (aal) { au = aal.uri; ap = aal.prefix; }
          out.attribute(ap, ad.local, au, ad.avt(x));
        }
        body(x);
        out.endElement();
      }
    };
  }

  // xsl:attribute 의 동일성 키 (libxslt 는 이름/네임스페이스가 같은 속성을 병합 시 중복으로 본다)
  function attributeIdentity(el, cc) {
    var name = getAttr(el, 'name') || '', nsAttr = getAttr(el, 'namespace');
    if (name.indexOf('{') >= 0 || (nsAttr !== null && nsAttr.indexOf('{') >= 0)) return '\u0000avt';
    var q = splitQName(name), uri;
    if (nsAttr !== null) uri = nsAttr;
    else uri = q.prefix ? (cc.scope.map[q.prefix] || '') : '';
    return uri + '}' + q.local;
  }

  // libxslt xsltResolveAttrSet: 자기 속성 -> use-attribute-sets 로 쓴 집합 -> import 된 같은 이름 집합 순서로,
  // 이미 있는 이름은 건너뛰고 뒤에 붙인다
  function resolveAttributeSet(sheet, key, state) {
    var cache = sheet.attrSetCache || (sheet.attrSetCache = {});
    if (cache[key]) return cache[key];
    var defs = sheet.attrSets[key];
    if (!defs) { warn('attribute-set "' + key + '" is not defined'); return []; }
    if (state[key]) { warn('attribute-set "' + key + '" references itself'); return []; }
    state[key] = true;
    var byPrec = {}, precs = [], i, j;
    for (i = 0; i < defs.length; i++) {
      var d = defs[i];
      if (!byPrec[d.prec]) { byPrec[d.prec] = []; precs.push(d.prec); }
      byPrec[d.prec].push(d);
    }
    precs.sort(function (a, b) { return b - a; });
    function groupList(prec) {
      var group = byPrec[prec].slice().sort(function (a, b) { return a.order - b.order; });
      var list = [], uses = [];
      for (var g = 0; g < group.length; g++) {
        list = list.concat(group[g].attrs);
        uses = uses.concat(group[g].uses);
      }
      for (var u = 0; u < uses.length; u++) mergeAttrList(list, resolveAttributeSet(sheet, uses[u], state));
      return list;
    }
    var result = groupList(precs[0]);
    for (i = 1; i < precs.length; i++) mergeAttrList(result, groupList(precs[i]));
    state[key] = false;
    cache[key] = result;
    return result;
  }

  function mergeAttrList(list, other) {
    for (var i = 0; i < other.length; i++) {
      var dup = false;
      for (var j = 0; j < list.length; j++) if (list[j].id === other[i].id) { dup = true; break; }
      if (!dup) list.push(other[i]);
    }
  }

  function applyAttributeSets(keys, x) {
    var sheet = x.t.sheet, savedVars = x.vars;
    x.vars = EMPTY_SCOPE;
    try {
      for (var i = 0; i < keys.length; i++) {
        var list = resolveAttributeSet(sheet, keys[i], {});
        for (var k = 0; k < list.length; k++) list[k].exec(x);
      }
    } finally {
      x.vars = savedVars;
    }
  }

  var EMPTY_SCOPE = Object.create(null);

  function compileXslInstruction(el, cc, opts) {
    var name = el.localName, sel, body, f;
    switch (name) {
      case 'apply-templates': {
        var s1 = getAttr(el, 'select');
        sel = s1 !== null ? compileXPath(s1, cc) : null;
        var modeAttr = getAttr(el, 'mode');
        var mode = modeAttr !== null ? qnameKey(modeAttr, cc) : '';
        var sorts = compileSorts(el, cc), params = compileWithParams(el, cc, opts);
        return {
          exec: function (x) {
            var nodes;
            if (sel) nodes = asNodeSet(evalExpr(sel, x), 'xsl:apply-templates select');
            else {
              nodes = [];
              if (x.node.nodeType !== 2) for (var c = x.node.firstChild; c; c = c.nextSibling) if (c.nodeType !== 10) nodes.push(c);
            }
            if (sorts) nodes = sortNodes(nodes, sorts, x);
            x.t.applyTemplates(nodes, mode, evalParams(params, x), x.out);
          }
        };
      }
      case 'call-template': {
        var tkey = qnameKey(needAttr(el, 'name'), cc), cparams = compileWithParams(el, cc, opts);
        return {
          exec: function (x) {
            var tpl = x.t.sheet.named[tkey];
            if (!tpl) throw XsltError('xsl:call-template: no template named "' + tkey + '"');
            x.t.invoke(tpl, x.node, x.pos, x.size, x.mode, evalParams(cparams, x), x.out);
          }
        };
      }
      case 'apply-imports':
        return { exec: function (x) { x.t.applyImports(x); } };
      case 'for-each': {
        sel = compileXPath(needAttr(el, 'select'), cc);
        var fsorts = compileSorts(el, cc);
        body = bodyOf(el, cc, opts, { 'sort': 1 });
        return {
          exec: function (x) {
            var nodes = asNodeSet(evalExpr(sel, x), 'xsl:for-each select');
            if (fsorts) nodes = sortNodes(nodes, fsorts, x);
            var n = nodes.length;
            if (!n) return;
            var sn = x.node, sp = x.pos, ss = x.size, st = x.tpl;
            x.tpl = null;
            x.size = n;
            try {
              for (var i = 0; i < n; i++) { x.node = nodes[i]; x.pos = i + 1; body(x); }
            } finally {
              x.node = sn; x.pos = sp; x.size = ss; x.tpl = st;
            }
          }
        };
      }
      case 'if': {
        var test = compileXPath(needAttr(el, 'test'), cc);
        body = bodyOf(el, cc, opts);
        return { exec: function (x) { if (toBoolean(evalExpr(test, x))) body(x); } };
      }
      case 'choose': {
        var whens = [], otherwise = null;
        for (var c = el.firstChild; c; c = c.nextSibling) {
          if (c.nodeType !== 1) continue;
          var wcc = makeCC(cc.sheet, cc.file, c);
          if (isXsl(c, 'when')) whens.push({ test: compileXPath(needAttr(c, 'test'), wcc), body: bodyOf(c, wcc, opts) });
          else if (isXsl(c, 'otherwise')) otherwise = bodyOf(c, wcc, opts);
        }
        return {
          exec: function (x) {
            for (var i = 0; i < whens.length; i++) {
              if (toBoolean(evalExpr(whens[i].test, x))) { whens[i].body(x); return; }
            }
            if (otherwise) otherwise(x);
          }
        };
      }
      case 'value-of': {
        sel = compileXPath(needAttr(el, 'select'), cc);
        var doe = getAttr(el, 'disable-output-escaping') === 'yes';
        return { exec: function (x) { x.out.text(toString(evalExpr(sel, x)), doe); } };
      }
      case 'text': {
        var txt = '';
        for (var t = el.firstChild; t; t = t.nextSibling) if (t.nodeType === 3 || t.nodeType === 4) txt += t.data;
        var tdoe = getAttr(el, 'disable-output-escaping') === 'yes';
        return { exec: function (x) { x.out.text(txt, tdoe); } };
      }
      case 'element': {
        var ename = compileAVT(needAttr(el, 'name'), cc);
        var nsAttr = getAttr(el, 'namespace'), ens = nsAttr !== null ? compileAVT(nsAttr, cc) : null;
        var esets = useAttributeSetKeys(getAttr(el, 'use-attribute-sets'), cc);
        body = bodyOf(el, cc, opts);
        var escope = cc.scope.map, enameRaw = getAttr(el, 'name');
        if (enameRaw.indexOf('{') < 0) checkElementName('xsl:element', normalizeSpace(enameRaw), nsAttr !== null, escope);
        return {
          exec: function (x) {
            var qn = normalizeSpace(ename(x)), q = checkElementName('xsl:element', qn, !!ens, escope), uri, prefix = q.prefix || '';
            if (ens) {
              uri = ens(x);
              if (!uri) prefix = '';
            } else if (q.prefix) {
              uri = q.prefix === 'xml' ? XML_NS : escope[q.prefix];
            } else uri = escope[''] || '';
            var out = x.out, e = out.startElement(prefix, q.local, uri);
            fixElementNs(e);
            if (esets.length) applyAttributeSets(esets, x);
            body(x);
            out.endElement();
          }
        };
      }
      case 'attribute': {
        var aname = compileAVT(needAttr(el, 'name'), cc);
        var ansAttr = getAttr(el, 'namespace'), ans = ansAttr !== null ? compileAVT(ansAttr, cc) : null;
        body = bodyOf(el, cc, opts);
        var ascope = cc.scope.map, anameRaw = getAttr(el, 'name');
        if (anameRaw.indexOf('{') < 0) checkElementName('xsl:attribute', normalizeSpace(anameRaw), ansAttr !== null, ascope);
        return {
          exec: function (x) {
            var qn = normalizeSpace(aname(x)), q = checkElementName('xsl:attribute', qn, !!ans, ascope), uri;
            if (ans) uri = ans(x);
            else if (q.prefix) uri = q.prefix === 'xml' ? XML_NS : ascope[q.prefix];
            else uri = '';
            var value = bodyToString(body, x, true);
            x.out.attribute(uri ? (q.prefix || '') : '', q.local, uri, value);
          }
        };
      }
      case 'comment':
        body = bodyOf(el, cc, opts);
        return {
          exec: function (x) {
            var cv = bodyToString(body, x);
            if (cv.indexOf('--') >= 0 || cv.charAt(cv.length - 1) === '-') throw XsltError("xsl:comment: content contains '--' or ends with '-'");
            x.out.comment(cv);
          }
        };
      case 'processing-instruction': {
        var pname = compileAVT(needAttr(el, 'name'), cc);
        body = bodyOf(el, cc, opts);
        return {
          exec: function (x) {
            var pv = bodyToString(body, x);
            if (pv.indexOf('?>') >= 0) throw XsltError("xsl:processing-instruction: content contains '?>'");
            x.out.pi(normalizeSpace(pname(x)), pv);
          }
        };
      }
      case 'copy': {
        var csets = useAttributeSetKeys(getAttr(el, 'use-attribute-sets'), cc);
        body = bodyOf(el, cc, opts);
        return {
          exec: function (x) {
            var n = x.node, out = x.out;
            switch (n.nodeType) {
              case 9: case 11: body(x); break;
              case 1: {
                var e = out.startElement(n.prefix || '', n.localName, nsOf(n));
                var at = n.attributes;
                for (var i = 0; i < at.length; i++) {
                  var nm = at[i].name;
                  if (nm === 'xmlns') outDeclare(e, '', at[i].value);
                  else if (nm.substring(0, 6) === 'xmlns:') outDeclare(e, nm.substring(6), at[i].value);
                }
                fixElementNs(e);
                if (csets.length) applyAttributeSets(csets, x);
                body(x);
                out.endElement();
                break;
              }
              case 2: out.attribute(n.prefix || '', n.localName, nsOf(n), n.value); break;
              case 3: case 4: out.text(n.nodeValue, false); break;
              case 8: out.comment(n.nodeValue); break;
              case 7: out.pi(n.target, n.nodeValue); break;
            }
          }
        };
      }
      case 'copy-of': {
        sel = compileXPath(needAttr(el, 'select'), cc);
        return {
          exec: function (x) {
            var v = evalExpr(sel, x);
            if (isArray(v)) { for (var i = 0; i < v.length; i++) x.out.copyNode(v[i], true); }
            else if (v instanceof Rtf) x.out.copyResult(v.children);
            else x.out.text(toString(v), false);
          }
        };
      }
      case 'variable': case 'param': {
        var vkey = qnameKey(needAttr(el, 'name'), cc);
        var valueFn = compileVarValue(el, cc, opts);
        if (name === 'param' && opts.inTemplate) {
          return {
            bind: vkey,
            value: function (x) {
              var p = x.params;
              if (p && hasOwn.call(p, vkey)) return p[vkey];
              return valueFn(x);
            }
          };
        }
        return { bind: vkey, value: valueFn };
      }
      case 'number':
        return compileNumber(el, cc);
      case 'message': {
        body = bodyOf(el, cc, opts);
        var terminate = getAttr(el, 'terminate') === 'yes';
        return {
          exec: function (x) {
            var msg = buildRtf(body, x).text();
            if (global.console && global.console.log) global.console.log('[XSLT xsl:message] ' + msg);
            if (terminate) throw XsltError('transformation terminated by xsl:message terminate="yes": ' + msg);
          }
        };
      }
      case 'fallback':
        return { exec: function () {} };
      case 'sort':
        return { exec: function () { throw XsltError('xsl:sort is only allowed at the start of xsl:for-each or xsl:apply-templates'); } };
      case 'with-param':
        return { exec: function () {} };
    }
    if (opts.fwd) {
      var fb = fallbackOf(el, cc, opts);
      return { exec: fb || function () {} };
    }
    warn('unknown XSLT instruction xsl:' + name + ' ignored');
    return { exec: function () {} };
  }

  function compileNumber(el, cc) {
    var valueAttr = getAttr(el, 'value');
    var value = valueAttr !== null ? compileXPath(valueAttr, cc) : null;
    var level = getAttr(el, 'level') || 'single';
    var countAttr = getAttr(el, 'count'), fromAttr = getAttr(el, 'from');
    var countPat = countAttr !== null ? compilePattern(countAttr, cc) : null;
    var fromPat = fromAttr !== null ? compilePattern(fromAttr, cc) : null;
    var format = compileAVT(getAttr(el, 'format') || '1', cc);
    var gsAttr = getAttr(el, 'grouping-separator'), gzAttr = getAttr(el, 'grouping-size');
    var gsep = gsAttr !== null ? compileAVT(gsAttr, cc) : null, gsize = gzAttr !== null ? compileAVT(gzAttr, cc) : null;

    function countMatch(n, cur, x) {
      if (countPat) return patternMatches(countPat, n, x);
      if (n.nodeType !== cur.nodeType) {
        var tn = n.nodeType === 4 ? 3 : n.nodeType, tc = cur.nodeType === 4 ? 3 : cur.nodeType;
        if (tn !== tc) return false;
      }
      if (n.nodeType === 1 || n.nodeType === 2) return n.localName === cur.localName && nsOf(n) === nsOf(cur);
      if (n.nodeType === 7) return n.target === cur.target;
      return true;
    }

    return {
      exec: function (x) {
        var numbers = [], node = x.node, px = { node: node, pos: 1, size: 1, vars: EMPTY_SCOPE, t: x.t };
        if (value) {
          numbers.push(toNumber(evalExpr(value, x)));
        } else if (level === 'any') {
          var cnt = 0, cur = node;
          while (cur) {
            px.node = cur;
            if (countMatch(cur, node, px)) cnt++;
            if (fromPat && patternMatches(fromPat, cur, px)) break;
            if (cur.nodeType === 9 || cur.nodeType === 11) break;
            if (cur.nodeType === 2) cur = cur.ownerElement;
            else {
              var prev = cur.previousSibling;
              while (prev && prev.nodeType === 10) prev = prev.previousSibling;
              if (prev) { cur = prev; while (cur.lastChild) cur = cur.lastChild; }
              else cur = cur.parentNode;
            }
          }
          numbers.push(cnt);
        } else {
          var max = level === 'multiple' ? 1024 : 1;
          for (var anc = node; anc && anc.nodeType !== 9 && anc.nodeType !== 11; anc = parentOf(anc)) {
            px.node = anc;
            if (fromPat && patternMatches(fromPat, anc, px)) break;
            if (countMatch(anc, node, px)) {
              var c = 1;
              if (anc.nodeType !== 2) {
                for (var p = anc.previousSibling; p; p = p.previousSibling) {
                  px.node = p;
                  if (countMatch(p, node, px)) c++;
                }
              }
              numbers.push(c);
              if (numbers.length >= max) break;
            }
          }
          if (!numbers.length) return;
        }
        var perGroup = 0, gchar = '';
        if (gsep && gsize) {
          gchar = gsep(x).charAt(0);
          perGroup = stringToNumber(gsize(x));
          if (!(perGroup > 0)) perGroup = 0;
        }
        x.out.text(numberFormatInsert(numbers, numberFormatTokenize(format(x)), perGroup, gchar), false);
      }
    };
  }
