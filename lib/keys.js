// lib/keys.js — US-layout key identifier enum (spec §12).
//
// The values here are the *names* recognized by the native keyDown / keyUp
// primitives. Per §12, the actual name -> platform-code mapping lives in
// each native backend (window_manager_win.cpp for Windows). This file exists
// so composition-layer code and callers can discover the valid names,
// validate input before hitting the native call, and reason about the key
// enum without touching the native seam.
//
// Any change to the names here MUST be mirrored in the C++ key map, or
// keyDown / keyUp will throw for the newly added name.

const LETTERS = [
    'a','b','c','d','e','f','g','h','i','j','k','l','m',
    'n','o','p','q','r','s','t','u','v','w','x','y','z',
];

const DIGITS = ['0','1','2','3','4','5','6','7','8','9'];

const FUNCTION_KEYS = [
    'f1','f2','f3','f4','f5','f6','f7','f8','f9','f10','f11','f12',
    'f13','f14','f15','f16','f17','f18','f19','f20','f21','f22','f23','f24',
];

// Bare names (control, alt, shift, meta) map to their left-side variants
// in the native backend, matching common OS convention.
const MODIFIERS = [
    'control','leftControl','rightControl',
    'alt','leftAlt','rightAlt',
    'shift','leftShift','rightShift',
    'meta','leftMeta','rightMeta',
];

const NAVIGATION = [
    'up','down','left','right',
    'home','end','pageUp','pageDown',
    'insert','delete',
];

const EDITING = ['enter','tab','backspace','escape','space'];

const NUMPAD = [
    'num0','num1','num2','num3','num4','num5','num6','num7','num8','num9',
    'numAdd','numSubtract','numMultiply','numDivide','numDecimal','numEnter',
];

// US-layout physical-key names. Shifted characters (e.g. ':' on semicolon)
// are produced by holding shift and pressing the base key, not by a
// separate name.
const PUNCTUATION = [
    'backtick','minus','equal',
    'leftBracket','rightBracket','backslash',
    'semicolon','quote',
    'comma','period','slash',
];

const ALL = new Set([
    ...LETTERS,
    ...DIGITS,
    ...FUNCTION_KEYS,
    ...MODIFIERS,
    ...NAVIGATION,
    ...EDITING,
    ...NUMPAD,
    ...PUNCTUATION,
]);

function isValidKeyName(name) {
    return typeof name === 'string' && ALL.has(name);
}

module.exports = {
    LETTERS,
    DIGITS,
    FUNCTION_KEYS,
    MODIFIERS,
    NAVIGATION,
    EDITING,
    NUMPAD,
    PUNCTUATION,
    ALL,
    isValidKeyName,
};
