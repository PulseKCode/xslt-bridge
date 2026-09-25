
  // ---------------------------------------------------------------------------
  // XPath 토크나이저
  // ---------------------------------------------------------------------------
  var NAME_START_RE = /[A-Za-z_\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u02FF\u0370-\u037D\u037F-\u1FFF\u200C\u200D\u2070-\u218F\u2C00-\u2FEF\u3001-\uD7FF\uD800-\uDFFF\uF900-\uFDCF\uFDF0-\uFFFD]/;
  var NAME_CHAR_RE = /[-.0-9A-Za-z_\u00B7\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u037D\u037F-\u1FFF\u200C\u200D\u203F\u2040\u2070-\u218F\u2C00-\u2FEF\u3001-\uD7FF\uD800-\uDFFF\uF900-\uFDCF\uFDF0-\uFFFD]/;
  var AXIS_NAMES = {
    'ancestor': 1, 'ancestor-or-self': 1, 'attribute': 1, 'child': 1, 'descendant': 1,
    'descendant-or-self': 1, 'following': 1, 'following-sibling': 1, 'namespace': 1,
    'parent': 1, 'preceding': 1, 'preceding-sibling': 1, 'self': 1
  };
  var NODE_TYPE_NAMES = { 'comment': 1, 'text': 1, 'processing-instruction': 1, 'node': 1 };
  var OPERATOR_NAMES = { 'and': 1, 'or': 1, 'mod': 1, 'div': 1 };

  function isNameStart(ch) { return ch !== '' && NAME_START_RE.test(ch); }
  function isNameChar(ch) { return ch !== '' && NAME_CHAR_RE.test(ch); }

  function xpathError(expr, msg) { return XsltError('XPath error: ' + msg + ' in "' + expr + '"'); }

  function tokenize(expr) {
    var toks = [], i = 0, len = expr.length;

    function prevAllowsOperator() {
      if (!toks.length) return false;
      var p = toks[toks.length - 1];
      if (p.type === 'op') return false;
      if (p.type === 'punct' && (p.value === '@' || p.value === '::' || p.value === '(' ||
          p.value === '[' || p.value === ',')) return false;
      return true;
    }

    while (i < len) {
      var ch = expr.charAt(i);
      if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') { i++; continue; }
      var two = expr.substr(i, 2);
      if (two === '//') { toks.push({ type: 'op', value: '//' }); i += 2; continue; }
      if (two === '::') { toks.push({ type: 'punct', value: '::' }); i += 2; continue; }
      if (two === '!=' || two === '<=' || two === '>=') { toks.push({ type: 'op', value: two }); i += 2; continue; }
      var nextCode = expr.charCodeAt(i + 1);
      if ((ch >= '0' && ch <= '9') || (ch === '.' && nextCode >= 48 && nextCode <= 57)) {
        var r = scanNumber(expr, i, len);
        if (!r) throw xpathError(expr, 'invalid number');
        toks.push({ type: 'number', value: r.value * Math.pow(10, r.exponent) });
        i = r.end;
        continue;
      }
      if (two === '..') { toks.push({ type: 'punct', value: '..' }); i += 2; continue; }
      if (ch === '(' || ch === ')' || ch === '[' || ch === ']' || ch === '@' || ch === ',' || ch === '.') {
        toks.push({ type: 'punct', value: ch }); i++; continue;
      }
      if (ch === '/' || ch === '|' || ch === '+' || ch === '-' || ch === '=' || ch === '<' || ch === '>') {
        toks.push({ type: 'op', value: ch }); i++; continue;
      }
      if (ch === '*') {
        if (prevAllowsOperator()) toks.push({ type: 'op', value: '*' });
        else toks.push({ type: 'name', prefix: null, local: '*' });
        i++;
        continue;
      }
      if (ch === '"' || ch === "'") {
        var end = expr.indexOf(ch, i + 1);
        if (end < 0) throw xpathError(expr, 'unterminated string literal');
        toks.push({ type: 'literal', value: expr.substring(i + 1, end) });
        i = end + 1;
        continue;
      }
      if (ch === '$') {
        i++;
        var q = readQName();
        if (!q) throw xpathError(expr, 'variable name expected');
        toks.push({ type: 'var', prefix: q.prefix, local: q.local });
        continue;
      }
      if (isNameStart(ch)) {
        var qn = readQName();
        if (qn.local === '*') { toks.push({ type: 'name', prefix: qn.prefix, local: '*' }); continue; }
        if (qn.prefix === null && prevAllowsOperator() && OPERATOR_NAMES[qn.local]) {
          toks.push({ type: 'op', value: qn.local });
          continue;
        }
        var j = i;
        while (j < len && /\s/.test(expr.charAt(j))) j++;
        if (expr.charAt(j) === '(') {
          if (qn.prefix === null && NODE_TYPE_NAMES[qn.local]) toks.push({ type: 'nodetype', value: qn.local });
          else toks.push({ type: 'func', prefix: qn.prefix, local: qn.local });
          continue;
        }
        if (qn.prefix === null && expr.substr(j, 2) === '::') { toks.push({ type: 'axis', value: qn.local }); continue; }
        toks.push({ type: 'name', prefix: qn.prefix, local: qn.local });
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
      if (expr.charAt(i) === ':' && expr.charAt(i + 1) !== ':') {
        if (expr.charAt(i + 1) === '*') { i += 2; return { prefix: first, local: '*' }; }
        if (isNameStart(expr.charAt(i + 1))) {
          var s2 = i + 1;
          i += 2;
          while (i < len && isNameChar(expr.charAt(i))) i++;
          return { prefix: first, local: expr.substring(s2, i) };
        }
      }
      return { prefix: null, local: first };
    }
  }

  // ---------------------------------------------------------------------------
  // XPath 파서 -> AST
  // ---------------------------------------------------------------------------
  var DESC_OR_SELF_STEP = { axis: 'descendant-or-self', test: { t: 'node' }, preds: [] };

  function Parser(expr) {
    this.expr = expr;
    this.toks = tokenize(expr);
    this.i = 0;
  }
  Parser.prototype.peek = function () { return this.toks[this.i]; };
  Parser.prototype.next = function () { return this.toks[this.i++]; };
  Parser.prototype.isOp = function (v) { var t = this.toks[this.i]; return !!t && t.type === 'op' && t.value === v; };
  Parser.prototype.isPunct = function (v) { var t = this.toks[this.i]; return !!t && t.type === 'punct' && t.value === v; };
  Parser.prototype.fail = function (msg) { throw xpathError(this.expr, msg); };
  Parser.prototype.expectPunct = function (v) {
    var t = this.next();
    if (!t || t.type !== 'punct' || t.value !== v) this.fail('"' + v + '" expected');
  };
  Parser.prototype.parseAll = function () {
    if (!this.toks.length) this.fail('empty expression');
    var e = this.parseOr();
    if (this.i < this.toks.length) this.fail('unexpected token after end of expression');
    return e;
  };
  Parser.prototype.binary = function (sub, ops, kind) {
    var left = sub.call(this);
    for (;;) {
      var t = this.peek();
      if (!t || t.type !== 'op' || !ops[t.value]) return left;
      this.next();
      left = { k: kind, op: t.value, a: left, b: sub.call(this) };
    }
  };
  Parser.prototype.parseOr = function () { return this.binary(this.parseAnd, { 'or': 1 }, 'or'); };
  Parser.prototype.parseAnd = function () { return this.binary(this.parseEquality, { 'and': 1 }, 'and'); };
  Parser.prototype.parseEquality = function () { return this.binary(this.parseRelational, { '=': 1, '!=': 1 }, 'cmp'); };
  Parser.prototype.parseRelational = function () { return this.binary(this.parseAdditive, { '<': 1, '<=': 1, '>': 1, '>=': 1 }, 'cmp'); };
  Parser.prototype.parseAdditive = function () { return this.binary(this.parseMultiplicative, { '+': 1, '-': 1 }, 'arith'); };
  Parser.prototype.parseMultiplicative = function () { return this.binary(this.parseUnary, { '*': 1, 'div': 1, 'mod': 1 }, 'arith'); };
  Parser.prototype.parseUnary = function () {
    if (this.isOp('-')) { this.next(); return { k: 'neg', a: this.parseUnary() }; }
    return this.parseUnion();
  };
  Parser.prototype.parseUnion = function () {
    var left = this.parsePath();
    while (this.isOp('|')) {
      this.next();
      left = { k: 'union', a: left, b: this.parsePath() };
    }
    return left;
  };
  Parser.prototype.parsePath = function () {
    var t = this.peek();
    if (!t) this.fail('unexpected end of expression');
    if (t.type === 'op' && (t.value === '/' || t.value === '//')) return this.parseLocationPath();
    if (t.type === 'var' || t.type === 'literal' || t.type === 'number' || t.type === 'func' ||
        (t.type === 'punct' && t.value === '(')) {
      var filter = this.parseFilter();
      if (this.isOp('/') || this.isOp('//')) {
        return { k: 'path', filter: filter, absolute: false, steps: this.parseRelativeSteps(true) };
      }
      return filter;
    }
    return this.parseLocationPath();
  };
  Parser.prototype.startsStep = function (t) {
    if (!t) return false;
    if (t.type === 'name' || t.type === 'axis' || t.type === 'nodetype') return true;
    return t.type === 'punct' && (t.value === '.' || t.value === '..' || t.value === '@');
  };
  Parser.prototype.parseRelativeSteps = function (leadingSep) {
    var steps = [];
    if (!leadingSep) steps.push(this.parseStep());
    while (this.isOp('/') || this.isOp('//')) {
      if (this.next().value === '//') steps.push(DESC_OR_SELF_STEP);
      steps.push(this.parseStep());
    }
    return steps;
  };
  Parser.prototype.parseLocationPath = function () {
    var steps = [], absolute = false;
    if (this.isOp('/')) {
      this.next();
      absolute = true;
      if (!this.startsStep(this.peek())) return { k: 'path', filter: null, absolute: true, steps: [] };
    } else if (this.isOp('//')) {
      this.next();
      absolute = true;
      steps.push(DESC_OR_SELF_STEP);
    }
    steps = steps.concat(this.parseRelativeSteps(false));
    return { k: 'path', filter: null, absolute: absolute, steps: steps };
  };
  Parser.prototype.parseStep = function () {
    var t = this.peek();
    if (!t) this.fail('location step expected');
    if (t.type === 'punct' && t.value === '.') { this.next(); return { axis: 'self', test: { t: 'node' }, preds: [] }; }
    if (t.type === 'punct' && t.value === '..') { this.next(); return { axis: 'parent', test: { t: 'node' }, preds: [] }; }
    var axis = 'child';
    if (t.type === 'axis') {
      this.next();
      if (!AXIS_NAMES[t.value]) this.fail('unknown axis "' + t.value + '"');
      axis = t.value;
      this.expectPunct('::');
    } else if (t.type === 'punct' && t.value === '@') {
      this.next();
      axis = 'attribute';
    }
    var test = this.parseNodeTest();
    var preds = [];
    while (this.isPunct('[')) {
      this.next();
      preds.push(this.parseOr());
      this.expectPunct(']');
    }
    return { axis: axis, test: test, preds: preds };
  };
  Parser.prototype.parseNodeTest = function () {
    var t = this.next();
    if (!t) this.fail('node test expected');
    if (t.type === 'name') {
      if (t.local === '*') return t.prefix === null ? { t: 'any' } : { t: 'nsany', prefix: t.prefix };
      return { t: 'name', prefix: t.prefix, local: t.local };
    }
    if (t.type === 'nodetype') {
      this.expectPunct('(');
      if (t.value === 'processing-instruction') {
        var lt = this.peek();
        if (lt && lt.type === 'literal') { this.next(); this.expectPunct(')'); return { t: 'pi', target: lt.value }; }
        this.expectPunct(')');
        return { t: 'pi' };
      }
      this.expectPunct(')');
      return { t: t.value };
    }
    this.fail('node test expected');
  };
  Parser.prototype.parseFilter = function () {
    var prim = this.parsePrimary();
    var preds = [];
    while (this.isPunct('[')) {
      this.next();
      preds.push(this.parseOr());
      this.expectPunct(']');
    }
    return preds.length ? { k: 'filter', prim: prim, preds: preds } : prim;
  };
  Parser.prototype.parsePrimary = function () {
    var t = this.next();
    if (t.type === 'var') return { k: 'var', prefix: t.prefix, local: t.local };
    if (t.type === 'literal') return { k: 'lit', v: t.value };
    if (t.type === 'number') return { k: 'num', v: t.value };
    if (t.type === 'punct' && t.value === '(') {
      var e = this.parseOr();
      this.expectPunct(')');
      return { k: 'group', a: e };
    }
    if (t.type === 'func') {
      this.expectPunct('(');
      var args = [];
      if (!this.isPunct(')')) {
        args.push(this.parseOr());
        while (this.isPunct(',')) { this.next(); args.push(this.parseOr()); }
      }
      this.expectPunct(')');
      return { k: 'fn', prefix: t.prefix, local: t.local, args: args };
    }
    this.fail('expression expected');
  };

  // 패턴 파서 (xsl:template match, xsl:key match, xsl:number count/from)
  function parsePattern(expr) {
    var p = new Parser(expr);
    var alts = [];
    for (;;) {
      alts.push(parsePatternAlt(p));
      if (p.isOp('|')) { p.next(); continue; }
      break;
    }
    if (p.i < p.toks.length) p.fail('unexpected token at end of pattern');
    return alts;
  }

  function parsePatternAlt(p) {
    // 반환: { anchor: null|'root'|'id'|'key', anchorArgs, steps: [{axis, test, preds, sep}] }
    var alt = { anchor: null, anchorArgs: null, steps: [] };
    var t = p.peek();
    var sep = null;
    if (t && t.type === 'op' && t.value === '/') {
      p.next();
      alt.anchor = 'root';
      if (!p.startsStep(p.peek())) return alt;
      sep = '/';
    } else if (t && t.type === 'op' && t.value === '//') {
      p.next();
      sep = null;
    } else if (t && t.type === 'func' && t.prefix === null && (t.local === 'id' || t.local === 'key')) {
      p.next();
      p.expectPunct('(');
      var args = [];
      for (;;) {
        var lit = p.next();
        if (!lit || lit.type !== 'literal') p.fail(t.local + '() in a pattern accepts only a string literal');
        args.push(lit.value);
        if (p.isPunct(',')) { p.next(); continue; }
        break;
      }
      p.expectPunct(')');
      alt.anchor = t.local;
      alt.anchorArgs = args;
      if (p.isOp('/') || p.isOp('//')) sep = p.next().value;
      else return alt;
    }
    for (;;) {
      var step = p.parseStep();
      if (step.axis !== 'child' && step.axis !== 'attribute') {
        if (!(step.axis === 'self' && step.test.t === 'node' && !step.preds.length)) {
          p.fail('only the child and attribute axes are allowed in patterns');
        }
      }
      step.sep = sep;
      alt.steps.push(step);
      if (p.isOp('/') || p.isOp('//')) { sep = p.next().value; continue; }
      break;
    }
    return alt;
  }
