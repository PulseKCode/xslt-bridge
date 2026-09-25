/*!
 * xslt-bridge 1.0.0 - a pure JavaScript replacement for the browser's XSLTProcessor
 * (XSLT 1.0 / XPath 1.0) that reproduces Chrome's output.
 * https://github.com/PulseKCode/xslt-bridge
 *
 * Copyright (c) 2026 BongJun Park (PulseKCode). Released under the MIT License.
 * Portions are derived from libxml2 (Copyright (C) 1998-2012 Daniel Veillard,
 * The Libxml2 Contributors) and libxslt (Copyright (C) 2001-2002 Daniel Veillard),
 * both under MIT-style licenses. See THIRD-PARTY-NOTICES.md for the full notices.
 */
(function(global) {
  "use strict";
  var XSL_NS = "http://www.w3.org/1999/XSL/Transform";
  var XMLNS_NS = "http://www.w3.org/2000/xmlns/";
  var XML_NS = "http://www.w3.org/XML/1998/namespace";
  var XHTML_NS = "http://www.w3.org/1999/xhtml";
  var EXSLT_COMMON_NS = "http://exslt.org/common";
  var MSXSL_NS = "urn:schemas-microsoft-com:xslt";
  var MAX_DEPTH = 3e3;
  var hasOwn = Object.prototype.hasOwnProperty;
  var objToString = Object.prototype.toString;
  function XsltError(message) {
    var e = new Error(message);
    e.name = "XsltError";
    e.isXsltError = true;
    return e;
  }
  function isArray(v) {
    return objToString.call(v) === "[object Array]";
  }
  function isBlankCode(c) {
    return c === 32 || c === 9 || c === 10 || c === 13;
  }
  function isBlank(s) {
    for (var i = 0; i < s.length; i++) {
      if (!isBlankCode(s.charCodeAt(i))) return false;
    }
    return true;
  }
  var INT_MAX = 2147483647, INT_MIN = -2147483648;
  function trimFractionZeros(s) {
    if (s.indexOf(".") < 0) return s;
    var end = s.length;
    while (end > 0 && s.charAt(end - 1) === "0") end--;
    if (s.charAt(end - 1) === ".") end--;
    return s.substring(0, end);
  }
  function incrementDigits(ds) {
    var arr = ds.split(""), i = arr.length - 1;
    while (i >= 0) {
      if (arr[i] === "9") {
        arr[i] = "0";
        i--;
      } else {
        arr[i] = String.fromCharCode(arr[i].charCodeAt(0) + 1);
        return arr.join("");
      }
    }
    return "1" + arr.join("");
  }
  function cFixed(x, digits) {
    var neg = x < 0, ax = neg ? -x : x, exact;
    try {
      exact = ax.toFixed(100);
    } catch (e) {
      return x.toFixed(digits);
    }
    var dot = exact.indexOf(".");
    var intPart = exact.substring(0, dot), frac = exact.substring(dot + 1);
    var keep = frac.substring(0, digits), rest = frac.substring(digits);
    var first = rest.length ? rest.charCodeAt(0) - 48 : 0, up = false;
    if (first > 5) up = true; else if (first === 5) {
      if (/[1-9]/.test(rest.substring(1))) up = true; else {
        var lastCh = keep.length ? keep.charAt(keep.length - 1) : intPart.charAt(intPart.length - 1);
        up = (lastCh.charCodeAt(0) - 48) % 2 === 1;
      }
    }
    var all = intPart + keep;
    if (up) all = incrementDigits(all);
    var ip = all.substring(0, all.length - keep.length), fp = all.substring(all.length - keep.length);
    return (neg ? "-" : "") + (digits > 0 ? ip + "." + fp : ip);
  }
  function numberToString(x) {
    if (x !== x) return "NaN";
    if (x === Infinity) return "Infinity";
    if (x === -Infinity) return "-Infinity";
    if (x === 0) return "0";
    if (x > INT_MIN && x < INT_MAX && x === Math.floor(x)) return String(x);
    var ax = Math.abs(x);
    if (ax > 1e9 || ax < 1e-5) {
      var s = x.toExponential(14), ep = s.indexOf("e");
      var mant = trimFractionZeros(s.substring(0, ep));
      var sign = s.charAt(ep + 1), ed = s.substring(ep + 2);
      if (ed.length < 2) ed = "0" + ed;
      return mant + "e" + sign + ed;
    }
    var lg = Math.log10 ? Math.log10(ax) : Math.log(ax) / Math.LN10;
    var ip = lg >= 0 ? Math.floor(lg) : Math.ceil(lg);
    var fp = ip > 0 ? 15 - ip - 1 : 15 - ip;
    return trimFractionZeros(cFixed(x, fp));
  }
  function scanNumber(s, i, n, allowTrailing) {
    var c = s.charCodeAt(i), ret = 0, ok = false;
    if (s.charAt(i) !== "." && !(c >= 48 && c <= 57)) return null;
    while (i < n && (c = s.charCodeAt(i)) >= 48 && c <= 57) {
      ret = ret * 10 + (c - 48);
      ok = true;
      i++;
    }
    if (s.charAt(i) === ".") {
      i++;
      c = s.charCodeAt(i);
      if (!(c >= 48 && c <= 57) && !ok) return null;
      var frac = 0, fraction = 0;
      while (s.charAt(i) === "0") {
        frac++;
        i++;
      }
      var max = frac + 20;
      while (i < n && (c = s.charCodeAt(i)) >= 48 && c <= 57 && frac < max) {
        fraction = fraction * 10 + (c - 48);
        frac++;
        i++;
      }
      fraction /= Math.pow(10, frac);
      ret = ret + fraction;
      while (i < n && (c = s.charCodeAt(i)) >= 48 && c <= 57) i++;
    }
    var exponent = 0, eneg = false, hasExp = false;
    if (s.charAt(i) === "e" || s.charAt(i) === "E") {
      hasExp = true;
      i++;
      if (s.charAt(i) === "-") {
        eneg = true;
        i++;
      } else if (s.charAt(i) === "+") {
        i++;
      }
      while (i < n && (c = s.charCodeAt(i)) >= 48 && c <= 57) {
        if (exponent < 1e6) exponent = exponent * 10 + (c - 48);
        i++;
      }
    }
    return {
      value: ret,
      end: i,
      exponent: eneg ? -exponent : exponent,
      hasExp: hasExp
    };
  }
  function stringToNumber(s) {
    var n = s.length, i = 0, neg = false;
    while (i < n && isBlankCode(s.charCodeAt(i))) i++;
    if (s.charAt(i) === "-") {
      neg = true;
      i++;
    }
    var r = scanNumber(s, i, n);
    if (!r) return NaN;
    i = r.end;
    while (i < n && isBlankCode(s.charCodeAt(i))) i++;
    if (i < n) return NaN;
    var v = neg ? -r.value : r.value;
    v *= Math.pow(10, r.exponent);
    return v;
  }
  var SURROGATE_RE = /[\uD800-\uDFFF]/;
  function toChars(s) {
    if (!SURROGATE_RE.test(s)) return null;
    var out = [];
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      if (c >= 55296 && c <= 56319 && i + 1 < s.length) {
        var d = s.charCodeAt(i + 1);
        if (d >= 56320 && d <= 57343) {
          out.push(s.substring(i, i + 2));
          i++;
          continue;
        }
      }
      out.push(s.charAt(i));
    }
    return out;
  }
  function compareCodePoints(a, b) {
    if (a === b) return 0;
    if (!SURROGATE_RE.test(a) && !SURROGATE_RE.test(b)) return a < b ? -1 : 1;
    var ca = toChars(a) || a.split(""), cb = toChars(b) || b.split("");
    var n = Math.min(ca.length, cb.length);
    for (var i = 0; i < n; i++) {
      if (ca[i] !== cb[i]) {
        var x = ca[i].length === 2 ? (ca[i].charCodeAt(0) - 55296) * 1024 + ca[i].charCodeAt(1) - 56320 + 65536 : ca[i].charCodeAt(0);
        var y = cb[i].length === 2 ? (cb[i].charCodeAt(0) - 55296) * 1024 + cb[i].charCodeAt(1) - 56320 + 65536 : cb[i].charCodeAt(0);
        return x < y ? -1 : 1;
      }
    }
    return ca.length < cb.length ? -1 : ca.length > cb.length ? 1 : 0;
  }
  function parentOf(n) {
    return n.nodeType === 2 ? n.ownerElement : n.parentNode;
  }
  function rootNode(n) {
    var p;
    while (p = parentOf(n)) n = p;
    return n;
  }
  function isNsDecl(a) {
    var nm = a.name;
    return a.namespaceURI === XMLNS_NS || nm === "xmlns" || nm.substring(0, 6) === "xmlns:";
  }
  function nsOf(n) {
    return n.namespaceURI || "";
  }
  function stringValue(n) {
    switch (n.nodeType) {
     case 1:
     case 11:
      return n.textContent;

     case 9:
      return n.documentElement ? n.documentElement.textContent : "";

     case 2:
      return n.value;

     default:
      return n.nodeValue || "";
    }
  }
  var orderMap = new WeakMap;
  var orderCounter = 0;
  function numberTree(root) {
    var stack = [ root ];
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
      if (k === undefined) {
        k = ++orderCounter;
        orderMap.set(n, k);
      }
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
    idx.sort(function(a, b) {
      return keys[a] - keys[b];
    });
    var out = [], last = -1;
    for (i = 0; i < n; i++) {
      var k = keys[idx[i]];
      if (k !== last) {
        out.push(nodes[idx[i]]);
        last = k;
      }
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
    child: function(n, test, out) {
      if (n.nodeType === 2) return;
      for (var k = n.firstChild; k; k = k.nextSibling) if (test(k)) out.push(k);
    },
    descendant: function(n, test, out) {
      if (n.nodeType !== 2) descend(n, test, out);
    },
    "descendant-or-self": function(n, test, out) {
      if (test(n)) out.push(n);
      if (n.nodeType !== 2) descend(n, test, out);
    },
    parent: function(n, test, out) {
      var p = parentOf(n);
      if (p && test(p)) out.push(p);
    },
    ancestor: function(n, test, out) {
      for (var p = parentOf(n); p; p = parentOf(p)) if (test(p)) out.push(p);
    },
    "ancestor-or-self": function(n, test, out) {
      for (var p = n; p; p = parentOf(p)) if (test(p)) out.push(p);
    },
    "following-sibling": function(n, test, out) {
      if (n.nodeType === 2) return;
      for (var k = n.nextSibling; k; k = k.nextSibling) if (test(k)) out.push(k);
    },
    "preceding-sibling": function(n, test, out) {
      if (n.nodeType === 2) return;
      for (var k = n.previousSibling; k; k = k.previousSibling) if (test(k)) out.push(k);
    },
    following: function(n, test, out) {
      var a = n;
      if (n.nodeType === 2) {
        a = n.ownerElement;
        descend(a, test, out);
      }
      for (;a; a = parentOf(a)) {
        for (var s = a.nextSibling; s; s = s.nextSibling) {
          if (test(s)) out.push(s);
          descend(s, test, out);
        }
      }
    },
    preceding: function(n, test, out) {
      var a = n.nodeType === 2 ? n.ownerElement : n;
      for (;a; a = parentOf(a)) {
        for (var s = a.previousSibling; s; s = s.previousSibling) reverseDescendOrSelf(s, test, out);
      }
    },
    attribute: function(n, test, out) {
      if (n.nodeType !== 1) return;
      var at = n.attributes;
      for (var i = 0; i < at.length; i++) {
        var a = at[i];
        if (!isNsDecl(a) && test(a)) out.push(a);
      }
    },
    self: function(n, test, out) {
      if (test(n)) out.push(n);
    },
    namespace: function() {}
  };
  var REVERSE_AXES = {
    ancestor: 1,
    "ancestor-or-self": 1,
    preceding: 1,
    "preceding-sibling": 1
  };
  function Rtf(children) {
    this.children = children;
    this.domCache = null;
  }
  Rtf.prototype.text = function() {
    var s = "";
    (function walk(list) {
      for (var i = 0; i < list.length; i++) {
        var c = list[i];
        if (c.type === 3) s += c.v; else if (c.type === 1) walk(c.children);
      }
    })(this.children);
    return s;
  };
  function toString(v) {
    if (typeof v === "string") return v;
    if (typeof v === "number") return numberToString(v);
    if (typeof v === "boolean") return v ? "true" : "false";
    if (isArray(v)) return v.length ? stringValue(v[0]) : "";
    if (v instanceof Rtf) return v.text();
    return String(v);
  }
  function toNumber(v) {
    if (typeof v === "number") return v;
    if (typeof v === "boolean") return v ? 1 : 0;
    return stringToNumber(toString(v));
  }
  function toBoolean(v) {
    if (typeof v === "boolean") return v;
    if (typeof v === "number") return v !== 0 && v === v;
    if (typeof v === "string") return v.length > 0;
    if (isArray(v)) return v.length > 0;
    if (v instanceof Rtf) return true;
    return !!v;
  }
  function setStrings(v) {
    if (v instanceof Rtf) return [ v.text() ];
    var out = new Array(v.length);
    for (var i = 0; i < v.length; i++) out[i] = stringValue(v[i]);
    return out;
  }
  function hash2(s) {
    if (!s) return 0;
    var c0 = s.charCodeAt(0), b0, b1;
    if (c0 < 128) {
      b0 = c0;
      if (s.length === 1) return b0;
      var c1 = s.charCodeAt(1);
      b1 = c1 < 128 ? c1 : utf8Bytes(s.charAt(1) + (c1 >= 55296 && c1 <= 56319 ? s.charAt(2) : ""))[0];
      return b0 + (b1 << 8);
    }
    var bytes = utf8Bytes(s.charAt(0) + (c0 >= 55296 && c0 <= 56319 ? s.charAt(1) : ""));
    return bytes[0] + (bytes[1] << 8);
  }
  function nodeHash(n) {
    if (n.nodeType === 9 || n.nodeType === 11) {
      var t = null, k;
      for (k = n.firstChild; k; k = k.nextSibling) if (k.nodeType === 1) {
        t = k;
        break;
      }
      if (!t) t = n.firstChild;
      if (!t) return 0;
      n = t;
    }
    switch (n.nodeType) {
     case 1:
      return hash2(n.textContent);

     case 2:
      return hash2(n.value);

     case 3:
     case 4:
     case 7:
     case 8:
      return hash2(n.nodeValue);
    }
    return 0;
  }
  function rtfHash(rtf) {
    var ch = rtf.children, t = null, i;
    for (i = 0; i < ch.length; i++) if (ch[i].type === 1) {
      t = ch[i];
      break;
    }
    if (!t) t = ch[0];
    if (!t) return 0;
    if (t.type === 1) return hash2(new Rtf(t.children).text());
    return hash2(t.v);
  }
  function setItems(v) {
    if (v instanceof Rtf) return [ {
      s: v.text(),
      h: rtfHash(v)
    } ];
    var out = new Array(v.length);
    for (var i = 0; i < v.length; i++) out[i] = {
      s: stringValue(v[i]),
      h: nodeHash(v[i])
    };
    return out;
  }
  function relop(op, x, y) {
    switch (op) {
     case "<":
      return x < y;

     case "<=":
      return x <= y;

     case ">":
      return x > y;

     default:
      return x >= y;
    }
  }
  function comparePrimitive(op, a, b) {
    if (op === "=" || op === "!=") {
      var r;
      if (typeof a === "boolean" || typeof b === "boolean") r = toBoolean(a) === toBoolean(b); else if (typeof a === "number" || typeof b === "number") r = toNumber(a) === toNumber(b); else r = toString(a) === toString(b);
      return op === "=" ? r : !r;
    }
    return relop(op, toNumber(a), toNumber(b));
  }
  function compareValues(op, a, b) {
    var aSet = isArray(a) || a instanceof Rtf, bSet = isArray(b) || b instanceof Rtf;
    var eq = op === "=" || op === "!=";
    var i, j, sa, sb;
    if (aSet && bSet) {
      if (eq) {
        var ia = setItems(a), ib = setItems(b), want = op === "=";
        for (i = 0; i < ia.length; i++) for (j = 0; j < ib.length; j++) {
          if ((ia[i].h === ib[j].h && ia[i].s === ib[j].s) === want) return true;
        }
        return false;
      }
      sa = setStrings(a);
      sb = setStrings(b);
      for (i = 0; i < sa.length; i++) {
        var na = stringToNumber(sa[i]);
        for (j = 0; j < sb.length; j++) if (relop(op, na, stringToNumber(sb[j]))) return true;
      }
      return false;
    }
    if (aSet || bSet) {
      var set = aSet ? a : b, other = aSet ? b : a, swapped = !aSet;
      if (typeof other === "boolean") {
        var sbool = toBoolean(set);
        return swapped ? comparePrimitive(op, other, sbool) : comparePrimitive(op, sbool, other);
      }
      if (typeof other !== "number" && eq) {
        var items = setItems(set), os = toString(other), oh = hash2(os), wantEq = op === "=";
        for (i = 0; i < items.length; i++) {
          if ((items[i].h === oh && items[i].s === os) === wantEq) return true;
        }
        return false;
      }
      var strs = setStrings(set);
      for (i = 0; i < strs.length; i++) {
        var left = stringToNumber(strs[i]), right = toNumber(other);
        if (swapped) {
          var tmp = left;
          left = right;
          right = tmp;
        }
        if (eq ? left === right === (op === "=") : relop(op, left, right)) return true;
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
  var NAME_START_RE = /[A-Za-z_\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u02FF\u0370-\u037D\u037F-\u1FFF\u200C\u200D\u2070-\u218F\u2C00-\u2FEF\u3001-\uD7FF\uD800-\uDFFF\uF900-\uFDCF\uFDF0-\uFFFD]/;
  var NAME_CHAR_RE = /[-.0-9A-Za-z_\u00B7\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u037D\u037F-\u1FFF\u200C\u200D\u203F\u2040\u2070-\u218F\u2C00-\u2FEF\u3001-\uD7FF\uD800-\uDFFF\uF900-\uFDCF\uFDF0-\uFFFD]/;
  var AXIS_NAMES = {
    ancestor: 1,
    "ancestor-or-self": 1,
    attribute: 1,
    child: 1,
    descendant: 1,
    "descendant-or-self": 1,
    following: 1,
    "following-sibling": 1,
    namespace: 1,
    parent: 1,
    preceding: 1,
    "preceding-sibling": 1,
    self: 1
  };
  var NODE_TYPE_NAMES = {
    comment: 1,
    text: 1,
    "processing-instruction": 1,
    node: 1
  };
  var OPERATOR_NAMES = {
    and: 1,
    or: 1,
    mod: 1,
    div: 1
  };
  function isNameStart(ch) {
    return ch !== "" && NAME_START_RE.test(ch);
  }
  function isNameChar(ch) {
    return ch !== "" && NAME_CHAR_RE.test(ch);
  }
  function xpathError(expr, msg) {
    return XsltError("XPath error: " + msg + ' in "' + expr + '"');
  }
  function tokenize(expr) {
    var toks = [], i = 0, len = expr.length;
    function prevAllowsOperator() {
      if (!toks.length) return false;
      var p = toks[toks.length - 1];
      if (p.type === "op") return false;
      if (p.type === "punct" && (p.value === "@" || p.value === "::" || p.value === "(" || p.value === "[" || p.value === ",")) return false;
      return true;
    }
    while (i < len) {
      var ch = expr.charAt(i);
      if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
        i++;
        continue;
      }
      var two = expr.substr(i, 2);
      if (two === "//") {
        toks.push({
          type: "op",
          value: "//"
        });
        i += 2;
        continue;
      }
      if (two === "::") {
        toks.push({
          type: "punct",
          value: "::"
        });
        i += 2;
        continue;
      }
      if (two === "!=" || two === "<=" || two === ">=") {
        toks.push({
          type: "op",
          value: two
        });
        i += 2;
        continue;
      }
      var nextCode = expr.charCodeAt(i + 1);
      if (ch >= "0" && ch <= "9" || ch === "." && nextCode >= 48 && nextCode <= 57) {
        var r = scanNumber(expr, i, len);
        if (!r) throw xpathError(expr, "invalid number");
        toks.push({
          type: "number",
          value: r.value * Math.pow(10, r.exponent)
        });
        i = r.end;
        continue;
      }
      if (two === "..") {
        toks.push({
          type: "punct",
          value: ".."
        });
        i += 2;
        continue;
      }
      if (ch === "(" || ch === ")" || ch === "[" || ch === "]" || ch === "@" || ch === "," || ch === ".") {
        toks.push({
          type: "punct",
          value: ch
        });
        i++;
        continue;
      }
      if (ch === "/" || ch === "|" || ch === "+" || ch === "-" || ch === "=" || ch === "<" || ch === ">") {
        toks.push({
          type: "op",
          value: ch
        });
        i++;
        continue;
      }
      if (ch === "*") {
        if (prevAllowsOperator()) toks.push({
          type: "op",
          value: "*"
        }); else toks.push({
          type: "name",
          prefix: null,
          local: "*"
        });
        i++;
        continue;
      }
      if (ch === '"' || ch === "'") {
        var end = expr.indexOf(ch, i + 1);
        if (end < 0) throw xpathError(expr, "unterminated string literal");
        toks.push({
          type: "literal",
          value: expr.substring(i + 1, end)
        });
        i = end + 1;
        continue;
      }
      if (ch === "$") {
        i++;
        var q = readQName();
        if (!q) throw xpathError(expr, "variable name expected");
        toks.push({
          type: "var",
          prefix: q.prefix,
          local: q.local
        });
        continue;
      }
      if (isNameStart(ch)) {
        var qn = readQName();
        if (qn.local === "*") {
          toks.push({
            type: "name",
            prefix: qn.prefix,
            local: "*"
          });
          continue;
        }
        if (qn.prefix === null && prevAllowsOperator() && OPERATOR_NAMES[qn.local]) {
          toks.push({
            type: "op",
            value: qn.local
          });
          continue;
        }
        var j = i;
        while (j < len && /\s/.test(expr.charAt(j))) j++;
        if (expr.charAt(j) === "(") {
          if (qn.prefix === null && NODE_TYPE_NAMES[qn.local]) toks.push({
            type: "nodetype",
            value: qn.local
          }); else toks.push({
            type: "func",
            prefix: qn.prefix,
            local: qn.local
          });
          continue;
        }
        if (qn.prefix === null && expr.substr(j, 2) === "::") {
          toks.push({
            type: "axis",
            value: qn.local
          });
          continue;
        }
        toks.push({
          type: "name",
          prefix: qn.prefix,
          local: qn.local
        });
        continue;
      }
      throw xpathError(expr, 'unexpected character "' + ch + '"');
    }
    return toks;
    function readQName() {
      if (!isNameStart(expr.charAt(i))) return null;
      var s = i;
      i++;
      while (i < len && isNameChar(expr.charAt(i))) i++;
      var first = expr.substring(s, i);
      if (expr.charAt(i) === ":" && expr.charAt(i + 1) !== ":") {
        if (expr.charAt(i + 1) === "*") {
          i += 2;
          return {
            prefix: first,
            local: "*"
          };
        }
        if (isNameStart(expr.charAt(i + 1))) {
          var s2 = i + 1;
          i += 2;
          while (i < len && isNameChar(expr.charAt(i))) i++;
          return {
            prefix: first,
            local: expr.substring(s2, i)
          };
        }
      }
      return {
        prefix: null,
        local: first
      };
    }
  }
  var DESC_OR_SELF_STEP = {
    axis: "descendant-or-self",
    test: {
      t: "node"
    },
    preds: []
  };
  function Parser(expr) {
    this.expr = expr;
    this.toks = tokenize(expr);
    this.i = 0;
  }
  Parser.prototype.peek = function() {
    return this.toks[this.i];
  };
  Parser.prototype.next = function() {
    return this.toks[this.i++];
  };
  Parser.prototype.isOp = function(v) {
    var t = this.toks[this.i];
    return !!t && t.type === "op" && t.value === v;
  };
  Parser.prototype.isPunct = function(v) {
    var t = this.toks[this.i];
    return !!t && t.type === "punct" && t.value === v;
  };
  Parser.prototype.fail = function(msg) {
    throw xpathError(this.expr, msg);
  };
  Parser.prototype.expectPunct = function(v) {
    var t = this.next();
    if (!t || t.type !== "punct" || t.value !== v) this.fail('"' + v + '" expected');
  };
  Parser.prototype.parseAll = function() {
    if (!this.toks.length) this.fail("empty expression");
    var e = this.parseOr();
    if (this.i < this.toks.length) this.fail("unexpected token after end of expression");
    return e;
  };
  Parser.prototype.binary = function(sub, ops, kind) {
    var left = sub.call(this);
    for (;;) {
      var t = this.peek();
      if (!t || t.type !== "op" || !ops[t.value]) return left;
      this.next();
      left = {
        k: kind,
        op: t.value,
        a: left,
        b: sub.call(this)
      };
    }
  };
  Parser.prototype.parseOr = function() {
    return this.binary(this.parseAnd, {
      or: 1
    }, "or");
  };
  Parser.prototype.parseAnd = function() {
    return this.binary(this.parseEquality, {
      and: 1
    }, "and");
  };
  Parser.prototype.parseEquality = function() {
    return this.binary(this.parseRelational, {
      "=": 1,
      "!=": 1
    }, "cmp");
  };
  Parser.prototype.parseRelational = function() {
    return this.binary(this.parseAdditive, {
      "<": 1,
      "<=": 1,
      ">": 1,
      ">=": 1
    }, "cmp");
  };
  Parser.prototype.parseAdditive = function() {
    return this.binary(this.parseMultiplicative, {
      "+": 1,
      "-": 1
    }, "arith");
  };
  Parser.prototype.parseMultiplicative = function() {
    return this.binary(this.parseUnary, {
      "*": 1,
      div: 1,
      mod: 1
    }, "arith");
  };
  Parser.prototype.parseUnary = function() {
    if (this.isOp("-")) {
      this.next();
      return {
        k: "neg",
        a: this.parseUnary()
      };
    }
    return this.parseUnion();
  };
  Parser.prototype.parseUnion = function() {
    var left = this.parsePath();
    while (this.isOp("|")) {
      this.next();
      left = {
        k: "union",
        a: left,
        b: this.parsePath()
      };
    }
    return left;
  };
  Parser.prototype.parsePath = function() {
    var t = this.peek();
    if (!t) this.fail("unexpected end of expression");
    if (t.type === "op" && (t.value === "/" || t.value === "//")) return this.parseLocationPath();
    if (t.type === "var" || t.type === "literal" || t.type === "number" || t.type === "func" || t.type === "punct" && t.value === "(") {
      var filter = this.parseFilter();
      if (this.isOp("/") || this.isOp("//")) {
        return {
          k: "path",
          filter: filter,
          absolute: false,
          steps: this.parseRelativeSteps(true)
        };
      }
      return filter;
    }
    return this.parseLocationPath();
  };
  Parser.prototype.startsStep = function(t) {
    if (!t) return false;
    if (t.type === "name" || t.type === "axis" || t.type === "nodetype") return true;
    return t.type === "punct" && (t.value === "." || t.value === ".." || t.value === "@");
  };
  Parser.prototype.parseRelativeSteps = function(leadingSep) {
    var steps = [];
    if (!leadingSep) steps.push(this.parseStep());
    while (this.isOp("/") || this.isOp("//")) {
      if (this.next().value === "//") steps.push(DESC_OR_SELF_STEP);
      steps.push(this.parseStep());
    }
    return steps;
  };
  Parser.prototype.parseLocationPath = function() {
    var steps = [], absolute = false;
    if (this.isOp("/")) {
      this.next();
      absolute = true;
      if (!this.startsStep(this.peek())) return {
        k: "path",
        filter: null,
        absolute: true,
        steps: []
      };
    } else if (this.isOp("//")) {
      this.next();
      absolute = true;
      steps.push(DESC_OR_SELF_STEP);
    }
    steps = steps.concat(this.parseRelativeSteps(false));
    return {
      k: "path",
      filter: null,
      absolute: absolute,
      steps: steps
    };
  };
  Parser.prototype.parseStep = function() {
    var t = this.peek();
    if (!t) this.fail("location step expected");
    if (t.type === "punct" && t.value === ".") {
      this.next();
      return {
        axis: "self",
        test: {
          t: "node"
        },
        preds: []
      };
    }
    if (t.type === "punct" && t.value === "..") {
      this.next();
      return {
        axis: "parent",
        test: {
          t: "node"
        },
        preds: []
      };
    }
    var axis = "child";
    if (t.type === "axis") {
      this.next();
      if (!AXIS_NAMES[t.value]) this.fail('unknown axis "' + t.value + '"');
      axis = t.value;
      this.expectPunct("::");
    } else if (t.type === "punct" && t.value === "@") {
      this.next();
      axis = "attribute";
    }
    var test = this.parseNodeTest();
    var preds = [];
    while (this.isPunct("[")) {
      this.next();
      preds.push(this.parseOr());
      this.expectPunct("]");
    }
    return {
      axis: axis,
      test: test,
      preds: preds
    };
  };
  Parser.prototype.parseNodeTest = function() {
    var t = this.next();
    if (!t) this.fail("node test expected");
    if (t.type === "name") {
      if (t.local === "*") return t.prefix === null ? {
        t: "any"
      } : {
        t: "nsany",
        prefix: t.prefix
      };
      return {
        t: "name",
        prefix: t.prefix,
        local: t.local
      };
    }
    if (t.type === "nodetype") {
      this.expectPunct("(");
      if (t.value === "processing-instruction") {
        var lt = this.peek();
        if (lt && lt.type === "literal") {
          this.next();
          this.expectPunct(")");
          return {
            t: "pi",
            target: lt.value
          };
        }
        this.expectPunct(")");
        return {
          t: "pi"
        };
      }
      this.expectPunct(")");
      return {
        t: t.value
      };
    }
    this.fail("node test expected");
  };
  Parser.prototype.parseFilter = function() {
    var prim = this.parsePrimary();
    var preds = [];
    while (this.isPunct("[")) {
      this.next();
      preds.push(this.parseOr());
      this.expectPunct("]");
    }
    return preds.length ? {
      k: "filter",
      prim: prim,
      preds: preds
    } : prim;
  };
  Parser.prototype.parsePrimary = function() {
    var t = this.next();
    if (t.type === "var") return {
      k: "var",
      prefix: t.prefix,
      local: t.local
    };
    if (t.type === "literal") return {
      k: "lit",
      v: t.value
    };
    if (t.type === "number") return {
      k: "num",
      v: t.value
    };
    if (t.type === "punct" && t.value === "(") {
      var e = this.parseOr();
      this.expectPunct(")");
      return {
        k: "group",
        a: e
      };
    }
    if (t.type === "func") {
      this.expectPunct("(");
      var args = [];
      if (!this.isPunct(")")) {
        args.push(this.parseOr());
        while (this.isPunct(",")) {
          this.next();
          args.push(this.parseOr());
        }
      }
      this.expectPunct(")");
      return {
        k: "fn",
        prefix: t.prefix,
        local: t.local,
        args: args
      };
    }
    this.fail("expression expected");
  };
  function parsePattern(expr) {
    var p = new Parser(expr);
    var alts = [];
    for (;;) {
      alts.push(parsePatternAlt(p));
      if (p.isOp("|")) {
        p.next();
        continue;
      }
      break;
    }
    if (p.i < p.toks.length) p.fail("unexpected token at end of pattern");
    return alts;
  }
  function parsePatternAlt(p) {
    var alt = {
      anchor: null,
      anchorArgs: null,
      steps: []
    };
    var t = p.peek();
    var sep = null;
    if (t && t.type === "op" && t.value === "/") {
      p.next();
      alt.anchor = "root";
      if (!p.startsStep(p.peek())) return alt;
      sep = "/";
    } else if (t && t.type === "op" && t.value === "//") {
      p.next();
      sep = null;
    } else if (t && t.type === "func" && t.prefix === null && (t.local === "id" || t.local === "key")) {
      p.next();
      p.expectPunct("(");
      var args = [];
      for (;;) {
        var lit = p.next();
        if (!lit || lit.type !== "literal") p.fail(t.local + "() in a pattern accepts only a string literal");
        args.push(lit.value);
        if (p.isPunct(",")) {
          p.next();
          continue;
        }
        break;
      }
      p.expectPunct(")");
      alt.anchor = t.local;
      alt.anchorArgs = args;
      if (p.isOp("/") || p.isOp("//")) sep = p.next().value; else return alt;
    }
    for (;;) {
      var step = p.parseStep();
      if (step.axis !== "child" && step.axis !== "attribute") {
        if (!(step.axis === "self" && step.test.t === "node" && !step.preds.length)) {
          p.fail("only the child and attribute axes are allowed in patterns");
        }
      }
      step.sep = sep;
      alt.steps.push(step);
      if (p.isOp("/") || p.isOp("//")) {
        sep = p.next().value;
        continue;
      }
      break;
    }
    return alt;
  }
  function asNodeSet(v, what) {
    if (isArray(v)) return v;
    throw XsltError("XPath error (Invalid type): " + what + " requires a node-set" + (v instanceof Rtf ? "; convert the result tree fragment with exsl:node-set()" : ""));
  }
  function asNodeSetOrRtf(v, what) {
    if (v instanceof Rtf) return rtfNodeSet(v);
    return asNodeSet(v, what);
  }
  function applyPredicate(nodes, pred, x) {
    var size = nodes.length;
    if (pred.index !== undefined) {
      var k = pred.index;
      return k >= 1 && k <= size && k === Math.floor(k) ? [ nodes[k - 1] ] : [];
    }
    var out = [], fn = pred.fn;
    for (var i = 0; i < size; i++) {
      var r = fn({
        n: nodes[i],
        p: i + 1,
        s: size,
        x: x
      });
      if (typeof r === "number" ? r === i + 1 : toBoolean(r)) out.push(nodes[i]);
    }
    return out;
  }
  function compilePredicate(ast, cc) {
    if (ast.k === "num") return {
      index: ast.v,
      ast: ast
    };
    return {
      fn: compileExpr(ast, cc),
      ast: ast
    };
  }
  function makeNodeTest(test, axis, cc) {
    var principal = axis === "attribute" ? 2 : 1;
    switch (test.t) {
     case "any":
      return function(n) {
        return n.nodeType === principal;
      };

     case "nsany":
      {
        var u1 = cc.ns(test.prefix);
        return function(n) {
          return n.nodeType === principal && (n.namespaceURI || "") === u1;
        };
      }

     case "name":
      {
        var u2 = test.prefix ? cc.ns(test.prefix) : "", local = test.local;
        return function(n) {
          return n.nodeType === principal && n.localName === local && (n.namespaceURI || "") === u2;
        };
      }

     case "node":
      return function(n) {
        return n.nodeType !== 10;
      };

     case "text":
      return function(n) {
        return n.nodeType === 3 || n.nodeType === 4;
      };

     case "comment":
      return function(n) {
        return n.nodeType === 8;
      };

     case "pi":
      {
        var target = test.target;
        return function(n) {
          return n.nodeType === 7 && (target === undefined || n.target === target);
        };
      }
    }
    throw XsltError("unknown node test");
  }
  function compileStep(step, cc) {
    var axis = AXES[step.axis];
    var test = makeNodeTest(step.test, step.axis, cc);
    var preds = [];
    for (var i = 0; i < step.preds.length; i++) preds.push(compilePredicate(step.preds[i], cc));
    var reverse = !!REVERSE_AXES[step.axis];
    var np = preds.length;
    return function(input, x) {
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
    return function(c) {
      var nodes;
      if (filter) nodes = asNodeSet(filter(c), "path step"); else nodes = [ absolute ? rootNode(c.n) : c.n ];
      for (var i = 0; i < ns && nodes.length; i++) nodes = steps[i](nodes, c.x);
      return nodes;
    };
  }
  function varKey(uri, local) {
    return uri ? "{" + uri + "}" + local : local;
  }
  function lookupVar(x, key) {
    var vars = x.vars;
    if (vars && key in vars) return vars[key];
    return x.t.globalValue(key);
  }
  function compileExpr(ast, cc) {
    var a, b;
    switch (ast.k) {
     case "or":
      a = compileExpr(ast.a, cc);
      b = compileExpr(ast.b, cc);
      return function(c) {
        return toBoolean(a(c)) || toBoolean(b(c));
      };

     case "and":
      a = compileExpr(ast.a, cc);
      b = compileExpr(ast.b, cc);
      return function(c) {
        return toBoolean(a(c)) && toBoolean(b(c));
      };

     case "cmp":
      {
        var op = ast.op;
        a = compileExpr(ast.a, cc);
        b = compileExpr(ast.b, cc);
        return function(c) {
          return compareValues(op, a(c), b(c));
        };
      }

     case "arith":
      {
        a = compileExpr(ast.a, cc);
        b = compileExpr(ast.b, cc);
        switch (ast.op) {
         case "+":
          return function(c) {
            return toNumber(a(c)) + toNumber(b(c));
          };

         case "-":
          return function(c) {
            return toNumber(a(c)) - toNumber(b(c));
          };

         case "*":
          return function(c) {
            return toNumber(a(c)) * toNumber(b(c));
          };

         case "div":
          return function(c) {
            return toNumber(a(c)) / toNumber(b(c));
          };

         default:
          return function(c) {
            return toNumber(a(c)) % toNumber(b(c));
          };
        }
      }

     case "neg":
      a = compileExpr(ast.a, cc);
      return function(c) {
        return -toNumber(a(c));
      };

     case "union":
      a = compileExpr(ast.a, cc);
      b = compileExpr(ast.b, cc);
      return function(c) {
        return unionNodes(asNodeSet(a(c), "|"), asNodeSet(b(c), "|"));
      };

     case "group":
      return compileExpr(ast.a, cc);

     case "lit":
      {
        var sv = ast.v;
        return function() {
          return sv;
        };
      }

     case "num":
      {
        var nv = ast.v;
        return function() {
          return nv;
        };
      }

     case "var":
      {
        var key = varKey(ast.prefix ? cc.ns(ast.prefix) : "", ast.local);
        return function(c) {
          return lookupVar(c.x, key);
        };
      }

     case "filter":
      {
        var prim = compileExpr(ast.prim, cc), preds = [];
        for (var i = 0; i < ast.preds.length; i++) preds.push(compilePredicate(ast.preds[i], cc));
        return function(c) {
          var v = asNodeSet(prim(c), "predicate");
          for (var i = 0; i < preds.length && v.length; i++) v = applyPredicate(v, preds[i], c.x);
          return v;
        };
      }

     case "path":
      return compilePath(ast, cc);

     case "fn":
      return compileFunction(ast, cc);
    }
    throw XsltError("XPath internal error: " + ast.k);
  }
  function compileXPath(expr, cc) {
    var cache = cc.cache;
    var ck = cc.nsKey + "\0" + expr;
    if (cache && hasOwn.call(cache, ck)) return cache[ck];
    var fn;
    try {
      fn = compileExpr(new Parser(expr).parseAll(), cc);
    } catch (e) {
      if (e.isXsltError && e.message.indexOf(expr) < 0) e.message += ' \u2014 "' + expr + '"';
      throw e;
    }
    if (cache) cache[ck] = fn;
    return fn;
  }
  function evalExpr(fn, x) {
    return fn({
      n: x.node,
      p: x.pos,
      s: x.size,
      x: x
    });
  }
  var FUNCS = {};
  function defFn(name, min, max, fn) {
    FUNCS[name] = {
      min: min,
      max: max,
      fn: fn
    };
  }
  function firstNode(v, what) {
    var ns = asNodeSetOrRtf(v, what);
    return ns.length ? ns[0] : null;
  }
  function nodeLocalName(n) {
    if (n.nodeType === 1 || n.nodeType === 2) return n.localName || n.nodeName;
    if (n.nodeType === 7) return n.target;
    return "";
  }
  function nodeQName(n) {
    if (n.nodeType === 1 || n.nodeType === 2) return n.prefix ? n.prefix + ":" + n.localName : n.localName || n.nodeName;
    if (n.nodeType === 7) return n.target;
    return "";
  }
  function xpathRound(f) {
    if (f !== f || f === Infinity || f === -Infinity) return f;
    if (f >= -.5 && f < .5) return f * 0;
    var r = Math.floor(f);
    if (f - r >= .5) r += 1;
    return r;
  }
  function charsOf(s) {
    return toChars(s) || s.split("");
  }
  function normalizeSpace(s) {
    var out = "", inSpace = false, started = false;
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      if (isBlankCode(c)) {
        inSpace = true;
        continue;
      }
      if (inSpace && started) out += " ";
      out += s.charAt(i);
      inSpace = false;
      started = true;
    }
    return out;
  }
  defFn("last", 0, 0, function(c) {
    return c.s;
  });
  defFn("position", 0, 0, function(c) {
    return c.p;
  });
  defFn("count", 1, 1, function(c, a) {
    return asNodeSetOrRtf(a[0](c), "count()").length;
  });
  defFn("id", 1, 1, function(c, a) {
    var v = a[0](c), tokens = [];
    if (isArray(v)) {
      for (var i = 0; i < v.length; i++) tokens = tokens.concat(normalizeSpace(stringValue(v[i])).split(" "));
    } else tokens = normalizeSpace(toString(v)).split(" ");
    var root = rootNode(c.n), found = [];
    var want = {};
    for (var j = 0; j < tokens.length; j++) if (tokens[j]) want[tokens[j]] = true;
    (function walk(n) {
      for (var k = n.firstChild; k; k = k.nextSibling) {
        if (k.nodeType === 1) {
          var idv = k.getAttributeNS(XML_NS, "id");
          if (idv && want[idv]) found.push(k);
          walk(k);
        }
      }
    })(root);
    return found;
  });
  defFn("local-name", 0, 1, function(c, a) {
    var n = a.length ? firstNode(a[0](c), "local-name()") : c.n;
    return n ? nodeLocalName(n) : "";
  });
  defFn("namespace-uri", 0, 1, function(c, a) {
    var n = a.length ? firstNode(a[0](c), "namespace-uri()") : c.n;
    return n && (n.nodeType === 1 || n.nodeType === 2) ? nsOf(n) : "";
  });
  defFn("name", 0, 1, function(c, a) {
    var n = a.length ? firstNode(a[0](c), "name()") : c.n;
    return n ? nodeQName(n) : "";
  });
  defFn("string", 0, 1, function(c, a) {
    return a.length ? toString(a[0](c)) : stringValue(c.n);
  });
  defFn("concat", 2, Infinity, function(c, a) {
    var s = "";
    for (var i = 0; i < a.length; i++) s += toString(a[i](c));
    return s;
  });
  defFn("starts-with", 2, 2, function(c, a) {
    var s = toString(a[0](c)), t = toString(a[1](c));
    return s.substring(0, t.length) === t;
  });
  defFn("contains", 2, 2, function(c, a) {
    return toString(a[0](c)).indexOf(toString(a[1](c))) >= 0;
  });
  defFn("substring-before", 2, 2, function(c, a) {
    var s = toString(a[0](c)), t = toString(a[1](c)), i = s.indexOf(t);
    return i < 0 ? "" : s.substring(0, i);
  });
  defFn("substring-after", 2, 2, function(c, a) {
    var s = toString(a[0](c)), t = toString(a[1](c)), i = s.indexOf(t);
    return i < 0 ? "" : s.substring(i + t.length);
  });
  defFn("substring", 2, 3, function(c, a) {
    var s = toString(a[0](c)), start = xpathRound(toNumber(a[1](c)));
    var end = a.length > 2 ? start + xpathRound(toNumber(a[2](c))) : Infinity;
    if (start !== start || end !== end) return "";
    var chars = toChars(s), len = chars ? chars.length : s.length;
    var from = Math.max(start, 1), to = Math.min(end, len + 1);
    if (!(from < to)) return "";
    from = Math.ceil(from);
    to = Math.ceil(to);
    return chars ? chars.slice(from - 1, to - 1).join("") : s.substring(from - 1, to - 1);
  });
  defFn("string-length", 0, 1, function(c, a) {
    var s = a.length ? toString(a[0](c)) : stringValue(c.n);
    var chars = toChars(s);
    return chars ? chars.length : s.length;
  });
  defFn("normalize-space", 0, 1, function(c, a) {
    return normalizeSpace(a.length ? toString(a[0](c)) : stringValue(c.n));
  });
  defFn("translate", 3, 3, function(c, a) {
    var s = charsOf(toString(a[0](c))), from = charsOf(toString(a[1](c))), to = charsOf(toString(a[2](c)));
    var map = {}, out = "";
    for (var i = 0; i < from.length; i++) if (!hasOwn.call(map, from[i])) map[from[i]] = i < to.length ? to[i] : "";
    for (var j = 0; j < s.length; j++) out += hasOwn.call(map, s[j]) ? map[s[j]] : s[j];
    return out;
  });
  defFn("boolean", 1, 1, function(c, a) {
    return toBoolean(a[0](c));
  });
  defFn("not", 1, 1, function(c, a) {
    return !toBoolean(a[0](c));
  });
  defFn("true", 0, 0, function() {
    return true;
  });
  defFn("false", 0, 0, function() {
    return false;
  });
  defFn("lang", 1, 1, function(c, a) {
    var want = toString(a[0](c)).toLowerCase();
    for (var n = c.n; n; n = parentOf(n)) {
      if (n.nodeType === 1 && n.hasAttributeNS(XML_NS, "lang")) {
        var l = n.getAttributeNS(XML_NS, "lang").toLowerCase();
        return l === want || l.substring(0, want.length) === want && l.charAt(want.length) === "-";
      }
    }
    return false;
  });
  defFn("number", 0, 1, function(c, a) {
    return a.length ? toNumber(a[0](c)) : stringToNumber(stringValue(c.n));
  });
  defFn("sum", 1, 1, function(c, a) {
    var v = a[0](c);
    if (v instanceof Rtf) return stringToNumber(v.text());
    var ns = asNodeSet(v, "sum()"), s = 0;
    for (var i = 0; i < ns.length; i++) s += stringToNumber(stringValue(ns[i]));
    return s;
  });
  defFn("floor", 1, 1, function(c, a) {
    return Math.floor(toNumber(a[0](c)));
  });
  defFn("ceiling", 1, 1, function(c, a) {
    return Math.ceil(toNumber(a[0](c)));
  });
  defFn("round", 1, 1, function(c, a) {
    return xpathRound(toNumber(a[0](c)));
  });
  defFn("current", 0, 0, function(c) {
    return [ c.x.node ];
  });
  defFn("unparsed-entity-uri", 1, 1, function() {
    return "";
  });
  defFn("generate-id", 0, 1, function(c, a) {
    var n = a.length ? firstNode(a[0](c), "generate-id()") : c.n;
    return n ? "idp" + orderKey(n) : "";
  });
  defFn("system-property", 1, 1, function(c, a, cc) {
    var q = splitQName(toString(a[0](c)));
    var uri = q.prefix ? cc.ns(q.prefix) : "";
    if (uri !== XSL_NS) return "";
    if (q.local === "version") return "1.0";
    if (q.local === "vendor") return "libxslt";
    if (q.local === "vendor-url") return "http://xmlsoft.org/XSLT/";
    return "";
  });
  defFn("function-available", 1, 1, function(c, a, cc) {
    var q = splitQName(toString(a[0](c)));
    if (!q.prefix) return hasOwn.call(FUNCS, q.local);
    return hasOwn.call(EXT_FUNCS, varKey(cc.ns(q.prefix), q.local));
  });
  defFn("element-available", 1, 1, function(c, a, cc) {
    var q = splitQName(toString(a[0](c)));
    var uri = q.prefix ? cc.ns(q.prefix) : cc.ns("") || "";
    return uri === XSL_NS && hasOwn.call(XSL_INSTRUCTIONS, q.local);
  });
  defFn("key", 2, 2, function(c, a, cc) {
    var q = splitQName(toString(a[0](c)));
    var name = varKey(q.prefix ? cc.ns(q.prefix) : "", q.local);
    return c.x.t.keyLookup(name, a[1](c), c.n);
  });
  defFn("document", 1, 2, function(c, a, cc) {
    return c.x.t.documentFn(a[0](c), a.length > 1 ? asNodeSet(a[1](c), "document()") : null, cc);
  });
  defFn("format-number", 2, 3, function(c, a, cc) {
    var num = toNumber(a[0](c)), pattern = toString(a[1](c));
    var fmtName = "";
    if (a.length > 2) {
      var q = splitQName(toString(a[2](c)));
      fmtName = varKey(q.prefix ? cc.ns(q.prefix) : "", q.local);
    }
    var df = cc.sheet.decimalFormats[fmtName];
    if (!df) {
      if (fmtName) throw XsltError('format-number: unknown decimal-format "' + fmtName + '"');
      df = DEFAULT_DECIMAL_FORMAT;
    }
    return formatNumber(num, pattern, df);
  });
  var EXT_FUNCS = {};
  EXT_FUNCS[varKey(EXSLT_COMMON_NS, "node-set")] = {
    min: 1,
    max: 1,
    fn: nodeSetFn
  };
  function nodeSetFn(c, a) {
    var v = a[0](c);
    if (isArray(v)) return v;
    if (v instanceof Rtf) return rtfNodeSet(v);
    var doc = scratchDocument(), frag = doc.createDocumentFragment(), text = doc.createTextNode(toString(v));
    frag.appendChild(text);
    return [ text ];
  }
  function splitQName(s) {
    s = normalizeSpace(s);
    var i = s.indexOf(":");
    return i < 0 ? {
      prefix: null,
      local: s
    } : {
      prefix: s.substring(0, i),
      local: s.substring(i + 1)
    };
  }
  function compileFunction(ast, cc) {
    var def, label = (ast.prefix ? ast.prefix + ":" : "") + ast.local + "()";
    if (ast.prefix) def = EXT_FUNCS[varKey(cc.ns(ast.prefix), ast.local)]; else def = FUNCS[ast.local];
    if (!def) return function() {
      throw XsltError("unregistered function: " + label);
    };
    var n = ast.args.length;
    if (n < def.min || n > def.max) return function() {
      throw XsltError("wrong number of arguments for " + label);
    };
    var args = [];
    for (var i = 0; i < n; i++) args.push(compileExpr(ast.args[i], cc));
    var impl = def.fn;
    return function(c) {
      return impl(c, args, cc);
    };
  }
  function rtfNodeSet(rtf) {
    if (rtf.domCache) return rtf.domCache;
    var doc = scratchDocument(), frag = doc.createDocumentFragment();
    appendResultToDom(doc, frag, rtf.children);
    rtf.domCache = [ frag ];
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
        node = c.ns ? doc.createElementNS(c.ns, c.prefix ? c.prefix + ":" + c.local : c.local) : doc.createElementNS(null, c.local);
        for (var j = 0; j < c.attrs.length; j++) {
          var at = c.attrs[j];
          if (at.ns) node.setAttributeNS(at.ns, at.prefix ? at.prefix + ":" + at.local : at.local, at.value); else node.setAttribute(at.local, at.value);
        }
        appendResultToDom(doc, node, c.children);
      } else if (c.type === 3) node = doc.createTextNode(c.v); else if (c.type === 8) node = doc.createComment(c.v); else if (c.type === 7) node = doc.createProcessingInstruction(c.target, c.v);
      if (node) parent.appendChild(node);
    }
  }
  var DEFAULT_DECIMAL_FORMAT = {
    decimalPoint: ".",
    grouping: ",",
    percent: "%",
    permille: "\u2030",
    zeroDigit: "0",
    digit: "#",
    patternSeparator: ";",
    minusSign: "-",
    infinity: "Infinity",
    noNumber: "NaN"
  };
  function formatDecimalDigits(number, zeroChar, width, perGroup, groupChar) {
    var zero = zeroChar.charCodeAt(0), parts = [], i = 0;
    for (;;) {
      if (i >= width && Math.abs(number) < 1) break;
      if (i > 0 && groupChar && perGroup > 0 && i % perGroup === 0) parts.push(groupChar);
      var d = number % 10;
      d = d < 0 ? Math.ceil(d) : Math.floor(d);
      parts.push(String.fromCharCode(zero + d));
      number /= 10;
      ++i;
      if (i > 400) break;
    }
    return parts.reverse().join("");
  }
  function formatNumber(number, f, self) {
    if (number !== number) return self.noNumber;
    var info = {
      integer_hash: 0,
      integer_digits: 0,
      frac_digits: 0,
      frac_hash: 0,
      group: -1,
      multiplier: 1,
      add_decimal: false,
      is_multiplier_set: false
    };
    var pos = 0, len = 0, delayed = 0, defaultSign = false, foundError = false;
    var prefix = 0, prefixLen = 0, suffix = 0, suffixLen = 0;
    function isSpecial(ch) {
      return ch === self.zeroDigit || ch === self.digit || ch === self.decimalPoint || ch === self.grouping || ch === self.patternSeparator;
    }
    function preSuffix() {
      var count = 0;
      for (;;) {
        if (pos >= f.length) return count;
        var ch = f.charAt(pos);
        if (ch === "'") {
          pos++;
          if (pos >= f.length) return -1;
        } else if (isSpecial(ch)) {
          return count;
        } else if (ch === self.percent) {
          if (info.is_multiplier_set) return -1;
          info.multiplier = 100;
          info.is_multiplier_set = true;
        } else if (ch === self.permille) {
          if (info.is_multiplier_set) return -1;
          info.multiplier = 1e3;
          info.is_multiplier_set = true;
        }
        count += 1;
        pos += 1;
      }
    }
    function emit(start, count) {
      var s = "", k = start, j = 0;
      while (j < count && k < f.length) {
        if (f.charAt(k) === "'") k++;
        s += f.charAt(k);
        k++;
        j++;
      }
      return s;
    }
    parse: {
      prefix = pos;
      prefixLen = preSuffix();
      if (prefixLen < 0) {
        foundError = true;
        break parse;
      }
      var ch;
      while (pos < f.length && (ch = f.charAt(pos)) !== self.decimalPoint && ch !== self.patternSeparator) {
        if (delayed !== 0) {
          info.multiplier = delayed;
          info.is_multiplier_set = true;
          delayed = 0;
        }
        if (ch === self.digit) {
          if (info.integer_digits > 0) {
            foundError = true;
            break parse;
          }
          info.integer_hash++;
          if (info.group >= 0) info.group++;
        } else if (ch === self.zeroDigit) {
          info.integer_digits++;
          if (info.group >= 0) info.group++;
        } else if (self.grouping.length > 0 && f.substr(pos, self.grouping.length) === self.grouping) {
          info.group = 0;
          pos += self.grouping.length;
          continue;
        } else if (ch === self.percent) {
          if (info.is_multiplier_set) {
            foundError = true;
            break parse;
          }
          delayed = 100;
        } else if (ch === self.permille) {
          if (info.is_multiplier_set) {
            foundError = true;
            break parse;
          }
          delayed = 1e3;
        } else {
          break;
        }
        len = 1;
        pos += 1;
      }
      if (pos < f.length && f.charAt(pos) === self.decimalPoint) {
        info.add_decimal = true;
        len = 1;
        pos += 1;
      }
      while (pos < f.length) {
        ch = f.charAt(pos);
        if (ch === self.zeroDigit) {
          if (info.frac_hash !== 0) {
            foundError = true;
            break parse;
          }
          info.frac_digits++;
        } else if (ch === self.digit) {
          info.frac_hash++;
        } else if (ch === self.percent) {
          if (info.is_multiplier_set) {
            foundError = true;
            break parse;
          }
          delayed = 100;
          len = 1;
          pos += 1;
          continue;
        } else if (ch === self.permille) {
          if (info.is_multiplier_set) {
            foundError = true;
            break parse;
          }
          delayed = 1e3;
          len = 1;
          pos += 1;
          continue;
        } else if (ch !== self.grouping) {
          break;
        }
        len = 1;
        pos += 1;
        if (delayed !== 0) {
          info.multiplier = delayed;
          delayed = 0;
          info.is_multiplier_set = true;
        }
      }
      if (delayed !== 0) {
        pos -= len;
        delayed = 0;
      }
      suffix = pos;
      suffixLen = preSuffix();
      if (suffixLen < 0 || pos < f.length && f.charAt(pos) !== self.patternSeparator) {
        foundError = true;
        break parse;
      }
      if (number < 0) {
        var sepIdx = f.indexOf(self.patternSeparator);
        if (sepIdx < 0) {
          defaultSign = true;
        } else {
          pos = sepIdx + 1;
          info.is_multiplier_set = false;
          var nprefix = pos, nprefixLen = preSuffix(), nsuffix = 0, nsuffixLen = 0;
          if (nprefixLen < 0) {
            foundError = true;
            break parse;
          }
          while (pos < f.length) {
            ch = f.charAt(pos);
            if (ch === self.percent || ch === self.permille) {
              if (info.is_multiplier_set) {
                foundError = true;
                break parse;
              }
              info.is_multiplier_set = true;
              delayed = 1;
            } else if (isSpecial(ch)) {
              delayed = 0;
            } else {
              break;
            }
            len = 1;
            pos += 1;
          }
          if (delayed !== 0) {
            info.is_multiplier_set = false;
            pos -= len;
          }
          if (pos < f.length) {
            nsuffix = pos;
            nsuffixLen = preSuffix();
            if (nsuffixLen < 0) {
              foundError = true;
              break parse;
            }
          }
          if (pos < f.length) {
            foundError = true;
            break parse;
          }
          if (nprefixLen !== prefixLen || nsuffixLen !== suffixLen || nprefixLen > 0 && f.substr(nprefix, prefixLen) !== f.substr(prefix, prefixLen) || nsuffixLen > 0 && f.substr(nsuffix, suffixLen) !== f.substr(suffix, suffixLen)) {
            prefix = nprefix;
            prefixLen = nprefixLen;
            suffix = nsuffix;
            suffixLen = nsuffixLen;
          }
        }
      }
    }
    if (foundError) {
      warn('format-number: invalid pattern "' + f + '", using the default pattern');
      defaultSign = number < 0;
      prefixLen = suffixLen = 0;
      info.integer_hash = 0;
      info.integer_digits = 1;
      info.frac_digits = 1;
      info.frac_hash = 4;
      info.group = -1;
      info.multiplier = 1;
      info.add_decimal = true;
    }
    number *= info.multiplier;
    if (number === -Infinity) return self.minusSign + self.infinity;
    if (number === Infinity) return self.infinity;
    var out = "";
    if (defaultSign) out += self.minusSign;
    out += emit(prefix, prefixLen);
    number = Math.abs(number);
    var exp10 = info.frac_digits + info.frac_hash;
    if (exp10 > 308) {
      if (info.frac_digits > 308) {
        info.frac_digits = 308;
        info.frac_hash = 0;
      } else info.frac_hash = 308 - info.frac_digits;
      exp10 = 308;
    }
    var scale = Math.pow(10, exp10);
    number += .5 / scale;
    number -= number % (1 / scale);
    var gchar = self.grouping ? self.grouping.charAt(0) : ",";
    out += formatDecimalDigits(Math.floor(number), self.zeroDigit, info.integer_digits, info.group, gchar);
    if (info.integer_digits + info.integer_hash + info.frac_digits === 0 && info.frac_hash > 0) {
      ++info.frac_digits;
      --info.frac_hash;
    }
    if (Math.floor(number) === 0 && info.integer_digits + info.frac_digits === 0) out += self.zeroDigit;
    if (info.frac_digits + info.frac_hash === 0) {
      if (info.add_decimal) out += self.decimalPoint;
    } else {
      number -= Math.floor(number);
      if (number !== 0 || info.frac_digits !== 0) {
        out += self.decimalPoint;
        number = Math.floor(scale * number + .5);
        var j;
        for (j = info.frac_hash; j > 0; j--) {
          if (number % 10 >= 1) break;
          number /= 10;
        }
        out += formatDecimalDigits(Math.floor(number), self.zeroDigit, info.frac_digits + j, 0, "");
      }
    }
    out += emit(suffix, suffixLen);
    return out;
  }
  var DIGIT_ZEROS = [ 48, 1632, 1776, 2406, 2534, 2662, 2790, 2918, 3046, 3174, 3302, 3430, 3664, 3792, 3872, 4160, 6112, 6160, 65296 ];
  function codeOf(ch) {
    if (!ch) return -1;
    if (ch.length === 2) return (ch.charCodeAt(0) - 55296) * 1024 + ch.charCodeAt(1) - 56320 + 65536;
    return ch.charCodeAt(0);
  }
  function isDigitZeroCode(c) {
    for (var i = 0; i < DIGIT_ZEROS.length; i++) if (DIGIT_ZEROS[i] === c) return true;
    return false;
  }
  function isDigitZero(ch) {
    return isDigitZeroCode(codeOf(ch));
  }
  function isDigitOne(ch) {
    var c = codeOf(ch);
    return c > 0 && isDigitZeroCode(c - 1);
  }
  var LETTER_DIGIT_RE = /[0-9A-Za-z\u00AA\u00B5\u00BA\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u02C1\u0370-\u0373\u0376-\u03FF\u0400-\u0481\u048A-\u052F\u0531-\u0556\u0561-\u0587\u05D0-\u05EA\u0620-\u064A\u0660-\u0669\u06F0-\u06F9\u0904-\u0939\u0966-\u096F\u0E01-\u0E30\u0E50-\u0E59\u1100-\u11FF\u3041-\u3096\u30A1-\u30FA\u3131-\u318E\u3400-\u4DB5\u4E00-\u9FFF\uAC00-\uD7A3\uFF10-\uFF19\uFF21-\uFF3A\uFF41-\uFF5A]/;
  function isLetterDigit(ch) {
    return !!ch && LETTER_DIGIT_RE.test(ch);
  }
  var DEFAULT_NUMBER_TOKEN = {
    separator: ".",
    token: "0",
    width: 1
  };
  function numberFormatTokenize(format) {
    var chars = charsOf(format), n = chars.length, ix = 0;
    var tokens = {
      start: null,
      list: [],
      end: null
    };
    while (ix < n && !isLetterDigit(chars[ix])) ix++;
    if (ix > 0) tokens.start = chars.slice(0, ix).join("");
    while (ix < n && tokens.list.length < 1024) {
      var tok = {
        separator: null,
        token: "0",
        width: 1
      };
      if (tokens.list.length > 0) {
        tok.separator = tokens.end;
        tokens.end = null;
      }
      var ch = chars[ix];
      if (isDigitOne(ch) || isDigitZero(ch)) {
        tok.width = 1;
        while (isDigitZero(ch)) {
          tok.width++;
          ix++;
          ch = chars[ix];
        }
        if (isDigitOne(ch)) {
          tok.token = String.fromCharCode(codeOf(ch) - 1);
          ix++;
        } else {
          tok.token = "0";
          tok.width = 1;
        }
      } else if (ch === "A" || ch === "a" || ch === "I" || ch === "i") {
        tok.token = ch;
        ix++;
      }
      while (ix < n && isLetterDigit(chars[ix])) ix++;
      var j = ix;
      while (ix < n && !isLetterDigit(chars[ix])) ix++;
      if (ix > j) tokens.end = chars.slice(j, ix).join("");
      tokens.list.push(tok);
    }
    return tokens;
  }
  function formatAlpha(number, upper, perGroup, groupChar) {
    if (number < 1) return formatDecimalDigits(number, "0", 1, perGroup, groupChar);
    var list = upper ? "ABCDEFGHIJKLMNOPQRSTUVWXYZ" : "abcdefghijklmnopqrstuvwxyz", s = "";
    for (var i = 1; i < 65; i++) {
      number--;
      var idx = number % 26;
      idx = idx < 0 ? Math.ceil(idx) : Math.floor(idx);
      s = list.charAt(idx) + s;
      number /= 26;
      if (number < 1) break;
    }
    return s;
  }
  function formatRoman(number, upper, perGroup, groupChar) {
    if (number < 1 || number > 5e3) return formatDecimalDigits(number, "0", 1, perGroup, groupChar);
    var table = [ [ 1e3, "m", true ], [ 900, "cm", false ], [ 500, "d", true ], [ 400, "cd", false ], [ 100, "c", true ], [ 90, "xc", false ], [ 50, "l", true ], [ 40, "xl", false ], [ 10, "x", true ], [ 9, "ix", false ], [ 5, "v", true ], [ 4, "iv", false ], [ 1, "i", true ] ];
    var s = "";
    for (var i = 0; i < table.length; i++) {
      var v = table[i][0], sym = upper ? table[i][1].toUpperCase() : table[i][1];
      if (table[i][2]) {
        while (number >= v) {
          s += sym;
          number -= v;
        }
      } else if (number >= v) {
        s += sym;
        number -= v;
      }
    }
    return s;
  }
  function numberFormatInsert(numbers, tokens, perGroup, groupChar) {
    var out = tokens.start || "";
    for (var i = 0; i < numbers.length; i++) {
      var number = Math.floor(numbers[numbers.length - 1 - i] + .5);
      if (number < 0) {
        warn("xsl:number: negative value treated as 0");
        number = 0;
      }
      var tok = i < tokens.list.length ? tokens.list[i] : tokens.list.length ? tokens.list[tokens.list.length - 1] : DEFAULT_NUMBER_TOKEN;
      if (i > 0) out += tok.separator !== null ? tok.separator : ".";
      if (number === Infinity) {
        out += "Infinity";
        continue;
      }
      if (number === -Infinity) {
        out += "-Infinity";
        continue;
      }
      if (number !== number) {
        out += "NaN";
        continue;
      }
      switch (tok.token) {
       case "A":
        out += formatAlpha(number, true, perGroup, groupChar);
        break;

       case "a":
        out += formatAlpha(number, false, perGroup, groupChar);
        break;

       case "I":
        out += formatRoman(number, true, perGroup, groupChar);
        break;

       case "i":
        out += formatRoman(number, false, perGroup, groupChar);
        break;

       default:
        if (isDigitZero(tok.token)) out += formatDecimalDigits(number, tok.token, tok.width, perGroup, groupChar);
      }
    }
    if (tokens.end) out += tokens.end;
    return out;
  }
  function warn(msg) {
    if (global.console && global.console.warn) global.console.warn("[xslt-bridge] " + msg);
  }
  var nsScopeCache = new WeakMap;
  var nsScopeCounter = 0;
  var BASE_NS_SCOPE = {
    id: 0,
    map: {
      xml: XML_NS
    }
  };
  function nsScopeOf(el) {
    if (!el || el.nodeType !== 1) return BASE_NS_SCOPE;
    var s = nsScopeCache.get(el);
    if (s) return s;
    var parent = nsScopeOf(el.parentNode), own = null, at = el.attributes;
    for (var i = 0; i < at.length; i++) {
      var nm = at[i].name;
      if (nm === "xmlns") {
        own = own || [];
        own.push([ "", at[i].value ]);
      } else if (nm.substring(0, 6) === "xmlns:") {
        own = own || [];
        own.push([ nm.substring(6), at[i].value ]);
      }
    }
    if (!own) s = parent; else {
      var map = {};
      for (var p in parent.map) if (hasOwn.call(parent.map, p)) map[p] = parent.map[p];
      for (var j = 0; j < own.length; j++) map[own[j][0]] = own[j][1];
      s = {
        id: ++nsScopeCounter,
        map: map
      };
    }
    nsScopeCache.set(el, s);
    return s;
  }
  function makeCC(sheet, file, el) {
    var scope = nsScopeOf(el);
    return {
      sheet: sheet,
      file: file,
      el: el,
      scope: scope,
      nsKey: scope.id,
      cache: sheet.cache,
      ns: function(prefix) {
        if (prefix === "") return scope.map[""] || "";
        var u = scope.map[prefix];
        if (u === undefined) throw XsltError('undeclared namespace prefix "' + prefix + '"');
        return u;
      }
    };
  }
  function getAttr(el, name) {
    return el.hasAttribute(name) ? el.getAttribute(name) : null;
  }
  function needAttr(el, name) {
    var v = getAttr(el, name);
    if (v === null) throw XsltError("xsl:" + el.localName + ': missing required attribute "' + name + '"');
    return v;
  }
  function qnameKey(qn, cc, useDefault) {
    var q = splitQName(qn);
    var uri = q.prefix ? cc.ns(q.prefix) : useDefault ? cc.ns("") : "";
    return varKey(uri, q.local);
  }
  function isXsl(el, local) {
    return el.nodeType === 1 && el.namespaceURI === XSL_NS && (!local || el.localName === local);
  }
  function compileAVT(str, cc) {
    if (str.indexOf("{") < 0 && str.indexOf("}") < 0) {
      var constant = function() {
        return str;
      };
      constant.isConst = true;
      constant.value = str;
      return constant;
    }
    var parts = [], lit = "", i = 0, n = str.length;
    while (i < n) {
      var ch = str.charAt(i);
      if (ch === "{") {
        if (str.charAt(i + 1) === "{") {
          lit += "{";
          i += 2;
          continue;
        }
        var j = i + 1;
        while (j < n && str.charAt(j) !== "}") {
          var cj = str.charAt(j);
          if (cj === '"' || cj === "'") {
            var close = str.indexOf(cj, j + 1);
            j = close < 0 ? n : close + 1;
          } else j++;
        }
        if (j >= n) throw XsltError('unterminated "{" in attribute value template: ' + str);
        if (lit) {
          parts.push(lit);
          lit = "";
        }
        parts.push(compileXPath(str.substring(i + 1, j), cc));
        i = j + 1;
      } else if (ch === "}") {
        lit += "}";
        i += str.charAt(i + 1) === "}" ? 2 : 1;
      } else {
        lit += ch;
        i++;
      }
    }
    if (lit) parts.push(lit);
    return function(x) {
      var s = "";
      for (var k = 0; k < parts.length; k++) s += typeof parts[k] === "string" ? parts[k] : toString(evalExpr(parts[k], x));
      return s;
    };
  }
  var BOOLEAN_FNS = {
    not: 1,
    true: 1,
    false: 1,
    boolean: 1,
    contains: 1,
    "starts-with": 1,
    lang: 1,
    "function-available": 1,
    "element-available": 1
  };
  var STRING_FNS = {
    string: 1,
    concat: 1,
    substring: 1,
    "substring-before": 1,
    "substring-after": 1,
    "normalize-space": 1,
    translate: 1,
    "local-name": 1,
    name: 1,
    "namespace-uri": 1,
    "generate-id": 1,
    "format-number": 1,
    "system-property": 1,
    "unparsed-entity-uri": 1
  };
  var NODESET_FNS = {
    id: 1,
    key: 1,
    document: 1,
    current: 1
  };
  function staticType(ast) {
    switch (ast.k) {
     case "or":
     case "and":
     case "cmp":
      return "boolean";

     case "lit":
      return "string";

     case "path":
     case "union":
     case "filter":
      return "nodeset";

     case "group":
      return staticType(ast.a);

     case "fn":
      if (ast.prefix) return "unknown";
      if (BOOLEAN_FNS[ast.local]) return "boolean";
      if (STRING_FNS[ast.local]) return "string";
      if (NODESET_FNS[ast.local]) return "nodeset";
      return "unknown";

     default:
      return "unknown";
    }
  }
  function usesPositionFn(ast) {
    if (!ast || typeof ast !== "object") return false;
    if (ast.k === "fn" && !ast.prefix && (ast.local === "position" || ast.local === "last")) return true;
    for (var p in ast) {
      if (!hasOwn.call(ast, p)) continue;
      var v = ast[p];
      if (isArray(v)) {
        for (var i = 0; i < v.length; i++) if (usesPositionFn(v[i])) return true;
      } else if (v && typeof v === "object" && usesPositionFn(v)) return true;
    }
    return false;
  }
  function predIsPositional(ast) {
    var t = staticType(ast);
    return !(t === "boolean" || t === "string" || t === "nodeset") || usesPositionFn(ast);
  }
  function inList(n, list) {
    for (var i = 0; i < list.length; i++) if (list[i] === n) return true;
    return false;
  }
  function compilePatternAlt(alt, cc) {
    var steps = [], i;
    for (i = 0; i < alt.steps.length; i++) {
      var st = alt.steps[i], preds = [], positional = false;
      for (var j = 0; j < st.preds.length; j++) {
        preds.push(compilePredicate(st.preds[j], cc));
        if (predIsPositional(st.preds[j])) positional = true;
      }
      steps.push({
        axis: st.axis,
        sep: st.sep,
        preds: preds,
        positional: positional,
        test: makeNodeTest(st.test, st.axis === "attribute" ? "attribute" : "child", cc),
        rawTest: st.test
      });
    }
    var anchor = alt.anchor, anchorArgs = alt.anchorArgs;
    var keyName = null;
    if (anchor === "key") {
      var q = splitQName(anchorArgs[0]);
      keyName = varKey(q.prefix ? cc.ns(q.prefix) : "", q.local);
    }
    function anchorNodes(n, x) {
      if (anchor === "id") {
        var fake = {
          n: n,
          p: 1,
          s: 1,
          x: x
        };
        return FUNCS.id.fn(fake, [ function() {
          return anchorArgs[0];
        } ]);
      }
      return x.t.keyLookup(keyName, anchorArgs[1] === undefined ? "" : anchorArgs[1], n);
    }
    function predsMatch(st, n, x) {
      var k;
      if (!st.positional) {
        for (k = 0; k < st.preds.length; k++) {
          var pr = st.preds[k];
          var r = pr.fn({
            n: n,
            p: 1,
            s: 1,
            x: x
          });
          if (!toBoolean(r)) return false;
        }
        return true;
      }
      var parent = parentOf(n), cands = [];
      if (!parent) return false;
      if (st.axis === "attribute") AXES.attribute(parent, st.test, cands); else AXES.child(parent, st.test, cands);
      for (k = 0; k < st.preds.length && cands.length; k++) cands = applyPredicate(cands, st.preds[k], x);
      return inList(n, cands);
    }
    function matchStep(i, n, x) {
      var st = steps[i], t = n.nodeType;
      if (st.axis === "attribute") {
        if (t !== 2 || isNsDecl(n)) return false;
      } else if (st.axis === "child") {
        if (t === 2 || t === 9 || t === 11 || t === 10) return false;
      }
      if (!st.test(n)) return false;
      if (st.preds.length && !predsMatch(st, n, x)) return false;
      var parent = parentOf(n), a;
      if (i === 0) {
        if (anchor === "root") return !!parent && (parent.nodeType === 9 || parent.nodeType === 11);
        if (anchor === "id" || anchor === "key") {
          var set = anchorNodes(n, x);
          if (st.sep === "/") return !!parent && inList(parent, set);
          for (a = parent; a; a = parentOf(a)) if (inList(a, set)) return true;
          return false;
        }
        return true;
      }
      if (!parent) return false;
      if (st.sep === "/") return matchStep(i - 1, parent, x);
      for (a = parent; a; a = parentOf(a)) if (matchStep(i - 1, a, x)) return true;
      return false;
    }
    var match;
    if (!steps.length) {
      if (anchor === "root") match = function(n) {
        return n.nodeType === 9 || n.nodeType === 11;
      }; else match = function(n, x) {
        return inList(n, anchorNodes(n, x));
      };
    } else {
      var last = steps.length - 1;
      match = function(n, x) {
        return matchStep(last, n, x);
      };
    }
    var prio = .5;
    if (!anchor && !alt.desc && steps.length === 1 && !alt.steps[0].preds.length) {
      var tt = alt.steps[0].test;
      if (tt.t === "name" || tt.t === "pi" && tt.target !== undefined) prio = 0; else if (tt.t === "nsany") prio = -.25; else prio = -.5;
    }
    var bucket;
    if (!steps.length) bucket = anchor === "root" ? [ "root" ] : [ "any" ]; else {
      var ls = steps[steps.length - 1], lt = ls.rawTest;
      if (ls.axis === "attribute") {
        bucket = lt.t === "name" ? [ "a:" + (lt.prefix ? cc.ns(lt.prefix) : "") + "|" + lt.local ] : [ "a*" ];
      } else if (ls.axis === "self") {
        bucket = [ "any" ];
      } else {
        switch (lt.t) {
         case "name":
          bucket = [ "e:" + (lt.prefix ? cc.ns(lt.prefix) : "") + "|" + lt.local ];
          break;

         case "nsany":
         case "any":
          bucket = [ "e*" ];
          break;

         case "text":
          bucket = [ "t" ];
          break;

         case "comment":
          bucket = [ "c" ];
          break;

         case "pi":
          bucket = [ "p" ];
          break;

         default:
          bucket = [ "n" ];
        }
      }
    }
    return {
      match: match,
      priority: prio,
      buckets: bucket
    };
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
     case 1:
      return [ "e:" + nsOf(n) + "|" + n.localName, "e*", "n", "any" ];

     case 2:
      return [ "a:" + nsOf(n) + "|" + n.localName, "a*", "any" ];

     case 3:
     case 4:
      return [ "t", "n", "any" ];

     case 8:
      return [ "c", "n", "any" ];

     case 7:
      return [ "p", "n", "any" ];

     case 9:
     case 11:
      return [ "root", "any" ];
    }
    return [ "any" ];
  }
  function Stylesheet() {
    this.rules = {};
    this.ruleCache = {};
    this.named = {};
    this.globals = {};
    this.keys = {};
    this.output = {};
    this.cdata = {};
    this.strip = [];
    this.decimalFormats = {
      "": DEFAULT_DECIMAL_FORMAT
    };
    this.attrSets = {};
    this.aliases = {};
    this.prec = 0;
    this.order = 0;
    this.cache = {};
    this.files = [];
  }
  Stylesheet.prototype.addRule = function(rule) {
    var byMode = this.rules[rule.mode] || (this.rules[rule.mode] = {});
    for (var i = 0; i < rule.buckets.length; i++) {
      var b = rule.buckets[i];
      (byMode[b] || (byMode[b] = [])).push(rule);
    }
    this.ruleCache = {};
  };
  Stylesheet.prototype.candidates = function(mode, n) {
    var kinds = nodeBuckets(n), ck = mode + "\0" + kinds[0];
    var list = this.ruleCache[ck];
    if (list) return list;
    var byMode = this.rules[mode] || {};
    list = [];
    for (var i = 0; i < kinds.length; i++) {
      var b = byMode[kinds[i]];
      if (b) list = list.concat(b);
    }
    list.sort(function(a, b) {
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
    if (de.localName === "parsererror") return true;
    return doc.getElementsByTagNameNS("*", "parsererror").length > 0 && doc.getElementsByTagNameNS(XHTML_NS, "parsererror").length > 0;
  }
  var docBaseMap = new WeakMap;
  function resolveUrl(href, base) {
    try {
      return new URL(href, base || undefined).href;
    } catch (e) {
      try {
        return new URL(href, global.location.href).href;
      } catch (e2) {
        return href;
      }
    }
  }
  function baseOf(node) {
    var doc = node.nodeType === 9 ? node : node.ownerDocument;
    var b = doc && docBaseMap.get(doc);
    if (b) return b;
    if (node.baseURI && node.baseURI !== "about:blank") return node.baseURI;
    if (doc && doc.URL && doc.URL !== "about:blank") return doc.URL;
    return global.location ? global.location.href : "";
  }
  function loadXmlDocument(url) {
    var hook = XsltBridge.loadDocument;
    var doc;
    if (hook) doc = hook(url); else {
      var xhr = new global.XMLHttpRequest;
      xhr.open("GET", url, false);
      try {
        xhr.overrideMimeType("text/xml");
      } catch (e) {}
      xhr.send(null);
      if (xhr.status !== 0 && (xhr.status < 200 || xhr.status >= 300)) {
        throw XsltError("failed to load document (HTTP " + xhr.status + "): " + url);
      }
      doc = xhr.responseXML;
      if (!doc || isParseError(doc)) doc = (new global.DOMParser).parseFromString(xhr.responseText, "application/xml");
    }
    if (!doc || isParseError(doc)) throw XsltError("failed to parse XML document: " + url);
    docBaseMap.set(doc, url);
    return doc;
  }
  function compileStylesheet(node) {
    var sheet = new Stylesheet;
    var root = node.nodeType === 9 ? node.documentElement : node;
    if (!root) throw XsltError("the stylesheet is empty");
    loadModule(sheet, root, baseOf(node), 0);
    return sheet;
  }
  function loadModule(sheet, root, base, depth) {
    if (depth > 64) throw XsltError("xsl:import / xsl:include nested too deeply");
    var decls = [], imports = [];
    var file = {
      base: base,
      root: root,
      doc: root.ownerDocument,
      prec: 0,
      minPrec: 0,
      excl: null,
      ext: null,
      fwd: false
    };
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
    var toks = normalizeSpace(list).split(" ");
    for (var i = 0; i < toks.length; i++) {
      var t = toks[i];
      if (!t) continue;
      if (t === "#default") out[cc.ns("")] = true; else {
        var u = cc.scope.map[t];
        if (u === undefined) warn('exclude-result-prefixes: undeclared prefix "' + t + '"'); else out[u] = true;
      }
    }
    return out;
  }
  function collectModule(sheet, root, file, decls, imports, depth) {
    sheet.files.push(file);
    var cc = makeCC(sheet, file, root);
    if (isXsl(root, "stylesheet") || isXsl(root, "transform")) {
      var version = getAttr(root, "version");
      file.fwd = version !== null && version !== "1.0";
      file.excl = prefixListToUris(getAttr(root, "exclude-result-prefixes"), cc);
      file.ext = prefixListToUris(getAttr(root, "extension-element-prefixes"), cc);
      for (var k in file.ext) if (hasOwn.call(file.ext, k)) file.excl[k] = true;
      for (var c = root.firstChild; c; c = c.nextSibling) {
        if (c.nodeType !== 1) {
          if ((c.nodeType === 3 || c.nodeType === 4) && !isBlank(c.data)) {
            throw XsltError("text is not allowed directly inside xsl:stylesheet");
          }
          continue;
        }
        if (isXsl(c, "import")) {
          var iurl = resolveUrl(needAttr(c, "href"), file.base);
          var idoc = loadXmlDocument(iurl);
          imports.push({
            root: idoc.documentElement,
            base: iurl
          });
        } else if (isXsl(c, "include")) {
          var url = resolveUrl(needAttr(c, "href"), file.base);
          var doc = loadXmlDocument(url);
          var sub = {
            base: url,
            root: doc.documentElement,
            doc: doc,
            prec: 0,
            minPrec: 0,
            excl: null,
            ext: null,
            fwd: false
          };
          collectModule(sheet, doc.documentElement, sub, decls, imports, depth + 1);
        } else {
          decls.push({
            el: c,
            file: file
          });
        }
      }
    } else {
      if (!root.hasAttributeNS(XSL_NS, "version")) throw XsltError("not an XSLT stylesheet (no xsl:stylesheet element)");
      file.excl = {};
      file.ext = {};
      decls.push({
        el: root,
        file: file
      });
      file.simplified = true;
    }
  }
  function compileDecl(sheet, file, el) {
    var cc = makeCC(sheet, file, el);
    if (file.simplified && el === file.root) {
      var tpl0 = {
        prec: file.prec,
        minPrec: file.minPrec,
        order: ++sheet.order,
        file: file,
        name: null
      };
      var body0 = compileSequence([ el ], cc, {
        excl: file.excl,
        ext: file.ext,
        fwd: false,
        preserve: false,
        templateInherit: null
      });
      tpl0.body = body0;
      sheet.addRule({
        tpl: tpl0,
        match: function(n) {
          return n.nodeType === 9 || n.nodeType === 11;
        },
        priority: .5,
        prec: file.prec,
        order: tpl0.order,
        alt: 0,
        mode: "",
        buckets: [ "root" ]
      });
      return;
    }
    if (el.namespaceURI !== XSL_NS) return;
    switch (el.localName) {
     case "template":
      compileTemplate(sheet, file, el, cc);
      break;

     case "variable":
     case "param":
      {
        var key = qnameKey(needAttr(el, "name"), cc);
        var prev = sheet.globals[key];
        if (!prev || prev.prec <= file.prec) {
          sheet.globals[key] = {
            isParam: el.localName === "param",
            prec: file.prec,
            value: compileVarValue(el, cc, file),
            name: key
          };
        }
        break;
      }

     case "output":
      {
        var props = [ "method", "version", "encoding", "omit-xml-declaration", "standalone", "doctype-public", "doctype-system", "indent", "media-type" ];
        for (var i = 0; i < props.length; i++) {
          var v = getAttr(el, props[i]);
          if (v === null) continue;
          var cur = sheet.output[props[i]];
          if (!cur || cur.prec <= file.prec) sheet.output[props[i]] = {
            value: normalizeSpace(v),
            prec: file.prec
          };
        }
        var cd = getAttr(el, "cdata-section-elements");
        if (cd) {
          var names = normalizeSpace(cd).split(" ");
          for (var j = 0; j < names.length; j++) if (names[j]) sheet.cdata[qnameKey(names[j], cc, true)] = true;
        }
        break;
      }

     case "key":
      {
        var kname = qnameKey(needAttr(el, "name"), cc);
        (sheet.keys[kname] || (sheet.keys[kname] = [])).push({
          match: compilePattern(needAttr(el, "match"), cc),
          use: compileXPath(needAttr(el, "use"), cc)
        });
        break;
      }

     case "strip-space":
     case "preserve-space":
      {
        var list = normalizeSpace(needAttr(el, "elements")).split(" ");
        for (var s = 0; s < list.length; s++) {
          var tok = list[s];
          if (!tok) continue;
          var rule = {
            strip: el.localName === "strip-space",
            prec: file.prec,
            order: ++sheet.order
          };
          if (tok === "*") {
            rule.uri = null;
            rule.local = "*";
            rule.priority = -.5;
          } else {
            var q = splitQName(tok);
            rule.uri = q.prefix ? cc.ns(q.prefix) : "";
            rule.local = q.local;
            rule.priority = q.local === "*" ? -.25 : 0;
          }
          sheet.strip.push(rule);
        }
        break;
      }

     case "decimal-format":
      {
        var dname = getAttr(el, "name");
        var dkey = dname === null ? "" : qnameKey(dname, cc);
        var df = {}, base = DEFAULT_DECIMAL_FORMAT;
        for (var p in base) if (hasOwn.call(base, p)) df[p] = base[p];
        var map = {
          "decimal-separator": "decimalPoint",
          "grouping-separator": "grouping",
          infinity: "infinity",
          "minus-sign": "minusSign",
          NaN: "noNumber",
          percent: "percent",
          "per-mille": "permille",
          "zero-digit": "zeroDigit",
          digit: "digit",
          "pattern-separator": "patternSeparator"
        };
        for (var an in map) if (hasOwn.call(map, an)) {
          var av = getAttr(el, an);
          if (av !== null) df[map[an]] = av;
        }
        sheet.decimalFormats[dkey] = df;
        break;
      }

     case "attribute-set":
      {
        var akey = qnameKey(needAttr(el, "name"), cc);
        var attrs = [];
        for (var ch = el.firstChild; ch; ch = ch.nextSibling) {
          if (ch.nodeType === 1 && isXsl(ch, "attribute")) {
            var acc = makeCC(sheet, file, ch);
            var ins = compileInstruction(ch, acc, {
              excl: file.excl,
              ext: file.ext,
              fwd: file.fwd,
              preserve: false
            });
            ins.id = attributeIdentity(ch, acc);
            attrs.push(ins);
          }
        }
        (sheet.attrSets[akey] || (sheet.attrSets[akey] = [])).push({
          prec: file.prec,
          order: ++sheet.order,
          attrs: attrs,
          uses: useAttributeSetKeys(getAttr(el, "use-attribute-sets"), cc)
        });
        break;
      }

     case "namespace-alias":
      {
        var sp = needAttr(el, "stylesheet-prefix"), rp = needAttr(el, "result-prefix");
        var suri = sp === "#default" ? cc.ns("") : cc.ns(sp);
        var ruri = rp === "#default" ? cc.ns("") : cc.ns(rp);
        sheet.aliases[suri] = {
          uri: ruri,
          prefix: rp === "#default" ? "" : rp
        };
        break;
      }

     case "import":
     case "include":
      break;

     default:
      if (!file.fwd) throw XsltError("unknown top-level element xsl:" + el.localName);
    }
  }
  function useAttributeSetKeys(v, cc) {
    if (!v) return [];
    var toks = normalizeSpace(v).split(" "), out = [];
    for (var i = 0; i < toks.length; i++) if (toks[i]) out.push(qnameKey(toks[i], cc));
    return out;
  }
  function compileTemplate(sheet, file, el, cc) {
    var match = getAttr(el, "match"), name = getAttr(el, "name");
    var modeAttr = getAttr(el, "mode"), prioAttr = getAttr(el, "priority");
    if (match === null && name === null) throw XsltError("xsl:template requires a match or name attribute");
    var tpl = {
      prec: file.prec,
      minPrec: file.minPrec,
      order: ++sheet.order,
      file: file,
      name: name
    };
    var inherit = [], seen = {}, scope = nsScopeOf(el).map;
    for (var p in scope) {
      if (!hasOwn.call(scope, p) || p === "xml") continue;
      var u = scope[p];
      if (u === XSL_NS || file.excl && file.excl[u]) continue;
      if (!seen[p]) {
        seen[p] = true;
        inherit.push({
          prefix: p,
          uri: u
        });
      }
    }
    tpl.body = compileSequence(childList(el), cc, {
      excl: file.excl,
      ext: file.ext,
      fwd: file.fwd,
      preserve: xmlSpacePreserve(el, false),
      templateInherit: inherit,
      inTemplate: true
    });
    if (match !== null) {
      var mode = modeAttr !== null ? qnameKey(modeAttr, cc) : "";
      var alts = compilePattern(match, cc);
      var prio = prioAttr !== null ? stringToNumber(prioAttr) : null;
      for (var i = 0; i < alts.length; i++) {
        sheet.addRule({
          tpl: tpl,
          match: alts[i].match,
          priority: prio !== null ? prio : alts[i].priority,
          prec: file.prec,
          order: tpl.order,
          alt: i,
          mode: mode,
          buckets: alts[i].buckets
        });
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
    if (el.hasAttributeNS && el.hasAttributeNS(XML_NS, "space")) return el.getAttributeNS(XML_NS, "space") === "preserve";
    return inherited;
  }
  function compileSequence(nodes, cc, opts) {
    var instrs = [], i = 0;
    while (i < nodes.length) {
      var n = nodes[i];
      if (n.nodeType === 3 || n.nodeType === 4) {
        var text = "";
        while (i < nodes.length && (nodes[i].nodeType === 3 || nodes[i].nodeType === 4)) {
          text += nodes[i].data;
          i++;
        }
        if (opts.preserve || !isBlank(text)) instrs.push(textInstr(text));
        continue;
      }
      if (n.nodeType === 1) instrs.push(compileInstruction(n, makeCC(cc.sheet, cc.file, n), opts));
      i++;
    }
    return makeSeq(instrs);
  }
  function textInstr(text) {
    return {
      exec: function(x) {
        x.out.text(text, false);
      }
    };
  }
  function makeSeq(instrs) {
    var n = instrs.length, hasBind = false, i;
    for (i = 0; i < n; i++) if (instrs[i].bind) hasBind = true;
    if (n === 0) return function() {};
    if (!hasBind) {
      if (n === 1) return instrs[0].exec;
      return function(x) {
        for (var k = 0; k < n; k++) instrs[k].exec(x);
      };
    }
    return function(x) {
      var saved = x.vars;
      x.vars = Object.create(saved);
      try {
        for (var k = 0; k < n; k++) {
          var ins = instrs[k];
          if (ins.bind) {
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
      excl: opts.excl,
      ext: opts.ext,
      fwd: opts.fwd,
      preserve: xmlSpacePreserve(el, opts.preserve),
      templateInherit: null,
      inTemplate: false
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
    var i = s.indexOf(":");
    if (i < 0) return NCNAME_RE.test(s);
    return NCNAME_RE.test(s.substring(0, i)) && NCNAME_RE.test(s.substring(i + 1));
  }
  function checkElementName(kind, qn, hasNsAttr, scope) {
    if (!isQName(qn)) throw XsltError(kind + ": computed name '" + qn + "' is not a valid QName");
    if (kind === "xsl:attribute" && qn === "xmlns") throw XsltError("xsl:attribute: the name 'xmlns' is not allowed");
    var q = splitQName(qn);
    if (!hasNsAttr && q.prefix && q.prefix !== "xml" && scope[q.prefix] === undefined) {
      throw XsltError(kind + ": no namespace binding in scope for prefix '" + q.prefix + "' (" + qn + ")");
    }
    return q;
  }
  function compileVarValue(el, cc, opts) {
    var sel = getAttr(el, "select");
    if (sel !== null && hasContent(el)) {
      throw XsltError("xsl:" + el.localName + " '" + getAttr(el, "name") + "': must be empty when the select attribute is present");
    }
    if (sel !== null) {
      var f = compileXPath(sel, cc);
      return function(x) {
        return evalExpr(f, x);
      };
    }
    if (!hasContent(el)) return function() {
      return "";
    };
    var body = bodyOf(el, cc, opts && opts.excl ? opts : {
      excl: {},
      ext: {},
      fwd: false,
      preserve: false
    });
    return function(x) {
      return buildRtf(body, x);
    };
  }
  function buildRtf(body, x) {
    var out = new Out, saved = x.out;
    x.out = out;
    try {
      body(x);
    } finally {
      x.out = saved;
    }
    return new Rtf(out.root.children);
  }
  function bodyToString(body, x, inAttr) {
    var out = new Out, saved = x.out;
    out.inAttr = !!inAttr;
    x.out = out;
    try {
      body(x);
    } finally {
      x.out = saved;
    }
    return new Rtf(out.root.children).text();
  }
  function compileSorts(el, cc) {
    var sorts = [];
    for (var c = el.firstChild; c; c = c.nextSibling) {
      if ((c.nodeType === 3 || c.nodeType === 4) && isBlank(c.data)) continue;
      if (c.nodeType === 1 && isXsl(c, "with-param")) continue;
      if (c.nodeType !== 1 || !isXsl(c, "sort")) break;
      {
        var scc = makeCC(cc.sheet, cc.file, c);
        var langAttr = getAttr(c, "lang"), caseOrder = getAttr(c, "case-order");
        sorts.push({
          select: compileXPath(getAttr(c, "select") || ".", scc),
          dataType: sortAttr(c, "data-type", "text", {
            text: 1,
            number: 1
          }, scc),
          order: sortAttr(c, "order", "ascending", {
            ascending: 1,
            descending: 1
          }, scc),
          collator: getCollator(langAttr === null ? "en" : langAttr.indexOf("{") >= 0 ? null : langAttr, caseOrder === "lower-first")
        });
      }
    }
    return sorts.length ? sorts : null;
  }
  function sortAttr(el, name, def, allowed, cc) {
    var raw = getAttr(el, name);
    if (raw === null) return function() {
      return def;
    };
    if (raw.indexOf("{") < 0) {
      if (!allowed[raw]) {
        warn("xsl:sort: unsupported " + name + '="' + raw + '", using ' + def);
        raw = def;
      }
      var fixed = raw;
      return function() {
        return fixed;
      };
    }
    var avt = compileAVT(raw, cc);
    return function(x) {
      var v = avt(x);
      if (!allowed[v]) throw XsltError("xsl:sort: unsupported " + name + ' value "' + v + '"');
      return v;
    };
  }
  var collatorCache = {};
  function getCollator(lang, lowerFirst) {
    var key = (lang === null ? "" : lang) + "|" + (lowerFirst ? "l" : "u");
    if (collatorCache[key]) return collatorCache[key];
    var opts = {
      caseFirst: lowerFirst ? "lower" : "upper"
    }, loc = "en", coll;
    if (lang === null) loc = undefined; else {
      var tag = String(lang).split("@")[0].replace(/_/g, "-");
      try {
        if (tag && global.Intl.Collator.supportedLocalesOf([ tag ]).length) loc = tag;
      } catch (e) {
        loc = "en";
      }
    }
    try {
      coll = new global.Intl.Collator(loc, opts);
    } catch (e2) {
      coll = null;
    }
    var cmp = coll ? coll.compare : function(a, b) {
      return a < b ? -1 : a > b ? 1 : 0;
    };
    collatorCache[key] = cmp;
    return cmp;
  }
  function sortNodes(nodes, sorts, x) {
    var n = nodes.length;
    if (n < 2) return nodes;
    var specs = [], keys = [], i, k;
    for (k = 0; k < sorts.length; k++) {
      specs.push({
        number: sorts[k].dataType(x) === "number",
        desc: sorts[k].order(x) === "descending",
        collate: sorts[k].collator
      });
      keys.push(new Array(n));
    }
    var sx = {
      node: null,
      pos: 0,
      size: n,
      vars: x.vars,
      params: null,
      tpl: null,
      mode: x.mode,
      out: x.out,
      t: x.t
    };
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
    idx.sort(function(a, b) {
      for (var k = 0; k < specs.length; k++) {
        var ka = keys[k][a], kb = keys[k][b], r;
        if (specs[k].number) {
          if (ka !== ka) r = kb !== kb ? 0 : -1; else if (kb !== kb) r = 1; else r = ka === kb ? 0 : ka > kb ? 1 : -1;
        } else {
          r = specs[k].collate(ka, kb);
          r = r < 0 ? -1 : r > 0 ? 1 : 0;
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
      if (c.nodeType === 1 && isXsl(c, "with-param")) {
        var pcc = makeCC(cc.sheet, cc.file, c);
        params.push({
          key: qnameKey(needAttr(c, "name"), pcc),
          value: compileVarValue(c, pcc, opts)
        });
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
    "apply-imports": 1,
    "apply-templates": 1,
    attribute: 1,
    "call-template": 1,
    choose: 1,
    comment: 1,
    copy: 1,
    "copy-of": 1,
    element: 1,
    fallback: 1,
    "for-each": 1,
    if: 1,
    message: 1,
    number: 1,
    "processing-instruction": 1,
    text: 1,
    "value-of": 1,
    variable: 1
  };
  function fallbackOf(el, cc, opts) {
    var nodes = [];
    for (var c = el.firstChild; c; c = c.nextSibling) if (c.nodeType === 1 && isXsl(c, "fallback")) nodes.push(c);
    if (!nodes.length) return null;
    var seqs = [];
    for (var i = 0; i < nodes.length; i++) seqs.push(bodyOf(nodes[i], makeCC(cc.sheet, cc.file, nodes[i]), opts));
    return function(x) {
      for (var k = 0; k < seqs.length; k++) seqs[k](x);
    };
  }
  function compileInstruction(el, cc, opts) {
    if (el.namespaceURI === XSL_NS) return compileXslInstruction(el, cc, opts);
    var uri = el.namespaceURI || "";
    var lreExt = prefixListToUris(el.getAttributeNS(XSL_NS, "extension-element-prefixes"), cc);
    if (opts.ext && opts.ext[uri] || lreExt[uri]) {
      var fb = fallbackOf(el, cc, opts);
      if (fb) return {
        exec: fb
      };
      return {
        exec: function() {
          throw XsltError("unknown extension element <" + el.nodeName + "> (no xsl:fallback)");
        }
      };
    }
    return compileLiteralElement(el, cc, opts);
  }
  function compileLiteralElement(el, cc, opts) {
    var excl = {}, k;
    for (k in opts.excl) if (hasOwn.call(opts.excl, k)) excl[k] = true;
    var lreExcl = prefixListToUris(el.getAttributeNS(XSL_NS, "exclude-result-prefixes"), cc);
    var lreExt = prefixListToUris(el.getAttributeNS(XSL_NS, "extension-element-prefixes"), cc);
    for (k in lreExcl) if (hasOwn.call(lreExcl, k)) excl[k] = true;
    for (k in lreExt) if (hasOwn.call(lreExt, k)) excl[k] = true;
    excl[XSL_NS] = true;
    var ext = {};
    for (k in opts.ext) if (hasOwn.call(opts.ext, k)) ext[k] = true;
    for (k in lreExt) if (hasOwn.call(lreExt, k)) ext[k] = true;
    var prefix = el.prefix || "", local = el.localName, uri = el.namespaceURI || "";
    var ownNs = [], at = el.attributes, attrs = [], useSets = [];
    for (var i = 0; i < at.length; i++) {
      var a = at[i], nm = a.name;
      if (nm === "xmlns" || nm.substring(0, 6) === "xmlns:") {
        var p = nm === "xmlns" ? "" : nm.substring(6);
        if (a.value === XSL_NS) continue;
        if (p !== "" && excl[a.value]) continue;
        ownNs.push({
          prefix: p,
          uri: a.value
        });
        continue;
      }
      if (a.namespaceURI === XSL_NS) {
        if (a.localName === "use-attribute-sets") useSets = useAttributeSetKeys(a.value, cc);
        continue;
      }
      attrs.push({
        prefix: a.prefix || "",
        local: a.localName,
        uri: a.namespaceURI || "",
        avt: compileAVT(a.value, cc)
      });
    }
    var inherit = opts.templateInherit;
    var body = compileSequence(childList(el), cc, {
      excl: excl,
      ext: ext,
      fwd: opts.fwd,
      preserve: xmlSpacePreserve(el, opts.preserve),
      templateInherit: null,
      inTemplate: false
    });
    return {
      exec: function(x) {
        var aliases = x.t.sheet.aliases, al = aliases[uri];
        var ePrefix = prefix, eUri = uri;
        if (al) {
          eUri = al.uri;
          ePrefix = al.prefix;
        }
        var out = x.out, e = out.startElement(ePrefix, local, eUri), i;
        for (i = 0; i < ownNs.length; i++) {
          var o = ownNs[i], oa = aliases[o.uri];
          if (oa) outDeclare(e, o.prefix, oa.uri); else outDeclare(e, o.prefix, o.uri);
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
          if (aal) {
            au = aal.uri;
            ap = aal.prefix;
          }
          out.attribute(ap, ad.local, au, ad.avt(x));
        }
        body(x);
        out.endElement();
      }
    };
  }
  function attributeIdentity(el, cc) {
    var name = getAttr(el, "name") || "", nsAttr = getAttr(el, "namespace");
    if (name.indexOf("{") >= 0 || nsAttr !== null && nsAttr.indexOf("{") >= 0) return "\0avt";
    var q = splitQName(name), uri;
    if (nsAttr !== null) uri = nsAttr; else uri = q.prefix ? cc.scope.map[q.prefix] || "" : "";
    return uri + "}" + q.local;
  }
  function resolveAttributeSet(sheet, key, state) {
    var cache = sheet.attrSetCache || (sheet.attrSetCache = {});
    if (cache[key]) return cache[key];
    var defs = sheet.attrSets[key];
    if (!defs) {
      warn('attribute-set "' + key + '" is not defined');
      return [];
    }
    if (state[key]) {
      warn('attribute-set "' + key + '" references itself');
      return [];
    }
    state[key] = true;
    var byPrec = {}, precs = [], i, j;
    for (i = 0; i < defs.length; i++) {
      var d = defs[i];
      if (!byPrec[d.prec]) {
        byPrec[d.prec] = [];
        precs.push(d.prec);
      }
      byPrec[d.prec].push(d);
    }
    precs.sort(function(a, b) {
      return b - a;
    });
    function groupList(prec) {
      var group = byPrec[prec].slice().sort(function(a, b) {
        return a.order - b.order;
      });
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
      for (var j = 0; j < list.length; j++) if (list[j].id === other[i].id) {
        dup = true;
        break;
      }
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
     case "apply-templates":
      {
        var s1 = getAttr(el, "select");
        sel = s1 !== null ? compileXPath(s1, cc) : null;
        var modeAttr = getAttr(el, "mode");
        var mode = modeAttr !== null ? qnameKey(modeAttr, cc) : "";
        var sorts = compileSorts(el, cc), params = compileWithParams(el, cc, opts);
        return {
          exec: function(x) {
            var nodes;
            if (sel) nodes = asNodeSet(evalExpr(sel, x), "xsl:apply-templates select"); else {
              nodes = [];
              if (x.node.nodeType !== 2) for (var c = x.node.firstChild; c; c = c.nextSibling) if (c.nodeType !== 10) nodes.push(c);
            }
            if (sorts) nodes = sortNodes(nodes, sorts, x);
            x.t.applyTemplates(nodes, mode, evalParams(params, x), x.out);
          }
        };
      }

     case "call-template":
      {
        var tkey = qnameKey(needAttr(el, "name"), cc), cparams = compileWithParams(el, cc, opts);
        return {
          exec: function(x) {
            var tpl = x.t.sheet.named[tkey];
            if (!tpl) throw XsltError('xsl:call-template: no template named "' + tkey + '"');
            x.t.invoke(tpl, x.node, x.pos, x.size, x.mode, evalParams(cparams, x), x.out);
          }
        };
      }

     case "apply-imports":
      return {
        exec: function(x) {
          x.t.applyImports(x);
        }
      };

     case "for-each":
      {
        sel = compileXPath(needAttr(el, "select"), cc);
        var fsorts = compileSorts(el, cc);
        body = bodyOf(el, cc, opts, {
          sort: 1
        });
        return {
          exec: function(x) {
            var nodes = asNodeSet(evalExpr(sel, x), "xsl:for-each select");
            if (fsorts) nodes = sortNodes(nodes, fsorts, x);
            var n = nodes.length;
            if (!n) return;
            var sn = x.node, sp = x.pos, ss = x.size, st = x.tpl;
            x.tpl = null;
            x.size = n;
            try {
              for (var i = 0; i < n; i++) {
                x.node = nodes[i];
                x.pos = i + 1;
                body(x);
              }
            } finally {
              x.node = sn;
              x.pos = sp;
              x.size = ss;
              x.tpl = st;
            }
          }
        };
      }

     case "if":
      {
        var test = compileXPath(needAttr(el, "test"), cc);
        body = bodyOf(el, cc, opts);
        return {
          exec: function(x) {
            if (toBoolean(evalExpr(test, x))) body(x);
          }
        };
      }

     case "choose":
      {
        var whens = [], otherwise = null;
        for (var c = el.firstChild; c; c = c.nextSibling) {
          if (c.nodeType !== 1) continue;
          var wcc = makeCC(cc.sheet, cc.file, c);
          if (isXsl(c, "when")) whens.push({
            test: compileXPath(needAttr(c, "test"), wcc),
            body: bodyOf(c, wcc, opts)
          }); else if (isXsl(c, "otherwise")) otherwise = bodyOf(c, wcc, opts);
        }
        return {
          exec: function(x) {
            for (var i = 0; i < whens.length; i++) {
              if (toBoolean(evalExpr(whens[i].test, x))) {
                whens[i].body(x);
                return;
              }
            }
            if (otherwise) otherwise(x);
          }
        };
      }

     case "value-of":
      {
        sel = compileXPath(needAttr(el, "select"), cc);
        var doe = getAttr(el, "disable-output-escaping") === "yes";
        return {
          exec: function(x) {
            x.out.text(toString(evalExpr(sel, x)), doe);
          }
        };
      }

     case "text":
      {
        var txt = "";
        for (var t = el.firstChild; t; t = t.nextSibling) if (t.nodeType === 3 || t.nodeType === 4) txt += t.data;
        var tdoe = getAttr(el, "disable-output-escaping") === "yes";
        return {
          exec: function(x) {
            x.out.text(txt, tdoe);
          }
        };
      }

     case "element":
      {
        var ename = compileAVT(needAttr(el, "name"), cc);
        var nsAttr = getAttr(el, "namespace"), ens = nsAttr !== null ? compileAVT(nsAttr, cc) : null;
        var esets = useAttributeSetKeys(getAttr(el, "use-attribute-sets"), cc);
        body = bodyOf(el, cc, opts);
        var escope = cc.scope.map, enameRaw = getAttr(el, "name");
        if (enameRaw.indexOf("{") < 0) checkElementName("xsl:element", normalizeSpace(enameRaw), nsAttr !== null, escope);
        return {
          exec: function(x) {
            var qn = normalizeSpace(ename(x)), q = checkElementName("xsl:element", qn, !!ens, escope), uri, prefix = q.prefix || "";
            if (ens) {
              uri = ens(x);
              if (!uri) prefix = "";
            } else if (q.prefix) {
              uri = q.prefix === "xml" ? XML_NS : escope[q.prefix];
            } else uri = escope[""] || "";
            var out = x.out, e = out.startElement(prefix, q.local, uri);
            fixElementNs(e);
            if (esets.length) applyAttributeSets(esets, x);
            body(x);
            out.endElement();
          }
        };
      }

     case "attribute":
      {
        var aname = compileAVT(needAttr(el, "name"), cc);
        var ansAttr = getAttr(el, "namespace"), ans = ansAttr !== null ? compileAVT(ansAttr, cc) : null;
        body = bodyOf(el, cc, opts);
        var ascope = cc.scope.map, anameRaw = getAttr(el, "name");
        if (anameRaw.indexOf("{") < 0) checkElementName("xsl:attribute", normalizeSpace(anameRaw), ansAttr !== null, ascope);
        return {
          exec: function(x) {
            var qn = normalizeSpace(aname(x)), q = checkElementName("xsl:attribute", qn, !!ans, ascope), uri;
            if (ans) uri = ans(x); else if (q.prefix) uri = q.prefix === "xml" ? XML_NS : ascope[q.prefix]; else uri = "";
            var value = bodyToString(body, x, true);
            x.out.attribute(uri ? q.prefix || "" : "", q.local, uri, value);
          }
        };
      }

     case "comment":
      body = bodyOf(el, cc, opts);
      return {
        exec: function(x) {
          var cv = bodyToString(body, x);
          if (cv.indexOf("--") >= 0 || cv.charAt(cv.length - 1) === "-") throw XsltError("xsl:comment: content contains '--' or ends with '-'");
          x.out.comment(cv);
        }
      };

     case "processing-instruction":
      {
        var pname = compileAVT(needAttr(el, "name"), cc);
        body = bodyOf(el, cc, opts);
        return {
          exec: function(x) {
            var pv = bodyToString(body, x);
            if (pv.indexOf("?>") >= 0) throw XsltError("xsl:processing-instruction: content contains '?>'");
            x.out.pi(normalizeSpace(pname(x)), pv);
          }
        };
      }

     case "copy":
      {
        var csets = useAttributeSetKeys(getAttr(el, "use-attribute-sets"), cc);
        body = bodyOf(el, cc, opts);
        return {
          exec: function(x) {
            var n = x.node, out = x.out;
            switch (n.nodeType) {
             case 9:
             case 11:
              body(x);
              break;

             case 1:
              {
                var e = out.startElement(n.prefix || "", n.localName, nsOf(n));
                var at = n.attributes;
                for (var i = 0; i < at.length; i++) {
                  var nm = at[i].name;
                  if (nm === "xmlns") outDeclare(e, "", at[i].value); else if (nm.substring(0, 6) === "xmlns:") outDeclare(e, nm.substring(6), at[i].value);
                }
                fixElementNs(e);
                if (csets.length) applyAttributeSets(csets, x);
                body(x);
                out.endElement();
                break;
              }

             case 2:
              out.attribute(n.prefix || "", n.localName, nsOf(n), n.value);
              break;

             case 3:
             case 4:
              out.text(n.nodeValue, false);
              break;

             case 8:
              out.comment(n.nodeValue);
              break;

             case 7:
              out.pi(n.target, n.nodeValue);
              break;
            }
          }
        };
      }

     case "copy-of":
      {
        sel = compileXPath(needAttr(el, "select"), cc);
        return {
          exec: function(x) {
            var v = evalExpr(sel, x);
            if (isArray(v)) {
              for (var i = 0; i < v.length; i++) x.out.copyNode(v[i], true);
            } else if (v instanceof Rtf) x.out.copyResult(v.children); else x.out.text(toString(v), false);
          }
        };
      }

     case "variable":
     case "param":
      {
        var vkey = qnameKey(needAttr(el, "name"), cc);
        var valueFn = compileVarValue(el, cc, opts);
        if (name === "param" && opts.inTemplate) {
          return {
            bind: vkey,
            value: function(x) {
              var p = x.params;
              if (p && hasOwn.call(p, vkey)) return p[vkey];
              return valueFn(x);
            }
          };
        }
        return {
          bind: vkey,
          value: valueFn
        };
      }

     case "number":
      return compileNumber(el, cc);

     case "message":
      {
        body = bodyOf(el, cc, opts);
        var terminate = getAttr(el, "terminate") === "yes";
        return {
          exec: function(x) {
            var msg = buildRtf(body, x).text();
            if (global.console && global.console.log) global.console.log("[XSLT xsl:message] " + msg);
            if (terminate) throw XsltError('transformation terminated by xsl:message terminate="yes": ' + msg);
          }
        };
      }

     case "fallback":
      return {
        exec: function() {}
      };

     case "sort":
      return {
        exec: function() {
          throw XsltError("xsl:sort is only allowed at the start of xsl:for-each or xsl:apply-templates");
        }
      };

     case "with-param":
      return {
        exec: function() {}
      };
    }
    if (opts.fwd) {
      var fb = fallbackOf(el, cc, opts);
      return {
        exec: fb || function() {}
      };
    }
    warn("unknown XSLT instruction xsl:" + name + " ignored");
    return {
      exec: function() {}
    };
  }
  function compileNumber(el, cc) {
    var valueAttr = getAttr(el, "value");
    var value = valueAttr !== null ? compileXPath(valueAttr, cc) : null;
    var level = getAttr(el, "level") || "single";
    var countAttr = getAttr(el, "count"), fromAttr = getAttr(el, "from");
    var countPat = countAttr !== null ? compilePattern(countAttr, cc) : null;
    var fromPat = fromAttr !== null ? compilePattern(fromAttr, cc) : null;
    var format = compileAVT(getAttr(el, "format") || "1", cc);
    var gsAttr = getAttr(el, "grouping-separator"), gzAttr = getAttr(el, "grouping-size");
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
      exec: function(x) {
        var numbers = [], node = x.node, px = {
          node: node,
          pos: 1,
          size: 1,
          vars: EMPTY_SCOPE,
          t: x.t
        };
        if (value) {
          numbers.push(toNumber(evalExpr(value, x)));
        } else if (level === "any") {
          var cnt = 0, cur = node;
          while (cur) {
            px.node = cur;
            if (countMatch(cur, node, px)) cnt++;
            if (fromPat && patternMatches(fromPat, cur, px)) break;
            if (cur.nodeType === 9 || cur.nodeType === 11) break;
            if (cur.nodeType === 2) cur = cur.ownerElement; else {
              var prev = cur.previousSibling;
              while (prev && prev.nodeType === 10) prev = prev.previousSibling;
              if (prev) {
                cur = prev;
                while (cur.lastChild) cur = cur.lastChild;
              } else cur = cur.parentNode;
            }
          }
          numbers.push(cnt);
        } else {
          var max = level === "multiple" ? 1024 : 1;
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
        var perGroup = 0, gchar = "";
        if (gsep && gsize) {
          gchar = gsep(x).charAt(0);
          perGroup = stringToNumber(gsize(x));
          if (!(perGroup > 0)) perGroup = 0;
        }
        x.out.text(numberFormatInsert(numbers, numberFormatTokenize(format(x)), perGroup, gchar), false);
      }
    };
  }
  function Out() {
    this.root = {
      type: 9,
      children: [],
      parent: null
    };
    this.cur = this.root;
  }
  Out.prototype.startElement = function(prefix, local, ns) {
    ns = ns || "";
    var e = {
      type: 1,
      prefix: ns ? prefix || "" : "",
      local: local,
      ns: ns,
      attrs: [],
      nsDecls: [],
      children: [],
      parent: this.cur
    };
    this.cur.children.push(e);
    this.cur = e;
    return e;
  };
  Out.prototype.endElement = function() {
    this.cur = this.cur.parent;
  };
  Out.prototype.text = function(s, doe) {
    if (!s) return;
    doe = !!doe;
    var ch = this.cur.children, last = ch.length ? ch[ch.length - 1] : null;
    if (last && last.type === 3 && last.doe === doe) last.v += s; else ch.push({
      type: 3,
      v: s,
      doe: doe
    });
  };
  Out.prototype.comment = function(s) {
    this.cur.children.push({
      type: 8,
      v: s
    });
  };
  Out.prototype.pi = function(target, s) {
    this.cur.children.push({
      type: 7,
      target: target,
      v: s
    });
  };
  Out.prototype.attribute = function(prefix, local, ns, value) {
    var e = this.cur;
    if (e.type !== 1) {
      if (this.inAttr) throw XsltError("cannot add an attribute inside xsl:attribute (" + local + ")");
      return;
    }
    if (e.children.length) throw XsltError("cannot add attributes to an element after children have been added (" + local + ")");
    ns = ns || "";
    prefix = ns ? attrPrefixFor(e, prefix, ns) : "";
    for (var i = 0; i < e.attrs.length; i++) {
      var a = e.attrs[i];
      if (a.local === local && a.ns === ns) {
        a.value = value;
        return;
      }
    }
    e.attrs.push({
      prefix: prefix,
      local: local,
      ns: ns,
      value: value
    });
  };
  function inScopeNamespaces(el) {
    var out = [], seen = {};
    for (var n = el; n && n.nodeType === 1; n = n.parentNode) {
      var at = n.attributes;
      for (var i = 0; i < at.length; i++) {
        var nm = at[i].name, p;
        if (nm === "xmlns") p = ""; else if (nm.substring(0, 6) === "xmlns:") p = nm.substring(6); else continue;
        if (seen[p]) continue;
        seen[p] = true;
        if (p !== "xml") out.push({
          prefix: p,
          uri: at[i].value
        });
      }
    }
    return out;
  }
  Out.prototype.copyNode = function(n, top) {
    var c, i;
    switch (n.nodeType) {
     case 9:
     case 11:
      for (c = n.firstChild; c; c = c.nextSibling) this.copyNode(c, false);
      return;

     case 1:
      {
        var e = this.startElement(n.prefix || "", n.localName, nsOf(n));
        if (top) {
          var scope = inScopeNamespaces(n);
          for (i = 0; i < scope.length; i++) outDeclare(e, scope[i].prefix, scope[i].uri);
        } else {
          var own = n.attributes;
          for (i = 0; i < own.length; i++) {
            var nm = own[i].name;
            if (nm === "xmlns") outDeclare(e, "", own[i].value); else if (nm.substring(0, 6) === "xmlns:") outDeclare(e, nm.substring(6), own[i].value);
          }
        }
        fixElementNs(e);
        var at = n.attributes;
        for (i = 0; i < at.length; i++) {
          if (!isNsDecl(at[i])) this.attribute(at[i].prefix || "", at[i].localName, nsOf(at[i]), at[i].value);
        }
        for (c = n.firstChild; c; c = c.nextSibling) this.copyNode(c, false);
        this.endElement();
        return;
      }

     case 2:
      this.attribute(n.prefix || "", n.localName, nsOf(n), n.value);
      return;

     case 3:
     case 4:
      this.text(n.nodeValue, false);
      return;

     case 8:
      this.comment(n.nodeValue);
      return;

     case 7:
      this.pi(n.target, n.nodeValue);
      return;
    }
  };
  Out.prototype.copyResult = function(children) {
    for (var i = 0; i < children.length; i++) {
      var c = children[i], j;
      if (c.type === 1) {
        var e = this.startElement(c.prefix, c.local, c.ns);
        for (j = 0; j < c.nsDecls.length; j++) outDeclare(e, c.nsDecls[j].prefix, c.nsDecls[j].uri);
        fixElementNs(e);
        for (j = 0; j < c.attrs.length; j++) this.attribute(c.attrs[j].prefix, c.attrs[j].local, c.attrs[j].ns, c.attrs[j].value);
        this.copyResult(c.children);
        this.endElement();
      } else if (c.type === 3) this.text(c.v, c.doe); else if (c.type === 8) this.comment(c.v); else if (c.type === 7) this.pi(c.target, c.v);
    }
  };
  function outLookupNs(e, prefix) {
    for (var n = e; n && n.type === 1; n = n.parent) {
      var d = n.nsDecls;
      for (var i = 0; i < d.length; i++) if (d[i].prefix === prefix) return d[i].uri;
    }
    if (prefix === "xml") return XML_NS;
    return prefix === "" ? "" : null;
  }
  function declaredOn(e, prefix) {
    for (var i = 0; i < e.nsDecls.length; i++) if (e.nsDecls[i].prefix === prefix) return e.nsDecls[i];
    return null;
  }
  function outDeclare(e, prefix, uri) {
    if (prefix === "xml") return true;
    if (outLookupNs(e, prefix) === uri) return true;
    if (declaredOn(e, prefix)) return false;
    e.nsDecls.push({
      prefix: prefix,
      uri: uri
    });
    return true;
  }
  function outForceDeclare(e, prefix, uri) {
    if (!declaredOn(e, prefix)) e.nsDecls.push({
      prefix: prefix,
      uri: uri
    });
  }
  function newPrefix(e, base) {
    var i = 1, p;
    do {
      p = base + "_" + i++;
    } while (outLookupNs(e, p) !== null && i < 1e3);
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
      e.prefix = "";
      var d = declaredOn(e, "");
      if (!d && outLookupNs(e, "") !== "") e.nsDecls.push({
        prefix: "",
        uri: ""
      });
      return;
    }
    if (!outDeclare(e, e.prefix, e.ns)) {
      var p = findPrefixByUri(e, e.ns);
      if (p) {
        e.prefix = p;
        return;
      }
      e.prefix = newPrefix(e, e.prefix || "ns");
      e.nsDecls.push({
        prefix: e.prefix,
        uri: e.ns
      });
    }
  }
  function attrPrefixFor(e, prefix, uri) {
    if (!prefix || prefix === "xmlns") prefix = "ns_1";
    if (prefix === "xml") return "xml";
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
              e.nsDecls.push({
                prefix: p,
                uri: uri
              });
              return p;
            }
          }
        }
      }
      e.nsDecls.push({
        prefix: prefix,
        uri: uri
      });
      return prefix;
    }
    p = newPrefix(e, prefix);
    e.nsDecls.push({
      prefix: p,
      uri: uri
    });
    return p;
  }
  function Transform(sheet, params) {
    this.sheet = sheet;
    this.params = params || {};
    this.globalVals = {};
    this.globalBusy = {};
    this.depth = 0;
    this.keyIndexes = new WeakMap;
    this.docs = {};
    this.root = null;
  }
  var TP = Transform.prototype;
  TP.ctx = function(node) {
    return {
      node: node,
      pos: 1,
      size: 1,
      vars: EMPTY_SCOPE,
      params: null,
      tpl: null,
      mode: "",
      out: null,
      t: this
    };
  };
  TP.globalValue = function(key) {
    if (hasOwn.call(this.globalVals, key)) return this.globalVals[key];
    var g = this.sheet.globals[key];
    if (!g) throw XsltError("undefined variable $" + key);
    if (this.globalBusy[key]) throw XsltError("global variable $" + key + " references itself");
    this.globalBusy[key] = true;
    var v;
    try {
      if (g.isParam && hasOwn.call(this.params, key)) v = this.params[key]; else v = g.value(this.ctx(this.root));
    } finally {
      this.globalBusy[key] = false;
    }
    this.globalVals[key] = v;
    return v;
  };
  TP.run = function(root) {
    this.root = root;
    for (var k in this.sheet.globals) if (hasOwn.call(this.sheet.globals, k)) this.globalValue(k);
    var out = new Out;
    this.applyTemplates([ root ], "", null, out);
    return out;
  };
  TP.findTemplate = function(node, mode, minPrec, maxPrec) {
    var list = this.sheet.candidates(mode, node), px = null;
    for (var i = 0; i < list.length; i++) {
      var r = list[i];
      if (maxPrec !== undefined && (r.prec > maxPrec || r.prec < minPrec)) continue;
      if (!px) px = this.ctx(node);
      if (r.match(node, px)) return r.tpl;
    }
    return null;
  };
  TP.applyTemplates = function(nodes, mode, params, out) {
    var n = nodes.length;
    for (var i = 0; i < n; i++) {
      var node = nodes[i], tpl = this.findTemplate(node, mode);
      if (tpl) this.invoke(tpl, node, i + 1, n, mode, params, out); else this.builtin(node, mode, params, out);
    }
  };
  TP.invoke = function(tpl, node, pos, size, mode, params, out) {
    if (++this.depth > MAX_DEPTH) {
      this.depth--;
      throw XsltError("template recursion exceeded " + MAX_DEPTH + " levels (possible infinite recursion)");
    }
    var x = {
      node: node,
      pos: pos,
      size: size,
      vars: EMPTY_SCOPE,
      params: params,
      tpl: tpl,
      mode: mode,
      out: out,
      t: this
    };
    try {
      tpl.body(x);
    } finally {
      this.depth--;
    }
  };
  TP.builtin = function(node, mode, params, out) {
    switch (node.nodeType) {
     case 1:
     case 9:
     case 11:
      {
        var kids = [];
        for (var c = node.firstChild; c; c = c.nextSibling) if (c.nodeType !== 10) kids.push(c);
        if (kids.length) this.applyTemplates(kids, mode, params, out);
        break;
      }

     case 3:
     case 4:
      out.text(node.nodeValue, false);
      break;

     case 2:
      out.text(node.value, false);
      break;
    }
  };
  TP.applyImports = function(x) {
    var tpl = x.tpl;
    if (!tpl) throw XsltError("xsl:apply-imports: no current template rule (not allowed inside xsl:for-each)");
    var found = this.findTemplate(x.node, x.mode, tpl.minPrec, tpl.prec - 1);
    if (found) this.invoke(found, x.node, x.pos, x.size, x.mode, null, x.out); else this.builtin(x.node, x.mode, null, x.out);
  };
  TP.keyLookup = function(name, value, ctxNode) {
    var defs = this.sheet.keys[name];
    if (!defs) {
      warn('key(): unknown key "' + name + '"');
      return [];
    }
    var idx = this.keyIndex(name, defs, rootNode(ctxNode)), vals = [], i;
    if (isArray(value)) {
      for (i = 0; i < value.length; i++) vals.push(stringValue(value[i]));
    } else if (value instanceof Rtf) vals.push(value.text()); else vals.push(toString(value));
    if (vals.length === 1) {
      var l = idx[vals[0]];
      return l ? l.slice() : [];
    }
    var res = [];
    for (i = 0; i < vals.length; i++) if (idx[vals[i]]) res = res.concat(idx[vals[i]]);
    return sortUniq(res);
  };
  TP.keyIndex = function(name, defs, root) {
    var perRoot = this.keyIndexes.get(root);
    if (!perRoot) {
      perRoot = {};
      this.keyIndexes.set(root, perRoot);
    }
    if (perRoot[name]) return perRoot[name];
    var idx = Object.create(null);
    perRoot[name] = idx;
    var wantAttr = false, i, j;
    for (i = 0; i < defs.length; i++) {
      for (j = 0; j < defs[i].match.length; j++) {
        var b = defs[i].match[j].buckets[0];
        if (b === "any" || b.charAt(0) === "a") wantAttr = true;
      }
    }
    var x = this.ctx(root);
    function add(key, node) {
      var l = idx[key];
      if (!l) idx[key] = [ node ]; else if (l[l.length - 1] !== node) l.push(node);
    }
    function visit(node) {
      for (var d = 0; d < defs.length; d++) {
        x.node = node;
        if (!patternMatches(defs[d].match, node, x)) continue;
        var v = evalExpr(defs[d].use, x);
        if (isArray(v)) {
          for (var k = 0; k < v.length; k++) add(stringValue(v[k]), node);
        } else add(toString(v), node);
      }
    }
    var stack = [ root ];
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
  TP.loadDoc = function(url) {
    var hash = url.indexOf("#");
    if (hash >= 0) url = url.substring(0, hash);
    if (hasOwn.call(this.docs, url)) return this.docs[url];
    var doc = null;
    try {
      var src = loadXmlDocument(url);
      doc = prepareDocument(src, this.sheet, url);
    } catch (e) {
      warn("document(): " + e.message);
    }
    this.docs[url] = doc;
    return doc;
  };
  TP.styleDoc = function(file) {
    if (file.styleDoc) return file.styleDoc;
    var doc = newXmlDocument();
    doc.appendChild(doc.importNode(file.root, true));
    stripStylesheetBlanks(doc.documentElement, false);
    numberTree(doc);
    docBaseMap.set(doc, file.base);
    file.styleDoc = doc;
    return doc;
  };
  TP.documentFn = function(arg, baseNodes, cc) {
    var self = this, out = [];
    function load(uri, base) {
      if (uri === "") return self.styleDoc(cc.file);
      return self.loadDoc(resolveUrl(uri, base));
    }
    if (isArray(arg)) {
      for (var i = 0; i < arg.length; i++) {
        var base = baseNodes ? baseNodes.length ? nodeBase(baseNodes[0]) : null : nodeBase(arg[i]);
        var d = load(stringValue(arg[i]), base);
        if (d) out.push(d);
      }
      return sortUniq(out);
    }
    var b = baseNodes ? baseNodes.length ? nodeBase(baseNodes[0]) : null : cc.file.base;
    var d2 = load(toString(arg), b);
    return d2 ? [ d2 ] : [];
  };
  function nodeBase(n) {
    var r = rootNode(n), b = docBaseMap.get(r);
    if (b) return b;
    return global.location ? global.location.href : "";
  }
  function newXmlDocument() {
    return global.document.implementation.createDocument(null, null, null);
  }
  function makeStripper(sheet) {
    var rules = sheet.strip;
    if (!rules.length) return null;
    return function(el) {
      var best = null, ns = nsOf(el), local = el.localName;
      for (var i = 0; i < rules.length; i++) {
        var r = rules[i];
        if (r.local === "*") {
          if (r.uri !== null && r.uri !== ns) continue;
        } else if (r.local !== local || r.uri !== ns) continue;
        if (!best || r.prec > best.prec || r.prec === best.prec && (r.priority > best.priority || r.priority === best.priority && r.order > best.order)) best = r;
      }
      return !!best && best.strip;
    };
  }
  function normalizeTree(root, stripper) {
    var stack = [ {
      node: root,
      preserve: false
    } ];
    while (stack.length) {
      var item = stack.pop(), p = item.node, preserve = item.preserve;
      if (p.nodeType === 1 && p.hasAttributeNS(XML_NS, "space")) {
        var sp = p.getAttributeNS(XML_NS, "space");
        if (sp === "preserve") preserve = true; else if (sp === "default") preserve = false;
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
          if (k.data === "" || strip && isBlank(k.data)) p.removeChild(k);
        } else if (k.nodeType === 1) {
          stack.push({
            node: k,
            preserve: preserve
          });
        } else if (k.nodeType === 10 || k.nodeType === 5) {
          p.removeChild(k);
        }
        k = next;
      }
    }
  }
  function stripStylesheetBlanks(el, preserve) {
    if (el.hasAttributeNS(XML_NS, "space")) preserve = el.getAttributeNS(XML_NS, "space") === "preserve";
    var keep = preserve || el.namespaceURI === XSL_NS && el.localName === "text";
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
  function canUseDirectly(src, stripper) {
    if (stripper || src.nodeType !== 9) return false;
    var stack = [ src ];
    while (stack.length) {
      var n = stack.pop();
      for (var k = n.firstChild; k; k = k.nextSibling) {
        var t = k.nodeType;
        if (t === 4 || t === 5) return false;
        if (t === 3) {
          var nx = k.nextSibling;
          if (k.data === "" || nx && (nx.nodeType === 3 || nx.nodeType === 4)) return false;
        } else if (t === 1 && k.firstChild) stack.push(k);
      }
    }
    return true;
  }
  function prepareDocument(src, sheet, base) {
    var stripper = makeStripper(sheet);
    if (canUseDirectly(src, stripper)) {
      numberTree(src);
      if (base && !docBaseMap.get(src)) docBaseMap.set(src, base);
      return src;
    }
    var doc = newXmlDocument(), nodes = [], c;
    if (src.nodeType === 9 || src.nodeType === 11) {
      for (c = src.firstChild; c; c = c.nextSibling) nodes.push(c);
    } else nodes.push(src);
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      if (n.nodeType === 10) continue;
      if (n.nodeType === 3 || n.nodeType === 4) {
        if (isBlank(n.data)) continue;
        throw XsltError("the source document has text at the top level");
      }
      doc.appendChild(doc.importNode(n, true));
    }
    normalizeTree(doc, stripper);
    numberTree(doc);
    if (base) docBaseMap.set(doc, base);
    return doc;
  }
  var HTML_KNOWN = {}, HTML_EMPTY = {}, HTML_INLINE = {}, HTML_RAW = {};
  (function() {
    var i, list;
    list = ("a abbr acronym address applet area b base basefont bdo bgsound big blockquote body br button caption " + "center cite code col colgroup dd del dfn dir div dl dt em embed fieldset font form frame frameset h1 h2 h3 " + "h4 h5 h6 head hr html i iframe img input ins isindex kbd keygen label legend li link map menu meta noembed " + "noframes noscript object ol optgroup option p param plaintext pre q s samp script select small source span " + "strike strong style sub sup table tbody td textarea tfoot th thead title tr track tt u ul var wbr xmp").split(" ");
    for (i = 0; i < list.length; i++) HTML_KNOWN[list[i]] = true;
    list = "area base basefont bgsound br col embed frame hr img input isindex keygen link meta param source track wbr".split(" ");
    for (i = 0; i < list.length; i++) HTML_EMPTY[list[i]] = true;
    list = ("a abbr acronym applet b basefont bdo big br button cite code del dfn em embed font i iframe img input " + "ins kbd label map object q s samp script select small span strike strong sub sup textarea tt u var xmp").split(" ");
    for (i = 0; i < list.length; i++) HTML_INLINE[list[i]] = true;
    list = "iframe noembed noframes plaintext script style xmp".split(" ");
    for (i = 0; i < list.length; i++) HTML_RAW[list[i]] = true;
  })();
  var HTML_BOOLEAN_ATTRS = {
    checked: 1,
    compact: 1,
    declare: 1,
    defer: 1,
    disabled: 1,
    ismap: 1,
    multiple: 1,
    nohref: 1,
    noresize: 1,
    noshade: 1,
    nowrap: 1,
    readonly: 1,
    selected: 1
  };
  function htmlInfo(e) {
    if (e.ns) return null;
    var n = e.local.toLowerCase();
    if (!HTML_KNOWN[n]) return null;
    return {
      empty: !!HTML_EMPTY[n],
      inline: !!HTML_INLINE[n],
      raw: !!HTML_RAW[n]
    };
  }
  function escXmlText(s) {
    return s.replace(/[&<>\r\x00-\x08\x0B\x0C\x0E-\x1F\uFFFE\uFFFF]/g, function(c) {
      switch (c) {
       case "&":
        return "&amp;";

       case "<":
        return "&lt;";

       case ">":
        return "&gt;";

       case "\r":
        return "&#13;";

       default:
        return "&#xFFFD;";
      }
    });
  }
  function escXmlAttr(s) {
    return s.replace(/[&<>"\t\n\r\x00-\x08\x0B\x0C\x0E-\x1F\uFFFE\uFFFF]/g, function(c) {
      switch (c) {
       case "&":
        return "&amp;";

       case "<":
        return "&lt;";

       case ">":
        return "&gt;";

       case '"':
        return "&quot;";

       case "\t":
        return "&#9;";

       case "\n":
        return "&#10;";

       case "\r":
        return "&#13;";

       default:
        return "&#xFFFD;";
      }
    });
  }
  function escHtmlText(s) {
    return s.replace(/[&<>]/g, function(c) {
      return c === "&" ? "&amp;" : c === "<" ? "&lt;" : "&gt;";
    });
  }
  function escHtmlAttr(s) {
    return s.replace(/[&<>"]/g, function(c) {
      return c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : "&quot;";
    });
  }
  function htmlSerializeUri(s) {
    var out = "", i = 0, n = s.length;
    while (i < n && /[ \t\n\f\r]/.test(s.charAt(i))) {
      out += s.charAt(i);
      i++;
    }
    for (;i < n; i++) {
      var c = s.charCodeAt(i);
      if (c === 34) out += "&quot;"; else if (c === 38) out += "&amp;"; else if (c >= 33 && c <= 126) out += s.charAt(i); else {
        var ch = s.charAt(i);
        if (c >= 55296 && c <= 56319 && i + 1 < n) {
          ch += s.charAt(i + 1);
          i++;
        }
        var bytes = utf8Bytes(ch);
        for (var b = 0; b < bytes.length; b++) out += "%" + (bytes[b] < 16 ? "0" : "") + bytes[b].toString(16).toUpperCase();
      }
    }
    return out;
  }
  function utf8Bytes(ch) {
    var enc = unescape(encodeURIComponent(ch)), out = [];
    for (var i = 0; i < enc.length; i++) out.push(enc.charCodeAt(i));
    return out;
  }
  function qnameOf(n) {
    return n.prefix ? n.prefix + ":" + n.local : n.local;
  }
  function nsDeclsXml(e) {
    var s = "";
    for (var i = 0; i < e.nsDecls.length; i++) {
      var d = e.nsDecls[i];
      s += " xmlns" + (d.prefix ? ":" + d.prefix : "") + '="' + escXmlAttr(d.uri) + '"';
    }
    return s;
  }
  function writeCdata(v) {
    var out = "", start = 0, idx;
    while ((idx = v.indexOf("]]>", start)) >= 0) {
      out += "<![CDATA[" + v.substring(start, idx + 2) + "]]>";
      start = idx + 2;
    }
    return out + "<![CDATA[" + v.substring(start) + "]]>";
  }
  function serializeXml(out, opts) {
    var buf = [], st = {
      format: opts.indent === 1 ? 1 : 0,
      level: 0
    }, cdata = opts.cdata;
    function indent() {
      var n = Math.min(st.level, 30);
      for (var i = 0; i < n; i++) buf.push("  ");
    }
    function dump(n, isRoot) {
      switch (n.type) {
       case 1:
        {
          if (!isRoot && st.format === 1) indent();
          var q = qnameOf(n), s = "<" + q + nsDeclsXml(n);
          for (var i = 0; i < n.attrs.length; i++) {
            var a = n.attrs[i];
            s += " " + (a.prefix ? a.prefix + ":" + a.local : a.local) + '="' + escXmlAttr(a.value) + '"';
          }
          if (!n.children.length) {
            buf.push(s + "/>");
            return;
          }
          var saved = st.format, unformatted = false, isCdata = cdata && cdata[varKey(n.ns, n.local)];
          if (st.format === 1) {
            for (var k = 0; k < n.children.length; k++) {
              if (n.children[k].type === 3) {
                st.format = 0;
                unformatted = true;
                break;
              }
            }
          }
          buf.push(s + ">");
          if (st.format === 1) buf.push("\n");
          st.level++;
          for (var j = 0; j < n.children.length; j++) {
            var c = n.children[j];
            if (c.type === 3 && isCdata && !c.doe) buf.push(writeCdata(c.v)); else dump(c, false);
            if (st.format === 1) buf.push("\n");
          }
          st.level--;
          if (st.format === 1) indent();
          buf.push("</" + q + ">");
          if (unformatted) st.format = saved;
          return;
        }

       case 3:
        buf.push(n.doe ? n.v : escXmlText(n.v));
        return;

       case 8:
        if (!isRoot && st.format === 1) indent();
        buf.push("\x3c!--" + n.v + "--\x3e");
        return;

       case 7:
        if (!isRoot && st.format === 1) indent();
        buf.push("<?" + n.target + (n.v ? " " + n.v : "") + "?>");
        return;
      }
    }
    if (!opts.omitDecl) {
      buf.push('<?xml version="' + (opts.version || "1.0") + '"');
      if (opts.encoding) buf.push(' encoding="' + opts.encoding + '"');
      if (opts.standalone === 1) buf.push(' standalone="yes"'); else if (opts.standalone === 0) buf.push(' standalone="no"');
      buf.push("?>\n");
    }
    var top = out.root.children;
    if (opts.doctype) {
      var dt = opts.doctype;
      buf.push("<!DOCTYPE " + dt.name + (dt.pub !== null ? ' PUBLIC "' + dt.pub + '" "' + (dt.sys || "") + '"' : dt.sys !== null ? ' SYSTEM "' + dt.sys + '"' : "") + ">");
      if (opts.indent !== 0) buf.push("\n");
    }
    for (var i = 0; i < top.length; i++) {
      dump(top[i], true);
      if (opts.indent !== 0 && top[i].type === 8 && i + 1 < top.length) buf.push("\n");
    }
    if (opts.indent !== 0) buf.push("\n");
    return buf.join("");
  }
  function serializeHtml(out, opts) {
    var buf = [], format = opts.indent !== 0, state = {
      raw: false
    };
    if (opts.doctype) {
      var dt = opts.doctype;
      buf.push("<!DOCTYPE " + dt.name);
      if (dt.pub !== null) {
        buf.push(' PUBLIC "' + dt.pub + '"');
        if (dt.sys !== null) buf.push(' "' + dt.sys + '"');
      } else if (dt.sys !== null && dt.sys !== "about:legacy-compat") {
        buf.push(' SYSTEM "' + dt.sys + '"');
      }
      buf.push(">\n");
    }
    function attrHtml(e, a) {
      var name = a.prefix ? a.prefix + ":" + a.local : a.local;
      if (HTML_BOOLEAN_ATTRS[a.local.toLowerCase()] && !a.prefix) return " " + name;
      var lname = a.local.toLowerCase(), v;
      if (!a.ns && !e.ns && (lname === "href" || lname === "action" || lname === "src" || lname === "name" && e.local.toLowerCase() === "a")) v = htmlSerializeUri(a.value); else v = escHtmlAttr(a.value);
      return " " + name + '="' + v + '"';
    }
    function dump(cur, parent) {
      var info, i;
      switch (cur.type) {
       case 1:
        {
          info = format ? htmlInfo(cur) : null;
          var full = htmlInfo(cur);
          var q = qnameOf(cur), s = "<" + q + nsDeclsXml(cur);
          for (i = 0; i < cur.attrs.length; i++) s += attrHtml(cur, cur.attrs[i]);
          buf.push(s);
          var ch = cur.children;
          if (full && full.empty) {
            buf.push(">");
          } else if (!ch.length) {
            buf.push("></" + q + ">");
          } else {
            buf.push(">");
            var first = ch[0], last = ch[ch.length - 1];
            if (info && !info.inline && first.type !== 3 && ch.length > 1 && cur.local.charAt(0) !== "p") buf.push("\n");
            if (full && full.raw) state.raw = true;
            for (i = 0; i < ch.length; i++) dump(ch[i], cur);
            state.raw = false;
            if (info && !info.inline && last.type !== 3 && ch.length > 1 && cur.local.charAt(0) !== "p") buf.push("\n");
            buf.push("</" + q + ">");
          }
          if (info && !info.inline) {
            var sib = parent.children, idx = sib.indexOf(cur), next = sib[idx + 1];
            if (next && next.type !== 3 && parent.type === 1 && parent.local.charAt(0) !== "p") buf.push("\n");
          }
          return;
        }

       case 3:
        buf.push(cur.doe || state.raw ? cur.v : escHtmlText(cur.v));
        return;

       case 8:
        buf.push("\x3c!--" + cur.v + "--\x3e");
        return;

       case 7:
        buf.push("<?" + cur.target + (cur.v ? " " + cur.v : "") + ">");
        return;
      }
    }
    var top = out.root.children;
    for (var k = 0; k < top.length; k++) dump(top[k], out.root);
    buf.push("\n");
    return buf.join("");
  }
  function serializeText(out) {
    var buf = [];
    (function walk(list) {
      for (var i = 0; i < list.length; i++) {
        var c = list[i];
        if (c.type === 3) buf.push(c.v); else if (c.type === 1) walk(c.children);
      }
    })(out.root.children);
    return buf.join("");
  }
  function findChildIgnoreCase(parent, name) {
    for (var i = 0; i < parent.children.length; i++) {
      var c = parent.children[i];
      if (c.type === 1 && c.local.toLowerCase() === name) return c;
    }
    return null;
  }
  function metaCharsetRange(meta) {
    if (meta.type !== 1 || meta.local.toLowerCase() !== "meta") return null;
    var i, a, httpEquiv = false, content = null;
    for (i = 0; i < meta.attrs.length; i++) {
      a = meta.attrs[i];
      if (a.ns) continue;
      var ln = a.local.toLowerCase();
      if (ln === "charset") {
        var v = a.value, s = 0, e = v.length;
        while (s < e && /[ \t\n\f\r]/.test(v.charAt(s))) s++;
        while (e > s && /[ \t\n\f\r]/.test(v.charAt(e - 1))) e--;
        return {
          attr: a,
          start: s,
          end: e
        };
      }
      if (ln === "http-equiv" && a.value.toLowerCase() === "content-type") httpEquiv = true;
      if (ln === "content") content = a;
    }
    if (!httpEquiv || !content) return null;
    var cv = content.value, m = /charset\s*=\s*/i.exec(cv);
    if (!m) return null;
    var st = m.index + m[0].length, en = st;
    var q = cv.charAt(st);
    if (q === '"' || q === "'") {
      st++;
      en = cv.indexOf(q, st);
      if (en < 0) en = cv.length;
    } else {
      while (en < cv.length && !/[ \t\n\f\r;]/.test(cv.charAt(en))) en++;
    }
    return {
      attr: content,
      start: st,
      end: en
    };
  }
  function setMetaEncoding(out, encoding) {
    var html = findChildIgnoreCase(out.root, "html");
    if (!html) return;
    var head = findChildIgnoreCase(html, "head");
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
    head.children.unshift({
      type: 1,
      prefix: "",
      local: "meta",
      ns: "",
      nsDecls: [],
      children: [],
      parent: head,
      attrs: [ {
        prefix: "",
        local: "charset",
        ns: "",
        value: encoding
      } ]
    });
  }
  var HTML_VERSIONS = {
    5: [ null, "about:legacy-compat" ],
    "4.01frame": [ "-//W3C//DTD HTML 4.01 Frameset//EN", "http://www.w3.org/TR/1999/REC-html401-19991224/frameset.dtd" ],
    "4.01strict": [ "-//W3C//DTD HTML 4.01//EN", "http://www.w3.org/TR/1999/REC-html401-19991224/strict.dtd" ],
    "4.01trans": [ "-//W3C//DTD HTML 4.01 Transitional//EN", "http://www.w3.org/TR/1999/REC-html401-19991224/loose.dtd" ],
    4.01: [ "-//W3C//DTD HTML 4.01 Transitional//EN", "http://www.w3.org/TR/1999/REC-html401-19991224/loose.dtd" ],
    "4.0strict": [ "-//W3C//DTD HTML 4.01//EN", "http://www.w3.org/TR/html4/strict.dtd" ],
    "4.0trans": [ "-//W3C//DTD HTML 4.01 Transitional//EN", "http://www.w3.org/TR/html4/loose.dtd" ],
    "4.0frame": [ "-//W3C//DTD HTML 4.01 Frameset//EN", "http://www.w3.org/TR/html4/frameset.dtd" ],
    "4.0": [ "-//W3C//DTD HTML 4.01 Transitional//EN", "http://www.w3.org/TR/html4/loose.dtd" ],
    3.2: [ "-//W3C//DTD HTML 3.2//EN", null ]
  };
  function serializeResult(sheet, out, forceHtml) {
    var o = sheet.output;
    function get(k) {
      return o[k] ? o[k].value : null;
    }
    var method = get("method"), version = get("version"), encoding = get("encoding");
    var dpub = get("doctype-public"), dsys = get("doctype-system");
    var indentAttr = get("indent"), indent = indentAttr === "yes" ? 1 : indentAttr === "no" ? 0 : -1;
    if (forceHtml && !(o.method && o.method.prec === sheet.prec)) method = "html";
    var top = out.root.children, rootEl = null, i;
    for (i = 0; i < top.length; i++) if (top[i].type === 1) {
      rootEl = top[i];
      break;
    }
    var htmlDoc = false, doctype = null;
    if (method === "html") {
      htmlDoc = true;
      if (dpub !== null || dsys !== null) doctype = {
        name: "html",
        pub: dpub,
        sys: dsys
      }; else if (version !== null) {
        var ids = HTML_VERSIONS[version.toLowerCase()];
        if (ids) doctype = {
          name: "html",
          pub: ids[0],
          sys: ids[1]
        }; else doctype = {
          name: "html",
          pub: "-//W3C//DTD HTML 4.0 Transitional//EN",
          sys: "http://www.w3.org/TR/REC-html40/loose.dtd"
        };
      }
    } else if (method === null && rootEl && !rootEl.ns && rootEl.local.toLowerCase() === "html") {
      var ok = true;
      for (i = 0; i < top.length && top[i] !== rootEl; i++) {
        if (top[i].type === 3 && !isBlank(top[i].v)) {
          ok = false;
          break;
        }
      }
      if (ok) {
        htmlDoc = true;
        var dname = qnameOf(rootEl);
        if (dpub !== null || dsys !== null) doctype = {
          name: dname,
          pub: dpub,
          sys: dsys
        }; else if (version !== null) {
          var ids2 = HTML_VERSIONS[version.toLowerCase()];
          if (ids2 && (ids2[0] !== null || ids2[1] !== null)) doctype = {
            name: dname,
            pub: ids2[0],
            sys: ids2[1]
          };
        }
      }
    }
    if (!htmlDoc && method !== "text" && rootEl && (dpub !== null || dsys !== null)) {
      doctype = {
        name: qnameOf(rootEl),
        pub: dpub,
        sys: dsys
      };
    }
    var effective = method === null && htmlDoc ? "html" : method;
    var mime = effective === "html" ? "text/html" : effective === "text" ? "text/plain" : "application/xml";
    if (!top.length) return {
      text: "",
      mime: mime
    };
    var text;
    if (effective === "html") {
      setMetaEncoding(out, encoding || "UTF-8");
      text = serializeHtml(out, {
        indent: indent === -1 ? 1 : indent,
        doctype: doctype
      });
    } else if (effective === "text") {
      text = serializeText(out);
    } else {
      var sa = get("standalone");
      text = serializeXml(out, {
        indent: indent,
        doctype: doctype,
        cdata: sheet.cdata,
        version: version,
        encoding: encoding,
        omitDecl: true,
        standalone: sa === "yes" ? 1 : sa === "no" ? 0 : -1
      });
    }
    if (text.charAt(text.length - 1) === "\n") text = text.substring(0, text.length - 1);
    return {
      text: text,
      mime: mime
    };
  }
  function isHtmlDocument(doc) {
    if (!doc) return false;
    if (typeof global.HTMLDocument !== "undefined" && doc instanceof global.HTMLDocument) return true;
    return doc.contentType === "text/html";
  }
  function buildFragment(result, outDoc) {
    var frag = outDoc.createDocumentFragment();
    if (result.mime === "text/plain") {
      frag.appendChild(outDoc.createTextNode(result.text));
      return frag;
    }
    if (result.mime === "text/html") {
      var body;
      if (isHtmlDocument(outDoc)) {
        body = outDoc.createElement("body");
        body.innerHTML = result.text;
      } else {
        var hdoc = (new global.DOMParser).parseFromString("<!DOCTYPE html><html><head></head><body></body></html>", "text/html");
        hdoc.body.innerHTML = result.text;
        body = outDoc.importNode(hdoc.body, true);
      }
      while (body.firstChild) frag.appendChild(body.firstChild);
      return frag;
    }
    var src = result.text.replace(/^<\?xml[^>]*\?>\s*/, "");
    var wrapped = "<xsltjs-fragment-root>" + src + "</xsltjs-fragment-root>";
    var xdoc = (new global.DOMParser).parseFromString(wrapped, "application/xml");
    if (isParseError(xdoc)) return null;
    var r = xdoc.documentElement;
    for (var c = r.firstChild; c; c = c.nextSibling) {
      if (c.nodeType === 10) continue;
      frag.appendChild(outDoc.importNode(c, true));
    }
    return frag;
  }
  function buildDocument(result) {
    var parser = new global.DOMParser;
    if (result.mime === "text/html") return parser.parseFromString(result.text, "text/html");
    if (result.mime === "text/plain") {
      var t = result.text.replace(/&/g, "&amp;").replace(/</g, "&lt;");
      return parser.parseFromString('<?xml version="1.0" encoding="UTF-8"?>\n' + '<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Strict//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-strict.dtd">\n' + '<html xmlns="http://www.w3.org/1999/xhtml">\n<head><title/></head>\n<body>\n<pre>' + t + "</pre>\n</body>\n</html>\n", "application/xhtml+xml");
    }
    return parser.parseFromString(result.text, "application/xml");
  }
  var serializer = null;
  function serializeNode(n) {
    if (!serializer) serializer = new global.XMLSerializer;
    return serializer.serializeToString(n);
  }
  function reportError(e) {
    if (global.console && global.console.error) {
      global.console.error("[xslt-bridge] transformation failed: " + (e && e.message ? e.message : e));
    }
  }
  function XsltBridge() {
    if (!(this instanceof XsltBridge)) throw new TypeError("Failed to construct 'XSLTProcessor': Please use the 'new' operator");
    this._node = null;
    this._key = null;
    this._sheet = null;
    this._params = {};
  }
  XsltBridge.prototype.importStylesheet = function(node) {
    if (!node || node.nodeType !== 9 && node.nodeType !== 1) {
      throw new TypeError("Failed to execute 'importStylesheet' on 'XSLTProcessor': parameter 1 is not of type 'Node'.");
    }
    this._node = node;
    this._key = null;
    this._sheet = null;
  };
  XsltBridge.prototype._compiled = function() {
    var key = serializeNode(this._node);
    if (!this._sheet || key !== this._key) {
      this._sheet = compileStylesheet(this._node);
      this._key = key;
    }
    return this._sheet;
  };
  XsltBridge.prototype._transform = function(source, forceHtml) {
    var sheet = this._compiled();
    var srcDoc = source.nodeType === 9 ? source : source.ownerDocument;
    var base = srcDoc && docBaseMap.get(srcDoc) || srcDoc && srcDoc.URL || "";
    var doc = prepareDocument(source, sheet, base);
    var t = new Transform(sheet, this._params);
    var out = t.run(doc);
    return serializeResult(sheet, out, forceHtml);
  };
  XsltBridge.prototype.transformToString = function(source) {
    return this._transform(source, false).text;
  };
  XsltBridge.prototype.transformToFragment = function(source, output) {
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
  XsltBridge.prototype.transformToDocument = function(source) {
    if (!source) throw new TypeError("Failed to execute 'transformToDocument' on 'XSLTProcessor': 1 argument required.");
    if (!this._node) return null;
    try {
      return buildDocument(this._transform(source, false));
    } catch (e) {
      reportError(e);
      return null;
    }
  };
  XsltBridge.prototype.setParameter = function(ns, name, value) {
    this._params[String(name)] = String(value);
  };
  XsltBridge.prototype.getParameter = function(ns, name) {
    name = String(name);
    return hasOwn.call(this._params, name) ? this._params[name] : null;
  };
  XsltBridge.prototype.removeParameter = function(ns, name) {
    delete this._params[String(name)];
  };
  XsltBridge.prototype.clearParameters = function() {
    this._params = {};
  };
  XsltBridge.prototype.reset = function() {
    this._node = null;
    this._key = null;
    this._sheet = null;
    this._params = {};
  };
  XsltBridge.version = "1.0.0";
  XsltBridge.isXsltBridge = true;
  XsltBridge.loadDocument = null;
  function fragmentMarkup(v) {
    if (!v) return String(v);
    if (v.nodeType === 11) {
      var s = "";
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
      global.console.warn("[xslt-bridge compare] " + kind + " result differs from the native processor (offset " + i + ")\n" + "  native: " + JSON.stringify(a.substring(Math.max(0, i - 60), i + 60)) + "\n" + "  engine: " + JSON.stringify(b.substring(Math.max(0, i - 60), i + 60)));
    }
  }
  function makeCompareProcessor(Native) {
    function CompareProcessor() {
      this._n = new Native;
      this._j = new XsltBridge;
    }
    function both(name) {
      CompareProcessor.prototype[name] = function() {
        var r = this._n[name].apply(this._n, arguments);
        try {
          this._j[name].apply(this._j, arguments);
        } catch (e) {
          reportError(e);
        }
        return r;
      };
    }
    both("importStylesheet");
    both("setParameter");
    both("removeParameter");
    both("clearParameters");
    both("reset");
    CompareProcessor.prototype.getParameter = function(ns, name) {
      return this._n.getParameter(ns, name);
    };
    CompareProcessor.prototype.transformToFragment = function(src, doc) {
      var r = this._n.transformToFragment(src, doc);
      try {
        reportDiff("transformToFragment", fragmentMarkup(r), fragmentMarkup(this._j.transformToFragment(src, doc)));
      } catch (e) {
        reportError(e);
      }
      return r;
    };
    CompareProcessor.prototype.transformToDocument = function(src) {
      var r = this._n.transformToDocument(src);
      try {
        reportDiff("transformToDocument", fragmentMarkup(r), fragmentMarkup(this._j.transformToDocument(src)));
      } catch (e) {
        reportError(e);
      }
      return r;
    };
    return CompareProcessor;
  }
  if (typeof module === "object" && module && module.exports) module.exports = XsltBridge;
  if (!global) return;
  if (global.XsltBridge && global.XsltBridge.isXsltBridge) return;
  global.XsltBridge = XsltBridge;
  var mode = global.XSLT_BRIDGE_MODE || "replace";
  var desc = null;
  try {
    desc = Object.getOwnPropertyDescriptor(global, "XSLTProcessor");
  } catch (e0) {
    desc = null;
  }
  function readNative() {
    if (!desc) return undefined;
    try {
      return desc.get ? desc.get.call(global) : desc.value;
    } catch (e1) {
      return undefined;
    }
  }
  function installProcessor(impl) {
    try {
      Object.defineProperty(global, "XSLTProcessor", {
        value: impl,
        writable: true,
        configurable: true,
        enumerable: desc ? !!desc.enumerable : false
      });
    } catch (e2) {
      global.XSLTProcessor = impl;
    }
  }
  function exposeNativeLazily() {
    if (!desc) return;
    try {
      Object.defineProperty(global, "XSLTProcessorNative", {
        configurable: true,
        get: readNative
      });
    } catch (e3) {}
  }
  if (mode === "replace") {
    exposeNativeLazily();
    installProcessor(XsltBridge);
  } else if (mode === "fallback" || mode === "compare") {
    var Native = readNative(), nativeWorks = false;
    if (typeof Native === "function" && !Native.isXsltBridge) {
      try {
        new Native;
        nativeWorks = true;
      } catch (e4) {
        nativeWorks = false;
      }
    }
    if (nativeWorks) global.XSLTProcessorNative = Native;
    if (mode === "fallback") {
      if (!nativeWorks) installProcessor(XsltBridge);
    } else if (nativeWorks) {
      installProcessor(makeCompareProcessor(Native));
    }
  }
})(typeof window !== "undefined" ? window : null);
