/*global navigator*/
'use strict';

const {
  REGEX_BACKSLASH,
  REGEX_SPECIAL_CHARS,
  REGEX_SPECIAL_CHARS_GLOBAL
} = require('./constants');

exports.isObject = val => val !== null && typeof val === 'object' && !Array.isArray(val);
exports.hasRegexChars = str => REGEX_SPECIAL_CHARS.test(str);
exports.isRegexChar = str => str.length === 1 && exports.hasRegexChars(str);
exports.escapeRegex = str => str.replace(REGEX_SPECIAL_CHARS_GLOBAL, '\\$1');
exports.toPosixSlashes = str => str.replace(REGEX_BACKSLASH, '/');

exports.isWindows = () => {
  if (typeof navigator !== 'undefined' && navigator.platform) {
    const platform = navigator.platform.toLowerCase();
    return platform === 'win32' || platform === 'windows';
  }

  if (typeof process !== 'undefined' && process.platform) {
    return process.platform === 'win32';
  }

  return false;
};

exports.removeBackslashes = str => {
  if (typeof str !== 'string') throw new TypeError('Expected a string');
  const isLineBreak = ch => ch === '\n' || ch === '\r' || ch === '\u2028' || ch === '\u2029';
  const brackets = [];
  let start = -1;
  // Find the same protected bracket spans as the upstream regexp, without
  // retrying the rest of the input at every unmatched opening bracket.
  for (let i = 0; i < str.length; i++) {
    if (str[i] === '[' && start === -1) start = i;
    if (str[i] === ']' && start !== -1 && i > start + 1 && str[i - 1] !== '\\') {
      brackets.push([start, i + 1]);
      start = -1;
    } else if (isLineBreak(str[i]) && str[i + 1] !== ']') {
      start = -1;
    }
  }
  const output = [];
  let bracket = 0;
  for (let i = 0; i < str.length;) {
    const span = brackets[bracket];
    if (span && i === span[0]) {
      output.push(str.slice(i, span[1]));
      i = span[1];
      bracket++;
    } else {
      if (str[i] !== '\\' || i + 1 === str.length || isLineBreak(str[i + 1])) output.push(str[i]);
      i++;
    }
  }
  return output.join('');
};

exports.escapeLast = (input, char, lastIdx) => {
  const idx = input.lastIndexOf(char, lastIdx);
  if (idx === -1) return input;
  if (input[idx - 1] === '\\') return exports.escapeLast(input, char, idx - 1);
  return `${input.slice(0, idx)}\\${input.slice(idx)}`;
};

exports.removePrefix = (input, state = {}) => {
  let output = input;
  if (output.startsWith('./')) {
    output = output.slice(2);
    state.prefix = './';
  }
  return output;
};

exports.wrapOutput = (input, state = {}, options = {}) => {
  const prepend = options.contains ? '' : '^';
  const append = options.contains ? '' : '$';

  let output = `${prepend}(?:${input})${append}`;
  if (state.negated === true) {
    output = `(?:^(?!${output}).*$)`;
  }
  return output;
};

exports.basename = (path, { windows } = {}) => {
  const segs = path.split(windows ? /[\\/]/ : '/');
  const last = segs[segs.length - 1];

  if (last === '') {
    return segs[segs.length - 2];
  }

  return last;
};
