// test/compiler.test.js — manual test harness for lib/keystroke/compiler.js.
//
// Run from the test/ folder:
//   node compiler.test.js
//
// Pure structural tests only — compileText/classifyChar have zero OS, addon,
// or display dependency (spec §11.2), so unlike every other test file so far
// this one needs no Windows, no native addon, and no throwaway windows. It
// can run anywhere Node runs.

const { compileText, classifyChar } = require('../lib/keystroke/compiler');

let passed = 0;
let failed = 0;

function check(label, condition, detail = '') {
    if (condition) {
        console.log(`  PASS  ${label}`);
        passed++;
    } else {
        console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`);
        failed++;
    }
}

function isChordAtom(atom, expectedKey, expectedModifiers) {
    return atom &&
        atom.kind === 'chord' &&
        atom.key === expectedKey &&
        Array.isArray(atom.modifiers) &&
        atom.modifiers.length === expectedModifiers.length &&
        atom.modifiers.every((m, i) => m === expectedModifiers[i]);
}

function isCharAtom(atom, expectedCodepoint) {
    return atom &&
        atom.kind === 'char' &&
        atom.codepoint === expectedCodepoint;
}

function hasNoTimingFields(atom) {
    return !('preDelayMs' in atom) && !('holdMs' in atom);
}

// ---------------------------------------------------------------------------
// classifyChar — letters, digits
// ---------------------------------------------------------------------------

function testLetters() {
    console.log('\nclassifyChar() — letters');

    check("'a' -> chord {key:'a', modifiers:[]}",
        isChordAtom(classifyChar('a'), 'a', []),
        JSON.stringify(classifyChar('a')));

    check("'z' -> chord {key:'z', modifiers:[]}",
        isChordAtom(classifyChar('z'), 'z', []),
        JSON.stringify(classifyChar('z')));

    check("'H' -> chord {key:'h', modifiers:['shift']} (spec §11.2 example)",
        isChordAtom(classifyChar('H'), 'h', ['shift']),
        JSON.stringify(classifyChar('H')));

    check("'Z' -> chord {key:'z', modifiers:['shift']}",
        isChordAtom(classifyChar('Z'), 'z', ['shift']),
        JSON.stringify(classifyChar('Z')));
}

function testDigits() {
    console.log('\nclassifyChar() — digits, unshifted and shifted');

    check("'5' -> chord {key:'5', modifiers:[]}",
        isChordAtom(classifyChar('5'), '5', []),
        JSON.stringify(classifyChar('5')));

    check("'0' -> chord {key:'0', modifiers:[]}",
        isChordAtom(classifyChar('0'), '0', []),
        JSON.stringify(classifyChar('0')));

    const shiftedDigitCases = [
        ['!', '1'], ['@', '2'], ['#', '3'], ['$', '4'], ['%', '5'],
        ['^', '6'], ['&', '7'], ['*', '8'], ['(', '9'], [')', '0'],
    ];
    for (const [symbol, key] of shiftedDigitCases) {
        const atom = classifyChar(symbol);
        check(`'${symbol}' -> chord {key:'${key}', modifiers:['shift']}`,
            isChordAtom(atom, key, ['shift']),
            JSON.stringify(atom));
    }
}

// ---------------------------------------------------------------------------
// classifyChar — punctuation
// ---------------------------------------------------------------------------

function testPunctuation() {
    console.log('\nclassifyChar() — standard punctuation, unshifted and shifted');

    const pairs = [
        ['`', 'backtick', []],       ['~', 'backtick', ['shift']],
        ['-', 'minus', []],          ['_', 'minus', ['shift']],
        ['=', 'equal', []],          ['+', 'equal', ['shift']],
        ['[', 'leftBracket', []],    ['{', 'leftBracket', ['shift']],
        [']', 'rightBracket', []],   ['}', 'rightBracket', ['shift']],
        ['\\', 'backslash', []],     ['|', 'backslash', ['shift']],
        [';', 'semicolon', []],      [':', 'semicolon', ['shift']],
        ["'", 'quote', []],          ['"', 'quote', ['shift']],
        [',', 'comma', []],          ['<', 'comma', ['shift']],
        ['.', 'period', []],         ['>', 'period', ['shift']],
        ['/', 'slash', []],          ['?', 'slash', ['shift']],
    ];

    for (const [char, key, modifiers] of pairs) {
        const atom = classifyChar(char);
        check(`'${char}' -> chord {key:'${key}', modifiers:${JSON.stringify(modifiers)}}`,
            isChordAtom(atom, key, modifiers),
            JSON.stringify(atom));
    }
}

// ---------------------------------------------------------------------------
// classifyChar — whitespace / editing keys
// ---------------------------------------------------------------------------

function testWhitespaceAndEditing() {
    console.log('\nclassifyChar() — space, tab, lone \\n / \\r');

    check("' ' -> chord {key:'space', modifiers:[]}",
        isChordAtom(classifyChar(' '), 'space', []),
        JSON.stringify(classifyChar(' ')));

    check("'\\t' -> chord {key:'tab', modifiers:[]}",
        isChordAtom(classifyChar('\t'), 'tab', []),
        JSON.stringify(classifyChar('\t')));

    check("lone '\\n' -> chord {key:'enter', modifiers:[]}",
        isChordAtom(classifyChar('\n'), 'enter', []),
        JSON.stringify(classifyChar('\n')));

    check("lone '\\r' -> chord {key:'enter', modifiers:[]}",
        isChordAtom(classifyChar('\r'), 'enter', []),
        JSON.stringify(classifyChar('\r')));
}

// ---------------------------------------------------------------------------
// classifyChar — no clean mapping -> char atom (Unicode path)
// ---------------------------------------------------------------------------

function testCharAtomFallback() {
    console.log('\nclassifyChar() — no clean mapping falls through to char atom');

    check("em dash '\u2014' -> char atom with correct codepoint",
        isCharAtom(classifyChar('\u2014'), 0x2014),
        JSON.stringify(classifyChar('\u2014')));

    check("curly quote '\u201c' -> char atom with correct codepoint",
        isCharAtom(classifyChar('\u201c'), 0x201c),
        JSON.stringify(classifyChar('\u201c')));

    // Emoji outside the BMP is a surrogate pair in UTF-16, but ONE code point.
    // classifyChar takes a single code point (as produced by Array.from), so
    // this exercises codePointAt correctly resolving the full value rather
    // than just the high surrogate.
    const grinningFace = '\u{1F600}'; // 😀, code point 0x1F600
    check("emoji '\u{1F600}' -> char atom with codepoint 0x1F600 (not a lone surrogate)",
        isCharAtom(classifyChar(grinningFace), 0x1f600),
        JSON.stringify(classifyChar(grinningFace)));
}

// ---------------------------------------------------------------------------
// compileText — full-string behavior: ordering, CRLF collapsing, no timing fields
// ---------------------------------------------------------------------------

function testCompileTextBasic() {
    console.log('\ncompileText() — basic string, ordering and atom count');

    const atoms = compileText('Hi!');
    check('compileText("Hi!") returns 3 atoms', atoms.length === 3, `length=${atoms.length}`);
    check("atom 0 is 'H' -> chord h+shift", isChordAtom(atoms[0], 'h', ['shift']));
    check("atom 1 is 'i' -> chord i", isChordAtom(atoms[1], 'i', []));
    check("atom 2 is '!' -> chord 1+shift", isChordAtom(atoms[2], '1', ['shift']));

    check('no atom carries timing fields (compiler is untimed)',
        atoms.every(hasNoTimingFields),
        JSON.stringify(atoms.find(a => !hasNoTimingFields(a))));
}

function testCompileTextEmpty() {
    console.log('\ncompileText() — empty string');
    const atoms = compileText('');
    check('compileText("") returns an empty array', Array.isArray(atoms) && atoms.length === 0,
        `length=${atoms && atoms.length}`);
}

function testCompileTextCRLFCollapsing() {
    console.log('\ncompileText() — CRLF collapsing');

    // '\r\n' together -> ONE enter atom, not two.
    const crlf = compileText('a\r\nb');
    check("'a\\r\\nb' compiles to 3 atoms (a, enter, b) not 4",
        crlf.length === 3, `length=${crlf.length}, atoms=${JSON.stringify(crlf)}`);
    check("atom 0 is 'a'", isChordAtom(crlf[0], 'a', []));
    check('atom 1 is a single enter', isChordAtom(crlf[1], 'enter', []));
    check("atom 2 is 'b'", isChordAtom(crlf[2], 'b', []));

    // Lone '\n' and lone '\r' each still produce their own enter atom.
    const loneLf = compileText('a\nb');
    check("'a\\nb' compiles to 3 atoms (lone \\n still maps to enter)",
        loneLf.length === 3 && isChordAtom(loneLf[1], 'enter', []),
        JSON.stringify(loneLf));

    const loneCr = compileText('a\rb');
    check("'a\\rb' compiles to 3 atoms (lone \\r still maps to enter)",
        loneCr.length === 3 && isChordAtom(loneCr[1], 'enter', []),
        JSON.stringify(loneCr));

    // Multiple CRLF-separated lines: each \r\n collapses independently.
    const multiLine = compileText('a\r\nb\r\nc');
    check("'a\\r\\nb\\r\\nc' compiles to 5 atoms (a, enter, b, enter, c)",
        multiLine.length === 5,
        `length=${multiLine.length}, atoms=${JSON.stringify(multiLine)}`);
    check('both enters are single atoms',
        isChordAtom(multiLine[1], 'enter', []) && isChordAtom(multiLine[3], 'enter', []));

    // '\r' NOT followed by '\n' should NOT consume the next character.
    const crThenLetter = compileText('\rx');
    check("'\\rx' compiles to 2 atoms (lone \\r, then x) — \\r doesn't eat 'x'",
        crThenLetter.length === 2 &&
        isChordAtom(crThenLetter[0], 'enter', []) &&
        isChordAtom(crThenLetter[1], 'x', []),
        JSON.stringify(crThenLetter));
}

function testCompileTextMixedContent() {
    console.log('\ncompileText() — mixed chord + char content in one string');

    // "Go\u2014now" : G(shift+g), o, em-dash(char), n, o, w
    const atoms = compileText('Go\u2014now');
    check('mixed string compiles to 6 atoms', atoms.length === 6, `length=${atoms.length}`);
    check("atom 0: 'G' -> chord g+shift", isChordAtom(atoms[0], 'g', ['shift']));
    check("atom 1: 'o' -> chord o", isChordAtom(atoms[1], 'o', []));
    check('atom 2: em-dash -> char atom 0x2014', isCharAtom(atoms[2], 0x2014));
    check("atom 3: 'n' -> chord n", isChordAtom(atoms[3], 'n', []));
    check("atom 4: 'o' -> chord o", isChordAtom(atoms[4], 'o', []));
    check("atom 5: 'w' -> chord w", isChordAtom(atoms[5], 'w', []));
}

function testCompileTextSurrogatePairNotSplit() {
    console.log('\ncompileText() — surrogate-pair emoji compiles to ONE atom, not two');

    const atoms = compileText('hi\u{1F600}!');
    // h, i, emoji(1 atom), ! = 4 atoms, not 5 (which would mean the
    // surrogate pair got split into two separate char atoms).
    check("'hi\u{1F600}!' compiles to 4 atoms (emoji counted once)",
        atoms.length === 4, `length=${atoms.length}, atoms=${JSON.stringify(atoms)}`);
    check('the emoji atom carries the full codepoint 0x1F600',
        isCharAtom(atoms[2], 0x1f600),
        JSON.stringify(atoms[2]));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
    console.log('=== lib/keystroke/compiler.js test suite (spec §11.2) ===');

    testLetters();
    testDigits();
    testPunctuation();
    testWhitespaceAndEditing();
    testCharAtomFallback();
    testCompileTextBasic();
    testCompileTextEmpty();
    testCompileTextCRLFCollapsing();
    testCompileTextMixedContent();
    testCompileTextSurrogatePairNotSplit();

    console.log(`\n=== ${passed} passed, ${failed} failed ===`);
    process.exitCode = failed > 0 ? 1 : 0;
}

main();
