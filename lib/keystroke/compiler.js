'use strict';

// lib/keystroke/compiler.js — shared string→atoms compile step (spec §11.2).
//
// compileText(text) is the one classification step shared by every plan
// builder. Per character, it decides:
//
//   - a clean US-layout key-enum mapping exists (letters, digits, standard
//     punctuation, space/tab/enter)  -> a CHORD atom: { kind:'chord', key, modifiers }
//   - no clean mapping (emoji, dashes, curly quotes, any other codepoint)
//     -> a CHAR atom: { kind:'char', codepoint }
//
// This is a pure technical determination with a single correct answer per
// codepoint (spec §11.2) — it has ZERO timing fields and ZERO dependency on
// the OS, native addon, or a specific builder. preDelayMs/holdMs are added
// later, by whichever builder (linear, Gaussian, ...) compiles a plan.
//
// The one exception to "one char in, one atom out" is the CRLF line ending:
// '\r\n' collapses to a single 'enter' chord atom, since a single physical
// Enter keypress is what a caller means by one logical newline. A lone '\n'
// or lone '\r' each also map to a single 'enter' atom on their own.

// ---------------------------------------------------------------------------
// Direct character -> {key, modifiers} table (US layout)
// ---------------------------------------------------------------------------

const CHORD_MAP = new Map();

function mapUnshifted(char, key) {
    CHORD_MAP.set(char, { key, modifiers: [] });
}

function mapShifted(char, key) {
    CHORD_MAP.set(char, { key, modifiers: ['shift'] });
}

// Letters: lowercase unshifted, uppercase shifted.
for (const letter of 'abcdefghijklmnopqrstuvwxyz') {
    mapUnshifted(letter, letter);
    mapShifted(letter.toUpperCase(), letter);
}

// Digits, unshifted.
for (const digit of '0123456789') {
    mapUnshifted(digit, digit);
}

// Digits, shifted (the standard US-layout symbol row).
const SHIFTED_DIGITS = {
    '1': '!', '2': '@', '3': '#', '4': '$', '5': '%',
    '6': '^', '7': '&', '8': '*', '9': '(', '0': ')',
};
for (const [digit, symbol] of Object.entries(SHIFTED_DIGITS)) {
    mapShifted(symbol, digit);
}

// Standard punctuation keys (spec §12 PUNCTUATION), unshifted and shifted.
// { key: [unshiftedChar, shiftedChar] }
const PUNCTUATION_PAIRS = {
    backtick:     ['`', '~'],
    minus:        ['-', '_'],
    equal:        ['=', '+'],
    leftBracket:  ['[', '{'],
    rightBracket: [']', '}'],
    backslash:    ['\\', '|'],
    semicolon:    [';', ':'],
    quote:        ["'", '"'],
    comma:        [',', '<'],
    period:       ['.', '>'],
    slash:        ['/', '?'],
};
for (const [key, [unshifted, shifted]] of Object.entries(PUNCTUATION_PAIRS)) {
    mapUnshifted(unshifted, key);
    mapShifted(shifted, key);
}

// Whitespace / editing keys that appear directly in typed text.
mapUnshifted(' ', 'space');
mapUnshifted('\t', 'tab');
// '\n' and '\r' are handled specially in compileText (CRLF collapsing) rather
// than through this table, but are included here for completeness / so
// classifyChar alone still gives a sensible answer for a lone char.
mapUnshifted('\n', 'enter');
mapUnshifted('\r', 'enter');

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

/**
 * Classify a single character (already resolved to one Unicode code point as
 * a JS string) into an untimed atom.
 *
 * @param {string} char  A single code point, e.g. from Array.from(text).
 * @returns {{kind:'chord', key:string, modifiers:string[]} | {kind:'char', codepoint:number}}
 */
function classifyChar(char) {
    const mapped = CHORD_MAP.get(char);
    if (mapped) {
        return { kind: 'chord', key: mapped.key, modifiers: mapped.modifiers };
    }
    return { kind: 'char', codepoint: char.codePointAt(0) };
}

/**
 * Compile a string into a flat array of untimed atoms (spec §11.1's atom
 * shapes, minus the timing fields — those are added by a plan builder).
 *
 * @param {string} text
 * @returns {Array<{kind:'chord', key:string, modifiers:string[]} | {kind:'char', codepoint:number}>}
 */
function compileText(text) {
    const atoms = [];
    const chars = Array.from(text); // iterate by code point, not UTF-16 unit

    for (let i = 0; i < chars.length; i++) {
        const char = chars[i];

        // Collapse CRLF into a single 'enter' atom.
        if (char === '\r' && chars[i + 1] === '\n') {
            atoms.push({ kind: 'chord', key: 'enter', modifiers: [] });
            i++; // consume the '\n' too
            continue;
        }

        atoms.push(classifyChar(char));
    }

    return atoms;
}

module.exports = {
    compileText,
    classifyChar,
};
