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
(function (global) {
  'use strict';

  var XSL_NS = 'http://www.w3.org/1999/XSL/Transform';
  var XMLNS_NS = 'http://www.w3.org/2000/xmlns/';
  var XML_NS = 'http://www.w3.org/XML/1998/namespace';
  var XHTML_NS = 'http://www.w3.org/1999/xhtml';
  var EXSLT_COMMON_NS = 'http://exslt.org/common';
  var MSXSL_NS = 'urn:schemas-microsoft-com:xslt';
  var MAX_DEPTH = 3000;

  var hasOwn = Object.prototype.hasOwnProperty;
  var objToString = Object.prototype.toString;

  function XsltError(message) {
    var e = new Error(message);
    e.name = 'XsltError';
    e.isXsltError = true;
    return e;
  }

  function isArray(v) { return objToString.call(v) === '[object Array]'; }

  function isBlankCode(c) { return c === 0x20 || c === 0x09 || c === 0x0A || c === 0x0D; }

  function isBlank(s) {
    for (var i = 0; i < s.length; i++) {
      if (!isBlankCode(s.charCodeAt(i))) return false;
    }
    return true;
  }

  // ---------------------------------------------------------------------------
  // 숫자 -> 문자열 : libxml2 xmlXPathFormatNumber 이식
  //   - int 범위 정수는 그대로
  //   - |x| > 1e9 또는 < 1e-5 이면 지수 표기 (예: 1e+10, 1e-06)
  //   - 그 외에는 유효숫자 15자리 고정 소수점 후 뒤쪽 0 제거 (예: 0.1+0.2 -> 0.3)
  // ---------------------------------------------------------------------------
  var INT_MAX = 2147483647, INT_MIN = -2147483648;

  function trimFractionZeros(s) {
    if (s.indexOf('.') < 0) return s;
    var end = s.length;
    while (end > 0 && s.charAt(end - 1) === '0') end--;
    if (s.charAt(end - 1) === '.') end--;
    return s.substring(0, end);
  }

  function incrementDigits(ds) {
    var arr = ds.split(''), i = arr.length - 1;
    while (i >= 0) {
      if (arr[i] === '9') { arr[i] = '0'; i--; }
      else { arr[i] = String.fromCharCode(arr[i].charCodeAt(0) + 1); return arr.join(''); }
    }
    return '1' + arr.join('');
  }

  // printf("%.*f") 와 같은 결과 (정확히 중간값이면 짝수 쪽으로 반올림)
  function cFixed(x, digits) {
    var neg = x < 0, ax = neg ? -x : x, exact;
    try { exact = ax.toFixed(100); } catch (e) { return x.toFixed(digits); }
    var dot = exact.indexOf('.');
    var intPart = exact.substring(0, dot), frac = exact.substring(dot + 1);
    var keep = frac.substring(0, digits), rest = frac.substring(digits);
    var first = rest.length ? rest.charCodeAt(0) - 48 : 0, up = false;
    if (first > 5) up = true;
    else if (first === 5) {
      if (/[1-9]/.test(rest.substring(1))) up = true;
      else {
        var lastCh = keep.length ? keep.charAt(keep.length - 1) : intPart.charAt(intPart.length - 1);
        up = ((lastCh.charCodeAt(0) - 48) % 2) === 1;
      }
    }
    var all = intPart + keep;
    if (up) all = incrementDigits(all);
    var ip = all.substring(0, all.length - keep.length), fp = all.substring(all.length - keep.length);
    return (neg ? '-' : '') + (digits > 0 ? ip + '.' + fp : ip);
  }

  function numberToString(x) {
    if (x !== x) return 'NaN';
    if (x === Infinity) return 'Infinity';
    if (x === -Infinity) return '-Infinity';
    if (x === 0) return '0';
    if (x > INT_MIN && x < INT_MAX && x === Math.floor(x)) return String(x);
    var ax = Math.abs(x);
    if (ax > 1e9 || ax < 1e-5) {
      var s = x.toExponential(14), ep = s.indexOf('e');
      var mant = trimFractionZeros(s.substring(0, ep));
      var sign = s.charAt(ep + 1), ed = s.substring(ep + 2);
      if (ed.length < 2) ed = '0' + ed;
      return mant + 'e' + sign + ed;
    }
    var lg = Math.log10 ? Math.log10(ax) : Math.log(ax) / Math.LN10;
    var ip = lg >= 0 ? Math.floor(lg) : Math.ceil(lg);
    var fp = ip > 0 ? 15 - ip - 1 : 15 - ip;
    return trimFractionZeros(cFixed(x, fp));
  }

  // ---------------------------------------------------------------------------
  // 문자열 -> 숫자 : libxml2 xmlXPathStringEvalNumber 이식 (지수 표기 허용)
  // ---------------------------------------------------------------------------
  function scanNumber(s, i, n, allowTrailing) {
    // 반환: { value, end } / 숫자 형식이 아니면 null
    var c = s.charCodeAt(i), ret = 0, ok = false;
    if (s.charAt(i) !== '.' && !(c >= 48 && c <= 57)) return null;
    while (i < n && (c = s.charCodeAt(i)) >= 48 && c <= 57) { ret = ret * 10 + (c - 48); ok = true; i++; }
    if (s.charAt(i) === '.') {
      i++;
      c = s.charCodeAt(i);
      if (!(c >= 48 && c <= 57) && !ok) return null;
      var frac = 0, fraction = 0;
      while (s.charAt(i) === '0') { frac++; i++; }
      var max = frac + 20;
      while (i < n && (c = s.charCodeAt(i)) >= 48 && c <= 57 && frac < max) {
        fraction = fraction * 10 + (c - 48); frac++; i++;
      }
      fraction /= Math.pow(10, frac);
      ret = ret + fraction;
      while (i < n && (c = s.charCodeAt(i)) >= 48 && c <= 57) i++;
    }
    var exponent = 0, eneg = false, hasExp = false;
    if (s.charAt(i) === 'e' || s.charAt(i) === 'E') {
      hasExp = true;
      i++;
      if (s.charAt(i) === '-') { eneg = true; i++; } else if (s.charAt(i) === '+') { i++; }
      while (i < n && (c = s.charCodeAt(i)) >= 48 && c <= 57) {
        if (exponent < 1000000) exponent = exponent * 10 + (c - 48);
        i++;
      }
    }
    return { value: ret, end: i, exponent: eneg ? -exponent : exponent, hasExp: hasExp };
  }

  function stringToNumber(s) {
    var n = s.length, i = 0, neg = false;
    while (i < n && isBlankCode(s.charCodeAt(i))) i++;
    if (s.charAt(i) === '-') { neg = true; i++; }
    var r = scanNumber(s, i, n);
    if (!r) return NaN;
    i = r.end;
    while (i < n && isBlankCode(s.charCodeAt(i))) i++;
    if (i < n) return NaN;
    var v = neg ? -r.value : r.value;
    v *= Math.pow(10, r.exponent);
    return v;
  }

  // 코드포인트 단위 문자열 처리 (XPath 는 UTF-16 코드 단위가 아니라 문자 단위)
  var SURROGATE_RE = /[\uD800-\uDFFF]/;
  function toChars(s) {
    if (!SURROGATE_RE.test(s)) return null;
    var out = [];
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      if (c >= 0xD800 && c <= 0xDBFF && i + 1 < s.length) {
        var d = s.charCodeAt(i + 1);
        if (d >= 0xDC00 && d <= 0xDFFF) { out.push(s.substring(i, i + 2)); i++; continue; }
      }
      out.push(s.charAt(i));
    }
    return out;
  }

  // 코드포인트 비교 (xmlStrcmp 는 UTF-8 바이트 비교 = 코드포인트 순서)
  function compareCodePoints(a, b) {
    if (a === b) return 0;
    if (!SURROGATE_RE.test(a) && !SURROGATE_RE.test(b)) return a < b ? -1 : 1;
    var ca = toChars(a) || a.split(''), cb = toChars(b) || b.split('');
    var n = Math.min(ca.length, cb.length);
    for (var i = 0; i < n; i++) {
      if (ca[i] !== cb[i]) {
        var x = ca[i].length === 2 ? ((ca[i].charCodeAt(0) - 0xD800) * 0x400 + ca[i].charCodeAt(1) - 0xDC00 + 0x10000) : ca[i].charCodeAt(0);
        var y = cb[i].length === 2 ? ((cb[i].charCodeAt(0) - 0xD800) * 0x400 + cb[i].charCodeAt(1) - 0xDC00 + 0x10000) : cb[i].charCodeAt(0);
        return x < y ? -1 : 1;
      }
    }
    return ca.length < cb.length ? -1 : (ca.length > cb.length ? 1 : 0);
  }
