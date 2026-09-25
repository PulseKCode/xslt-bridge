
  // ---------------------------------------------------------------------------
  // DOM 헬퍼
  // ---------------------------------------------------------------------------
  function parentOf(n) { return n.nodeType === 2 ? n.ownerElement : n.parentNode; }

  function rootNode(n) {
    var p;
    while ((p = parentOf(n))) n = p;
    return n;
  }

  function isNsDecl(a) {
    var nm = a.name;
    return a.namespaceURI === XMLNS_NS || nm === 'xmlns' || nm.substring(0, 6) === 'xmlns:';
  }

  function nsOf(n) { return n.namespaceURI || ''; }

  function stringValue(n) {
    switch (n.nodeType) {
      case 1: case 11: return n.textContent;
      case 9: return n.documentElement ? n.documentElement.textContent : '';
      case 2: return n.value;
      default: return n.nodeValue || '';
    }
  }

  // 문서 순서 번호 (한 번 번호를 매긴 트리는 변환 중에 바뀌지 않는다)
  var orderMap = new WeakMap();
  var orderCounter = 0;

  function numberTree(root) {
    var stack = [root];
    while (stack.length) {
      var n = stack.pop();
      orderMap.set(n, ++orderCounter);
      if (n.nodeType === 1) {
        var at = n.attributes;
        for (var i = 0; i < at.length; i++) orderMap.set(at[i], ++orderCounter);
      }
      for (var k = n.lastChild; k; k = k.previousSibling) stack.push(k);
    }
  }

  function orderKey(n) {
    var k = orderMap.get(n);
    if (k === undefined) {
      numberTree(rootNode(n));
      k = orderMap.get(n);
      if (k === undefined) { k = ++orderCounter; orderMap.set(n, k); }
    }
    return k;
  }

  function sortUniq(nodes) {
    var n = nodes.length;
    if (n < 2) return nodes;
    var keys = new Array(n), sorted = true, i;
    for (i = 0; i < n; i++) {
      keys[i] = orderKey(nodes[i]);
      if (i && keys[i] <= keys[i - 1]) sorted = false;
    }
    if (sorted) return nodes;
    var idx = new Array(n);
    for (i = 0; i < n; i++) idx[i] = i;
    idx.sort(function (a, b) { return keys[a] - keys[b]; });
    var out = [], last = -1;
    for (i = 0; i < n; i++) {
      var k = keys[idx[i]];
      if (k !== last) { out.push(nodes[idx[i]]); last = k; }
    }
    return out;
  }

  function descend(n, test, out) {
    for (var k = n.firstChild; k; k = k.nextSibling) {
      if (test(k)) out.push(k);
      if (k.firstChild) descend(k, test, out);
    }
  }

  function reverseDescendOrSelf(n, test, out) {
    for (var k = n.lastChild; k; k = k.previousSibling) reverseDescendOrSelf(k, test, out);
    if (test(n)) out.push(n);
  }

  var AXES = {
    'child': function (n, test, out) {
      if (n.nodeType === 2) return;
      for (var k = n.firstChild; k; k = k.nextSibling) if (test(k)) out.push(k);
    },
    'descendant': function (n, test, out) { if (n.nodeType !== 2) descend(n, test, out); },
    'descendant-or-self': function (n, test, out) {
      if (test(n)) out.push(n);
      if (n.nodeType !== 2) descend(n, test, out);
    },
    'parent': function (n, test, out) { var p = parentOf(n); if (p && test(p)) out.push(p); },
    'ancestor': function (n, test, out) { for (var p = parentOf(n); p; p = parentOf(p)) if (test(p)) out.push(p); },
    'ancestor-or-self': function (n, test, out) { for (var p = n; p; p = parentOf(p)) if (test(p)) out.push(p); },
    'following-sibling': function (n, test, out) {
      if (n.nodeType === 2) return;
      for (var k = n.nextSibling; k; k = k.nextSibling) if (test(k)) out.push(k);
    },
    'preceding-sibling': function (n, test, out) {
      if (n.nodeType === 2) return;
      for (var k = n.previousSibling; k; k = k.previousSibling) if (test(k)) out.push(k);
    },
    'following': function (n, test, out) {
      var a = n;
      if (n.nodeType === 2) { a = n.ownerElement; descend(a, test, out); }
      for (; a; a = parentOf(a)) {
        for (var s = a.nextSibling; s; s = s.nextSibling) {
          if (test(s)) out.push(s);
          descend(s, test, out);
        }
      }
    },
    'preceding': function (n, test, out) {
      var a = n.nodeType === 2 ? n.ownerElement : n;
      for (; a; a = parentOf(a)) {
        for (var s = a.previousSibling; s; s = s.previousSibling) reverseDescendOrSelf(s, test, out);
      }
    },
    'attribute': function (n, test, out) {
      if (n.nodeType !== 1) return;
      var at = n.attributes;
      for (var i = 0; i < at.length; i++) {
        var a = at[i];
        if (!isNsDecl(a) && test(a)) out.push(a);
      }
    },
    'self': function (n, test, out) { if (test(n)) out.push(n); },
    'namespace': function () { /* 네임스페이스 축은 지원하지 않음 (빈 결과) */ }
  };
  var REVERSE_AXES = { 'ancestor': 1, 'ancestor-or-self': 1, 'preceding': 1, 'preceding-sibling': 1 };

  // ---------------------------------------------------------------------------
  // 값 변환 (XPath 1.0 + libxml2 동작)
  // ---------------------------------------------------------------------------
  // 결과 트리 조각(RTF)
  function Rtf(children) { this.children = children; this.domCache = null; }
  Rtf.prototype.text = function () {
    var s = '';
    (function walk(list) {
      for (var i = 0; i < list.length; i++) {
        var c = list[i];
        if (c.type === 3) s += c.v;
        else if (c.type === 1) walk(c.children);
      }
    })(this.children);
    return s;
  };

  function toString(v) {
    if (typeof v === 'string') return v;
    if (typeof v === 'number') return numberToString(v);
    if (typeof v === 'boolean') return v ? 'true' : 'false';
    if (isArray(v)) return v.length ? stringValue(v[0]) : '';
    if (v instanceof Rtf) return v.text();
    return String(v);
  }

  function toNumber(v) {
    if (typeof v === 'number') return v;
    if (typeof v === 'boolean') return v ? 1 : 0;
    return stringToNumber(toString(v));
  }

  function toBoolean(v) {
    if (typeof v === 'boolean') return v;
    if (typeof v === 'number') return v !== 0 && v === v;
    if (typeof v === 'string') return v.length > 0;
    if (isArray(v)) return v.length > 0;
    if (v instanceof Rtf) return true;
    return !!v;
  }

  function setStrings(v) {
    if (v instanceof Rtf) return [v.text()];
    var out = new Array(v.length);
    for (var i = 0; i < v.length; i++) out[i] = stringValue(v[i]);
    return out;
  }

  // libxml2 xmlXPathNodeValHash: 문자열 값의 앞 2바이트(UTF-8). 문서/조각 루트는 첫 요소(없으면 첫 자식)로 계산하는
  // 특이 동작이 있어서, 여러 노드로 된 결과 트리 조각을 문자열과 = 비교하면 크롬에서 false 가 되는 경우가 있다.
  function hash2(s) {
    if (!s) return 0;
    var c0 = s.charCodeAt(0), b0, b1;
    if (c0 < 0x80) {
      b0 = c0;
      if (s.length === 1) return b0;
      var c1 = s.charCodeAt(1);
      b1 = c1 < 0x80 ? c1 : utf8Bytes(s.charAt(1) + (c1 >= 0xD800 && c1 <= 0xDBFF ? s.charAt(2) : ''))[0];
      return b0 + (b1 << 8);
    }
    var bytes = utf8Bytes(s.charAt(0) + (c0 >= 0xD800 && c0 <= 0xDBFF ? s.charAt(1) : ''));
    return bytes[0] + (bytes[1] << 8);
  }

  function nodeHash(n) {
    if (n.nodeType === 9 || n.nodeType === 11) {
      var t = null, k;
      for (k = n.firstChild; k; k = k.nextSibling) if (k.nodeType === 1) { t = k; break; }
      if (!t) t = n.firstChild;
      if (!t) return 0;
      n = t;
    }
    switch (n.nodeType) {
      case 1: return hash2(n.textContent);
      case 2: return hash2(n.value);
      case 3: case 4: case 7: case 8: return hash2(n.nodeValue);
    }
    return 0;
  }

  function rtfHash(rtf) {
    var ch = rtf.children, t = null, i;
    for (i = 0; i < ch.length; i++) if (ch[i].type === 1) { t = ch[i]; break; }
    if (!t) t = ch[0];
    if (!t) return 0;
    if (t.type === 1) return hash2(new Rtf(t.children).text());
    return hash2(t.v);
  }

  function setItems(v) {
    if (v instanceof Rtf) return [{ s: v.text(), h: rtfHash(v) }];
    var out = new Array(v.length);
    for (var i = 0; i < v.length; i++) out[i] = { s: stringValue(v[i]), h: nodeHash(v[i]) };
    return out;
  }

  function relop(op, x, y) {
    switch (op) {
      case '<': return x < y;
      case '<=': return x <= y;
      case '>': return x > y;
      default: return x >= y;
    }
  }

  function comparePrimitive(op, a, b) {
    if (op === '=' || op === '!=') {
      var r;
      if (typeof a === 'boolean' || typeof b === 'boolean') r = toBoolean(a) === toBoolean(b);
      else if (typeof a === 'number' || typeof b === 'number') r = toNumber(a) === toNumber(b);
      else r = toString(a) === toString(b);
      return op === '=' ? r : !r;
    }
    return relop(op, toNumber(a), toNumber(b));
  }

  function compareValues(op, a, b) {
    var aSet = isArray(a) || a instanceof Rtf, bSet = isArray(b) || b instanceof Rtf;
    var eq = op === '=' || op === '!=';
    var i, j, sa, sb;
    if (aSet && bSet) {
      if (eq) {
        var ia = setItems(a), ib = setItems(b), want = op === '=';
        for (i = 0; i < ia.length; i++) for (j = 0; j < ib.length; j++) {
          if ((ia[i].h === ib[j].h && ia[i].s === ib[j].s) === want) return true;
        }
        return false;
      }
      sa = setStrings(a); sb = setStrings(b);
      for (i = 0; i < sa.length; i++) {
        var na = stringToNumber(sa[i]);
        for (j = 0; j < sb.length; j++) if (relop(op, na, stringToNumber(sb[j]))) return true;
      }
      return false;
    }
    if (aSet || bSet) {
      var set = aSet ? a : b, other = aSet ? b : a, swapped = !aSet;
      if (typeof other === 'boolean') {
        var sbool = toBoolean(set);
        return swapped ? comparePrimitive(op, other, sbool) : comparePrimitive(op, sbool, other);
      }
      if (typeof other !== 'number' && eq) {
        var items = setItems(set), os = toString(other), oh = hash2(os), wantEq = op === '=';
        for (i = 0; i < items.length; i++) {
          if ((items[i].h === oh && items[i].s === os) === wantEq) return true;
        }
        return false;
      }
      var strs = setStrings(set);
      for (i = 0; i < strs.length; i++) {
        var left = stringToNumber(strs[i]), right = toNumber(other);
        if (swapped) { var tmp = left; left = right; right = tmp; }
        if (eq ? ((left === right) === (op === '=')) : relop(op, left, right)) return true;
      }
      return false;
    }
    return comparePrimitive(op, a, b);
  }

  function unionNodes(a, b) {
    if (!a.length) return b;
    if (!b.length) return a;
    return sortUniq(a.concat(b));
  }
