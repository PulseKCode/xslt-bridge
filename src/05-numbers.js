
  // ---------------------------------------------------------------------------
  // format-number() : libxslt xsltFormatNumberConversion 이식
  // ---------------------------------------------------------------------------
  var DEFAULT_DECIMAL_FORMAT = {
    decimalPoint: '.', grouping: ',', percent: '%', permille: '\u2030', zeroDigit: '0',
    digit: '#', patternSeparator: ';', minusSign: '-', infinity: 'Infinity', noNumber: 'NaN'
  };

  // xsltNumberFormatDecimal : 뒤에서부터 자릿수를 채운다
  function formatDecimalDigits(number, zeroChar, width, perGroup, groupChar) {
    var zero = zeroChar.charCodeAt(0), parts = [], i = 0;
    for (;;) {
      if (i >= width && Math.abs(number) < 1.0) break;
      if (i > 0 && groupChar && perGroup > 0 && (i % perGroup) === 0) parts.push(groupChar);
      var d = number % 10;
      d = d < 0 ? Math.ceil(d) : Math.floor(d);
      parts.push(String.fromCharCode(zero + d));
      number /= 10.0;
      ++i;
      if (i > 400) break;
    }
    return parts.reverse().join('');
  }

  function formatNumber(number, f, self) {
    if (number !== number) return self.noNumber;
    var info = {
      integer_hash: 0, integer_digits: 0, frac_digits: 0, frac_hash: 0, group: -1,
      multiplier: 1, add_decimal: false, is_multiplier_set: false
    };
    var pos = 0, len = 0, delayed = 0, defaultSign = false, foundError = false;
    var prefix = 0, prefixLen = 0, suffix = 0, suffixLen = 0;

    function isSpecial(ch) {
      return ch === self.zeroDigit || ch === self.digit || ch === self.decimalPoint ||
             ch === self.grouping || ch === self.patternSeparator;
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
          info.multiplier = 100; info.is_multiplier_set = true;
        } else if (ch === self.permille) {
          if (info.is_multiplier_set) return -1;
          info.multiplier = 1000; info.is_multiplier_set = true;
        }
        count += 1;
        pos += 1;
      }
    }
    function emit(start, count) {
      var s = '', k = start, j = 0;
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
      if (prefixLen < 0) { foundError = true; break parse; }
      var ch;
      while (pos < f.length && (ch = f.charAt(pos)) !== self.decimalPoint && ch !== self.patternSeparator) {
        if (delayed !== 0) { info.multiplier = delayed; info.is_multiplier_set = true; delayed = 0; }
        if (ch === self.digit) {
          if (info.integer_digits > 0) { foundError = true; break parse; }
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
          if (info.is_multiplier_set) { foundError = true; break parse; }
          delayed = 100;
        } else if (ch === self.permille) {
          if (info.is_multiplier_set) { foundError = true; break parse; }
          delayed = 1000;
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
          if (info.frac_hash !== 0) { foundError = true; break parse; }
          info.frac_digits++;
        } else if (ch === self.digit) {
          info.frac_hash++;
        } else if (ch === self.percent) {
          if (info.is_multiplier_set) { foundError = true; break parse; }
          delayed = 100; len = 1; pos += 1;
          continue;
        } else if (ch === self.permille) {
          if (info.is_multiplier_set) { foundError = true; break parse; }
          delayed = 1000; len = 1; pos += 1;
          continue;
        } else if (ch !== self.grouping) {
          break;
        }
        len = 1;
        pos += 1;
        if (delayed !== 0) { info.multiplier = delayed; delayed = 0; info.is_multiplier_set = true; }
      }
      if (delayed !== 0) { pos -= len; delayed = 0; }
      suffix = pos;
      suffixLen = preSuffix();
      if (suffixLen < 0 || (pos < f.length && f.charAt(pos) !== self.patternSeparator)) { foundError = true; break parse; }

      if (number < 0) {
        var sepIdx = f.indexOf(self.patternSeparator);
        if (sepIdx < 0) {
          defaultSign = true;
        } else {
          pos = sepIdx + 1;
          info.is_multiplier_set = false;
          var nprefix = pos, nprefixLen = preSuffix(), nsuffix = 0, nsuffixLen = 0;
          if (nprefixLen < 0) { foundError = true; break parse; }
          while (pos < f.length) {
            ch = f.charAt(pos);
            if (ch === self.percent || ch === self.permille) {
              if (info.is_multiplier_set) { foundError = true; break parse; }
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
          if (delayed !== 0) { info.is_multiplier_set = false; pos -= len; }
          if (pos < f.length) {
            nsuffix = pos;
            nsuffixLen = preSuffix();
            if (nsuffixLen < 0) { foundError = true; break parse; }
          }
          if (pos < f.length) { foundError = true; break parse; }
          if (nprefixLen !== prefixLen || nsuffixLen !== suffixLen ||
              (nprefixLen > 0 && f.substr(nprefix, prefixLen) !== f.substr(prefix, prefixLen)) ||
              (nsuffixLen > 0 && f.substr(nsuffix, suffixLen) !== f.substr(suffix, suffixLen))) {
            prefix = nprefix; prefixLen = nprefixLen;
            suffix = nsuffix; suffixLen = nsuffixLen;
          }
        }
      }
    }

    if (foundError) {
      warn('format-number: invalid pattern "' + f + '", using the default pattern');
      defaultSign = number < 0;
      prefixLen = suffixLen = 0;
      info.integer_hash = 0; info.integer_digits = 1; info.frac_digits = 1; info.frac_hash = 4;
      info.group = -1; info.multiplier = 1; info.add_decimal = true;
    }

    number *= info.multiplier;
    if (number === -Infinity) return self.minusSign + self.infinity;
    if (number === Infinity) return self.infinity;

    var out = '';
    if (defaultSign) out += self.minusSign;
    out += emit(prefix, prefixLen);

    number = Math.abs(number);
    var exp10 = info.frac_digits + info.frac_hash;
    if (exp10 > 308) {
      if (info.frac_digits > 308) { info.frac_digits = 308; info.frac_hash = 0; }
      else info.frac_hash = 308 - info.frac_digits;
      exp10 = 308;
    }
    var scale = Math.pow(10, exp10);
    number += 0.5 / scale;
    number -= number % (1 / scale);

    var gchar = self.grouping ? self.grouping.charAt(0) : ',';
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
        number = Math.floor(scale * number + 0.5);
        var j;
        for (j = info.frac_hash; j > 0; j--) {
          if (number % 10 >= 1.0) break;
          number /= 10.0;
        }
        out += formatDecimalDigits(Math.floor(number), self.zeroDigit, info.frac_digits + j, 0, '');
      }
    }
    out += emit(suffix, suffixLen);
    return out;
  }

  // ---------------------------------------------------------------------------
  // xsl:number 서식 : libxslt xsltNumberFormat* 이식
  // ---------------------------------------------------------------------------
  var DIGIT_ZEROS = [0x30, 0x660, 0x6F0, 0x966, 0x9E6, 0xA66, 0xAE6, 0xB66, 0xBE6, 0xC66, 0xCE6,
    0xD66, 0xE50, 0xED0, 0xF20, 0x1040, 0x17E0, 0x1810, 0xFF10];
  function codeOf(ch) {
    if (!ch) return -1;
    if (ch.length === 2) return (ch.charCodeAt(0) - 0xD800) * 0x400 + ch.charCodeAt(1) - 0xDC00 + 0x10000;
    return ch.charCodeAt(0);
  }
  function isDigitZeroCode(c) { for (var i = 0; i < DIGIT_ZEROS.length; i++) if (DIGIT_ZEROS[i] === c) return true; return false; }
  function isDigitZero(ch) { return isDigitZeroCode(codeOf(ch)); }
  function isDigitOne(ch) { var c = codeOf(ch); return c > 0 && isDigitZeroCode(c - 1); }
  var LETTER_DIGIT_RE = /[0-9A-Za-z\u00AA\u00B5\u00BA\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u02C1\u0370-\u0373\u0376-\u03FF\u0400-\u0481\u048A-\u052F\u0531-\u0556\u0561-\u0587\u05D0-\u05EA\u0620-\u064A\u0660-\u0669\u06F0-\u06F9\u0904-\u0939\u0966-\u096F\u0E01-\u0E30\u0E50-\u0E59\u1100-\u11FF\u3041-\u3096\u30A1-\u30FA\u3131-\u318E\u3400-\u4DB5\u4E00-\u9FFF\uAC00-\uD7A3\uFF10-\uFF19\uFF21-\uFF3A\uFF41-\uFF5A]/;
  function isLetterDigit(ch) { return !!ch && LETTER_DIGIT_RE.test(ch); }

  var DEFAULT_NUMBER_TOKEN = { separator: '.', token: '0', width: 1 };

  function numberFormatTokenize(format) {
    var chars = charsOf(format), n = chars.length, ix = 0;
    var tokens = { start: null, list: [], end: null };
    while (ix < n && !isLetterDigit(chars[ix])) ix++;
    if (ix > 0) tokens.start = chars.slice(0, ix).join('');
    while (ix < n && tokens.list.length < 1024) {
      var tok = { separator: null, token: '0', width: 1 };
      if (tokens.list.length > 0) { tok.separator = tokens.end; tokens.end = null; }
      var ch = chars[ix];
      if (isDigitOne(ch) || isDigitZero(ch)) {
        tok.width = 1;
        while (isDigitZero(ch)) { tok.width++; ix++; ch = chars[ix]; }
        if (isDigitOne(ch)) {
          tok.token = String.fromCharCode(codeOf(ch) - 1);
          ix++;
        } else {
          tok.token = '0';
          tok.width = 1;
        }
      } else if (ch === 'A' || ch === 'a' || ch === 'I' || ch === 'i') {
        tok.token = ch;
        ix++;
      }
      while (ix < n && isLetterDigit(chars[ix])) ix++;
      var j = ix;
      while (ix < n && !isLetterDigit(chars[ix])) ix++;
      if (ix > j) tokens.end = chars.slice(j, ix).join('');
      tokens.list.push(tok);
    }
    return tokens;
  }

  function formatAlpha(number, upper, perGroup, groupChar) {
    if (number < 1.0) return formatDecimalDigits(number, '0', 1, perGroup, groupChar);
    var list = upper ? 'ABCDEFGHIJKLMNOPQRSTUVWXYZ' : 'abcdefghijklmnopqrstuvwxyz', s = '';
    for (var i = 1; i < 65; i++) {
      number--;
      var idx = number % 26;
      idx = idx < 0 ? Math.ceil(idx) : Math.floor(idx);
      s = list.charAt(idx) + s;
      number /= 26;
      if (number < 1.0) break;
    }
    return s;
  }

  function formatRoman(number, upper, perGroup, groupChar) {
    if (number < 1.0 || number > 5000.0) return formatDecimalDigits(number, '0', 1, perGroup, groupChar);
    var table = [[1000, 'm', true], [900, 'cm', false], [500, 'd', true], [400, 'cd', false], [100, 'c', true],
      [90, 'xc', false], [50, 'l', true], [40, 'xl', false], [10, 'x', true], [9, 'ix', false],
      [5, 'v', true], [4, 'iv', false], [1, 'i', true]];
    var s = '';
    for (var i = 0; i < table.length; i++) {
      var v = table[i][0], sym = upper ? table[i][1].toUpperCase() : table[i][1];
      if (table[i][2]) { while (number >= v) { s += sym; number -= v; } }
      else if (number >= v) { s += sym; number -= v; }
    }
    return s;
  }

  function numberFormatInsert(numbers, tokens, perGroup, groupChar) {
    var out = tokens.start || '';
    for (var i = 0; i < numbers.length; i++) {
      var number = Math.floor(numbers[numbers.length - 1 - i] + 0.5);
      if (number < 0) { warn('xsl:number: negative value treated as 0'); number = 0; }
      var tok = i < tokens.list.length ? tokens.list[i]
        : (tokens.list.length ? tokens.list[tokens.list.length - 1] : DEFAULT_NUMBER_TOKEN);
      if (i > 0) out += tok.separator !== null ? tok.separator : '.';
      if (number === Infinity) { out += 'Infinity'; continue; }
      if (number === -Infinity) { out += '-Infinity'; continue; }
      if (number !== number) { out += 'NaN'; continue; }
      switch (tok.token) {
        case 'A': out += formatAlpha(number, true, perGroup, groupChar); break;
        case 'a': out += formatAlpha(number, false, perGroup, groupChar); break;
        case 'I': out += formatRoman(number, true, perGroup, groupChar); break;
        case 'i': out += formatRoman(number, false, perGroup, groupChar); break;
        default:
          if (isDigitZero(tok.token)) out += formatDecimalDigits(number, tok.token, tok.width, perGroup, groupChar);
      }
    }
    if (tokens.end) out += tokens.end;
    return out;
  }
