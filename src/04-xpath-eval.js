
  // ---------------------------------------------------------------------------
  // XPath 컴파일 : AST -> function(c) , c = { n: 노드, p: 위치, s: 크기, x: XSLT 실행 문맥 }
  // ---------------------------------------------------------------------------
  // 경로·술어·for-each·apply-templates 는 libxml2 처럼 노드 집합만 허용 (결과 트리 조각은 Invalid type 오류)
  function asNodeSet(v, what) {
    if (isArray(v)) return v;
    throw XsltError('XPath error (Invalid type): ' + what + ' requires a node-set' +
      (v instanceof Rtf ? '; convert the result tree fragment with exsl:node-set()' : ''));
  }

  // count/sum/name 등 libxml2 가 결과 트리 조각(XSLT_TREE)도 받아주는 함수용
  function asNodeSetOrRtf(v, what) {
    if (v instanceof Rtf) return rtfNodeSet(v);
    return asNodeSet(v, what);
  }

  function applyPredicate(nodes, pred, x) {
    var size = nodes.length;
    if (pred.index !== undefined) {
      var k = pred.index;
      return (k >= 1 && k <= size && k === Math.floor(k)) ? [nodes[k - 1]] : [];
    }
    var out = [], fn = pred.fn;
    for (var i = 0; i < size; i++) {
      var r = fn({ n: nodes[i], p: i + 1, s: size, x: x });
      if (typeof r === 'number' ? r === i + 1 : toBoolean(r)) out.push(nodes[i]);
    }
    return out;
  }

  function compilePredicate(ast, cc) {
    if (ast.k === 'num') return { index: ast.v, ast: ast };
    return { fn: compileExpr(ast, cc), ast: ast };
  }

  function makeNodeTest(test, axis, cc) {
    var principal = axis === 'attribute' ? 2 : 1;
    switch (test.t) {
      case 'any':
        return function (n) { return n.nodeType === principal; };
      case 'nsany': {
        var u1 = cc.ns(test.prefix);
        return function (n) { return n.nodeType === principal && (n.namespaceURI || '') === u1; };
      }
      case 'name': {
        var u2 = test.prefix ? cc.ns(test.prefix) : '', local = test.local;
        return function (n) { return n.nodeType === principal && n.localName === local && (n.namespaceURI || '') === u2; };
      }
      case 'node':
        return function (n) { return n.nodeType !== 10; };
      case 'text':
        return function (n) { return n.nodeType === 3 || n.nodeType === 4; };
      case 'comment':
        return function (n) { return n.nodeType === 8; };
      case 'pi': {
        var target = test.target;
        return function (n) { return n.nodeType === 7 && (target === undefined || n.target === target); };
      }
    }
    throw XsltError('unknown node test');
  }

  function compileStep(step, cc) {
    var axis = AXES[step.axis];
    var test = makeNodeTest(step.test, step.axis, cc);
    var preds = [];
    for (var i = 0; i < step.preds.length; i++) preds.push(compilePredicate(step.preds[i], cc));
    var reverse = !!REVERSE_AXES[step.axis];
    var np = preds.length;
    return function (input, x) {
      var single = input.length === 1, result = single ? null : [];
      for (var i = 0; i < input.length; i++) {
        var list = [];
        axis(input[i], test, list);
        for (var j = 0; j < np && list.length; j++) list = applyPredicate(list, preds[j], x);
        if (reverse && list.length > 1) list.reverse();
        if (single) return list;
        for (var k = 0; k < list.length; k++) result.push(list[k]);
      }
      return sortUniq(result);
    };
  }

  function compilePath(ast, cc) {
    var filter = ast.filter ? compileExpr(ast.filter, cc) : null;
    var steps = [];
    for (var i = 0; i < ast.steps.length; i++) steps.push(compileStep(ast.steps[i], cc));
    var absolute = ast.absolute, ns = steps.length;
    return function (c) {
      var nodes;
      if (filter) nodes = asNodeSet(filter(c), 'path step');
      else nodes = [absolute ? rootNode(c.n) : c.n];
      for (var i = 0; i < ns && nodes.length; i++) nodes = steps[i](nodes, c.x);
      return nodes;
    };
  }

  function varKey(uri, local) { return uri ? '{' + uri + '}' + local : local; }

  function lookupVar(x, key) {
    var vars = x.vars;
    if (vars && key in vars) return vars[key];
    return x.t.globalValue(key);
  }

  function compileExpr(ast, cc) {
    var a, b;
    switch (ast.k) {
      case 'or':
        a = compileExpr(ast.a, cc); b = compileExpr(ast.b, cc);
        return function (c) { return toBoolean(a(c)) || toBoolean(b(c)); };
      case 'and':
        a = compileExpr(ast.a, cc); b = compileExpr(ast.b, cc);
        return function (c) { return toBoolean(a(c)) && toBoolean(b(c)); };
      case 'cmp': {
        var op = ast.op;
        a = compileExpr(ast.a, cc); b = compileExpr(ast.b, cc);
        return function (c) { return compareValues(op, a(c), b(c)); };
      }
      case 'arith': {
        a = compileExpr(ast.a, cc); b = compileExpr(ast.b, cc);
        switch (ast.op) {
          case '+': return function (c) { return toNumber(a(c)) + toNumber(b(c)); };
          case '-': return function (c) { return toNumber(a(c)) - toNumber(b(c)); };
          case '*': return function (c) { return toNumber(a(c)) * toNumber(b(c)); };
          case 'div': return function (c) { return toNumber(a(c)) / toNumber(b(c)); };
          default: return function (c) { return toNumber(a(c)) % toNumber(b(c)); };
        }
      }
      case 'neg':
        a = compileExpr(ast.a, cc);
        return function (c) { return -toNumber(a(c)); };
      case 'union':
        a = compileExpr(ast.a, cc); b = compileExpr(ast.b, cc);
        return function (c) { return unionNodes(asNodeSet(a(c), '|'), asNodeSet(b(c), '|')); };
      case 'group':
        return compileExpr(ast.a, cc);
      case 'lit': {
        var sv = ast.v;
        return function () { return sv; };
      }
      case 'num': {
        var nv = ast.v;
        return function () { return nv; };
      }
      case 'var': {
        var key = varKey(ast.prefix ? cc.ns(ast.prefix) : '', ast.local);
        return function (c) { return lookupVar(c.x, key); };
      }
      case 'filter': {
        var prim = compileExpr(ast.prim, cc), preds = [];
        for (var i = 0; i < ast.preds.length; i++) preds.push(compilePredicate(ast.preds[i], cc));
        return function (c) {
          var v = asNodeSet(prim(c), 'predicate');
          for (var i = 0; i < preds.length && v.length; i++) v = applyPredicate(v, preds[i], c.x);
          return v;
        };
      }
      case 'path':
        return compilePath(ast, cc);
      case 'fn':
        return compileFunction(ast, cc);
    }
    throw XsltError('XPath internal error: ' + ast.k);
  }

  // 식 문자열 -> 컴파일된 함수 (같은 네임스페이스 문맥에서는 캐시)
  function compileXPath(expr, cc) {
    var cache = cc.cache;
    var ck = cc.nsKey + '\u0000' + expr;
    if (cache && hasOwn.call(cache, ck)) return cache[ck];
    var fn;
    try {
      fn = compileExpr(new Parser(expr).parseAll(), cc);
    } catch (e) {
      if (e.isXsltError && e.message.indexOf(expr) < 0) e.message += ' — "' + expr + '"';
      throw e;
    }
    if (cache) cache[ck] = fn;
    return fn;
  }

  function evalExpr(fn, x) { return fn({ n: x.node, p: x.pos, s: x.size, x: x }); }

  // ---------------------------------------------------------------------------
  // 함수 라이브러리
  // ---------------------------------------------------------------------------
  var FUNCS = {};
  function defFn(name, min, max, fn) { FUNCS[name] = { min: min, max: max, fn: fn }; }

  function firstNode(v, what) {
    var ns = asNodeSetOrRtf(v, what);
    return ns.length ? ns[0] : null;
  }

  function nodeLocalName(n) {
    if (n.nodeType === 1 || n.nodeType === 2) return n.localName || n.nodeName;
    if (n.nodeType === 7) return n.target;
    return '';
  }

  function nodeQName(n) {
    if (n.nodeType === 1 || n.nodeType === 2) return n.prefix ? n.prefix + ':' + n.localName : (n.localName || n.nodeName);
    if (n.nodeType === 7) return n.target;
    return '';
  }

  function xpathRound(f) {
    if (f !== f || f === Infinity || f === -Infinity) return f;
    if (f >= -0.5 && f < 0.5) return f * 0;
    var r = Math.floor(f);
    if (f - r >= 0.5) r += 1;
    return r;
  }

  function charsOf(s) { return toChars(s) || s.split(''); }

  function normalizeSpace(s) {
    var out = '', inSpace = false, started = false;
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      if (isBlankCode(c)) { inSpace = true; continue; }
      if (inSpace && started) out += ' ';
      out += s.charAt(i);
      inSpace = false;
      started = true;
    }
    return out;
  }

  defFn('last', 0, 0, function (c) { return c.s; });
  defFn('position', 0, 0, function (c) { return c.p; });
  defFn('count', 1, 1, function (c, a) { return asNodeSetOrRtf(a[0](c), 'count()').length; });
  defFn('id', 1, 1, function (c, a) {
    var v = a[0](c), tokens = [];
    if (isArray(v)) { for (var i = 0; i < v.length; i++) tokens = tokens.concat(normalizeSpace(stringValue(v[i])).split(' ')); }
    else tokens = normalizeSpace(toString(v)).split(' ');
    var root = rootNode(c.n), found = [];
    var want = {};
    for (var j = 0; j < tokens.length; j++) if (tokens[j]) want[tokens[j]] = true;
    (function walk(n) {
      for (var k = n.firstChild; k; k = k.nextSibling) {
        if (k.nodeType === 1) {
          var idv = k.getAttributeNS(XML_NS, 'id');
          if (idv && want[idv]) found.push(k);
          walk(k);
        }
      }
    })(root);
    return found;
  });
  defFn('local-name', 0, 1, function (c, a) {
    var n = a.length ? firstNode(a[0](c), 'local-name()') : c.n;
    return n ? nodeLocalName(n) : '';
  });
  defFn('namespace-uri', 0, 1, function (c, a) {
    var n = a.length ? firstNode(a[0](c), 'namespace-uri()') : c.n;
    return n && (n.nodeType === 1 || n.nodeType === 2) ? nsOf(n) : '';
  });
  defFn('name', 0, 1, function (c, a) {
    var n = a.length ? firstNode(a[0](c), 'name()') : c.n;
    return n ? nodeQName(n) : '';
  });
  defFn('string', 0, 1, function (c, a) { return a.length ? toString(a[0](c)) : stringValue(c.n); });
  defFn('concat', 2, Infinity, function (c, a) {
    var s = '';
    for (var i = 0; i < a.length; i++) s += toString(a[i](c));
    return s;
  });
  defFn('starts-with', 2, 2, function (c, a) {
    var s = toString(a[0](c)), t = toString(a[1](c));
    return s.substring(0, t.length) === t;
  });
  defFn('contains', 2, 2, function (c, a) { return toString(a[0](c)).indexOf(toString(a[1](c))) >= 0; });
  defFn('substring-before', 2, 2, function (c, a) {
    var s = toString(a[0](c)), t = toString(a[1](c)), i = s.indexOf(t);
    return i < 0 ? '' : s.substring(0, i);
  });
  defFn('substring-after', 2, 2, function (c, a) {
    var s = toString(a[0](c)), t = toString(a[1](c)), i = s.indexOf(t);
    return i < 0 ? '' : s.substring(i + t.length);
  });
  defFn('substring', 2, 3, function (c, a) {
    var s = toString(a[0](c)), start = xpathRound(toNumber(a[1](c)));
    var end = a.length > 2 ? start + xpathRound(toNumber(a[2](c))) : Infinity;
    if (start !== start || end !== end) return '';
    var chars = toChars(s), len = chars ? chars.length : s.length;
    var from = Math.max(start, 1), to = Math.min(end, len + 1);
    if (!(from < to)) return '';
    from = Math.ceil(from); to = Math.ceil(to);
    return chars ? chars.slice(from - 1, to - 1).join('') : s.substring(from - 1, to - 1);
  });
  defFn('string-length', 0, 1, function (c, a) {
    var s = a.length ? toString(a[0](c)) : stringValue(c.n);
    var chars = toChars(s);
    return chars ? chars.length : s.length;
  });
  defFn('normalize-space', 0, 1, function (c, a) { return normalizeSpace(a.length ? toString(a[0](c)) : stringValue(c.n)); });
  defFn('translate', 3, 3, function (c, a) {
    var s = charsOf(toString(a[0](c))), from = charsOf(toString(a[1](c))), to = charsOf(toString(a[2](c)));
    var map = {}, out = '';
    for (var i = 0; i < from.length; i++) if (!hasOwn.call(map, from[i])) map[from[i]] = i < to.length ? to[i] : '';
    for (var j = 0; j < s.length; j++) out += hasOwn.call(map, s[j]) ? map[s[j]] : s[j];
    return out;
  });
  defFn('boolean', 1, 1, function (c, a) { return toBoolean(a[0](c)); });
  defFn('not', 1, 1, function (c, a) { return !toBoolean(a[0](c)); });
  defFn('true', 0, 0, function () { return true; });
  defFn('false', 0, 0, function () { return false; });
  defFn('lang', 1, 1, function (c, a) {
    var want = toString(a[0](c)).toLowerCase();
    for (var n = c.n; n; n = parentOf(n)) {
      if (n.nodeType === 1 && n.hasAttributeNS(XML_NS, 'lang')) {
        var l = n.getAttributeNS(XML_NS, 'lang').toLowerCase();
        return l === want || (l.substring(0, want.length) === want && l.charAt(want.length) === '-');
      }
    }
    return false;
  });
  defFn('number', 0, 1, function (c, a) { return a.length ? toNumber(a[0](c)) : stringToNumber(stringValue(c.n)); });
  defFn('sum', 1, 1, function (c, a) {
    var v = a[0](c);
    if (v instanceof Rtf) return stringToNumber(v.text());
    var ns = asNodeSet(v, 'sum()'), s = 0;
    for (var i = 0; i < ns.length; i++) s += stringToNumber(stringValue(ns[i]));
    return s;
  });
  defFn('floor', 1, 1, function (c, a) { return Math.floor(toNumber(a[0](c))); });
  defFn('ceiling', 1, 1, function (c, a) { return Math.ceil(toNumber(a[0](c))); });
  defFn('round', 1, 1, function (c, a) { return xpathRound(toNumber(a[0](c))); });

  // XSLT 함수
  defFn('current', 0, 0, function (c) { return [c.x.node]; });
  defFn('unparsed-entity-uri', 1, 1, function () { return ''; });
  defFn('generate-id', 0, 1, function (c, a) {
    var n = a.length ? firstNode(a[0](c), 'generate-id()') : c.n;
    return n ? 'idp' + orderKey(n) : '';
  });
  defFn('system-property', 1, 1, function (c, a, cc) {
    var q = splitQName(toString(a[0](c)));
    var uri = q.prefix ? cc.ns(q.prefix) : '';
    if (uri !== XSL_NS) return '';
    if (q.local === 'version') return '1.0';
    if (q.local === 'vendor') return 'libxslt';
    if (q.local === 'vendor-url') return 'http://xmlsoft.org/XSLT/';
    return '';
  });
  defFn('function-available', 1, 1, function (c, a, cc) {
    var q = splitQName(toString(a[0](c)));
    if (!q.prefix) return hasOwn.call(FUNCS, q.local);
    return hasOwn.call(EXT_FUNCS, varKey(cc.ns(q.prefix), q.local));
  });
  defFn('element-available', 1, 1, function (c, a, cc) {
    var q = splitQName(toString(a[0](c)));
    var uri = q.prefix ? cc.ns(q.prefix) : (cc.ns('') || '');
    return uri === XSL_NS && hasOwn.call(XSL_INSTRUCTIONS, q.local);
  });
  defFn('key', 2, 2, function (c, a, cc) {
    var q = splitQName(toString(a[0](c)));
    var name = varKey(q.prefix ? cc.ns(q.prefix) : '', q.local);
    return c.x.t.keyLookup(name, a[1](c), c.n);
  });
  defFn('document', 1, 2, function (c, a, cc) {
    return c.x.t.documentFn(a[0](c), a.length > 1 ? asNodeSet(a[1](c), 'document()') : null, cc);
  });
  defFn('format-number', 2, 3, function (c, a, cc) {
    var num = toNumber(a[0](c)), pattern = toString(a[1](c));
    var fmtName = '';
    if (a.length > 2) {
      var q = splitQName(toString(a[2](c)));
      fmtName = varKey(q.prefix ? cc.ns(q.prefix) : '', q.local);
    }
    var df = cc.sheet.decimalFormats[fmtName];
    if (!df) {
      if (fmtName) throw XsltError('format-number: unknown decimal-format "' + fmtName + '"');
      df = DEFAULT_DECIMAL_FORMAT;
    }
    return formatNumber(num, pattern, df);
  });

  // 확장 함수: 크롬(Blink xslt_extensions.cc)은 exsl:node-set 하나만 등록한다
  //   (msxsl:node-set, exsl:object-type, math:/str:/set: 등은 크롬에서도 "Unregistered function" 오류)
  var EXT_FUNCS = {};
  EXT_FUNCS[varKey(EXSLT_COMMON_NS, 'node-set')] = { min: 1, max: 1, fn: nodeSetFn };
  function nodeSetFn(c, a) {
    var v = a[0](c);
    if (isArray(v)) return v;
    if (v instanceof Rtf) return rtfNodeSet(v);
    // 노드 집합이 아니면 문자열 값을 담은 텍스트 노드 하나 (Blink ExsltNodeSetFunction)
    var doc = scratchDocument(), frag = doc.createDocumentFragment(), text = doc.createTextNode(toString(v));
    frag.appendChild(text);
    return [text];
  }

  function splitQName(s) {
    s = normalizeSpace(s);
    var i = s.indexOf(':');
    return i < 0 ? { prefix: null, local: s } : { prefix: s.substring(0, i), local: s.substring(i + 1) };
  }

  function compileFunction(ast, cc) {
    // 알 수 없는 함수나 인자 개수 오류는 libxml2 처럼 실제로 호출될 때 오류를 낸다
    var def, label = (ast.prefix ? ast.prefix + ':' : '') + ast.local + '()';
    if (ast.prefix) def = EXT_FUNCS[varKey(cc.ns(ast.prefix), ast.local)];
    else def = FUNCS[ast.local];
    if (!def) return function () { throw XsltError('unregistered function: ' + label); };
    var n = ast.args.length;
    if (n < def.min || n > def.max) return function () { throw XsltError('wrong number of arguments for ' + label); };
    var args = [];
    for (var i = 0; i < n; i++) args.push(compileExpr(ast.args[i], cc));
    var impl = def.fn;
    return function (c) { return impl(c, args, cc); };
  }

  // RTF -> 노드 집합 (exsl:node-set)
  function rtfNodeSet(rtf) {
    if (rtf.domCache) return rtf.domCache;
    var doc = scratchDocument(), frag = doc.createDocumentFragment();
    appendResultToDom(doc, frag, rtf.children);
    rtf.domCache = [frag];
    return rtf.domCache;
  }

  var scratch = null;
  function scratchDocument() {
    if (!scratch) scratch = global.document.implementation.createDocument(null, null, null);
    return scratch;
  }

  function appendResultToDom(doc, parent, children) {
    for (var i = 0; i < children.length; i++) {
      var c = children[i], node;
      if (c.type === 1) {
        node = c.ns ? doc.createElementNS(c.ns, c.prefix ? c.prefix + ':' + c.local : c.local)
                    : doc.createElementNS(null, c.local);
        for (var j = 0; j < c.attrs.length; j++) {
          var at = c.attrs[j];
          if (at.ns) node.setAttributeNS(at.ns, at.prefix ? at.prefix + ':' + at.local : at.local, at.value);
          else node.setAttribute(at.local, at.value);
        }
        appendResultToDom(doc, node, c.children);
      } else if (c.type === 3) node = doc.createTextNode(c.v);
      else if (c.type === 8) node = doc.createComment(c.v);
      else if (c.type === 7) node = doc.createProcessingInstruction(c.target, c.v);
      if (node) parent.appendChild(node);
    }
  }
