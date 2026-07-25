// test/plan_builders.test.js — manual test harness for the plan builders
// (spec §11.2): makeLinearKeystrokePlan and makeGaussianKeystrokePlan.
//
// Run from the test/ folder:
//   node plan_builders.test.js
//
// Both builders are pure functions with no OS/addon dependency, so — like
// compiler.test.js — this suite needs no Windows, no native addon, no
// display. Three groups of checks:
//
//   1. makeLinearKeystrokePlan — deterministic timing, easy to assert exactly.
//   2. makeGaussianKeystrokePlan — a mix of deterministic checks (std=0
//      collapses the distribution to a known constant; negative std clamps
//      to 0) and one formula-conformance check that controls Math.random
//      directly and compares against a hand-reproduced copy of the ported
//      nutty.js formula, to catch any accidental reordering of the Box-Muller
//      arithmetic.
//   3. Cross-builder consistency — both builders must classify text
//      IDENTICALLY (same kind/key/modifiers/codepoint per atom); only timing
//      should differ. This is really a check that neither builder duplicates
//      or diverges from the shared compiler.

const { makeLinearKeystrokePlan } = require('../lib/keystroke/linear_plan');
const { makeGaussianKeystrokePlan } = require('../lib/keystroke/gaussian_plan');

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

function hasOwnHoldMs(atom) {
    return 'holdMs' in atom;
}

// ---------------------------------------------------------------------------
// makeLinearKeystrokePlan — deterministic timing
// ---------------------------------------------------------------------------

function testLinearBasicTiming() {
    console.log('\nmakeLinearKeystrokePlan() — basic timing');

    const plan = makeLinearKeystrokePlan('Hi!', { charDelay: 30, holdMs: 15 });

    check('plan has 3 atoms', plan.length === 3, `length=${plan.length}`);
    check('first atom preDelayMs is 0 regardless of charDelay',
        plan[0].preDelayMs === 0, `got ${plan[0].preDelayMs}`);
    check('second atom preDelayMs equals charDelay',
        plan[1].preDelayMs === 30, `got ${plan[1].preDelayMs}`);
    check('third atom preDelayMs equals charDelay',
        plan[2].preDelayMs === 30, `got ${plan[2].preDelayMs}`);

    check('all chord atoms carry holdMs === options.holdMs',
        plan.filter(a => a.kind === 'chord').every(a => a.holdMs === 15));
    check('no char atom carries a holdMs field',
        plan.filter(a => a.kind === 'char').every(a => !hasOwnHoldMs(a)));
}

function testLinearDefaults() {
    console.log('\nmakeLinearKeystrokePlan() — defaults (charDelay=0, holdMs=0)');

    const plan = makeLinearKeystrokePlan('ab');
    check('first atom preDelayMs is 0', plan[0].preDelayMs === 0);
    check('second atom preDelayMs defaults to 0', plan[1].preDelayMs === 0,
        `got ${plan[1].preDelayMs}`);
    check('chord atoms default holdMs to 0', plan.every(a => a.kind !== 'chord' || a.holdMs === 0));
}

function testLinearEmptyText() {
    console.log('\nmakeLinearKeystrokePlan() — empty string');
    const plan = makeLinearKeystrokePlan('');
    check('empty text produces an empty plan', Array.isArray(plan) && plan.length === 0,
        `length=${plan && plan.length}`);
}

function testLinearCharAtomFields() {
    console.log('\nmakeLinearKeystrokePlan() — char atom carries codepoint, not key/modifiers');

    const plan = makeLinearKeystrokePlan('a\u2014b'); // a, em-dash, b
    const emDashAtom = plan[1];
    check("em-dash atom has kind 'char'", emDashAtom.kind === 'char', emDashAtom.kind);
    check('em-dash atom carries codepoint 0x2014', emDashAtom.codepoint === 0x2014,
        `got ${emDashAtom.codepoint}`);
    check('em-dash atom has no key/modifiers fields',
        !('key' in emDashAtom) && !('modifiers' in emDashAtom));
}

// ---------------------------------------------------------------------------
// makeGaussianKeystrokePlan — deterministic edge cases
// ---------------------------------------------------------------------------

function testGaussianZeroStdIsDeterministic() {
    console.log('\nmakeGaussianKeystrokePlan() — std=0 collapses to a constant delay');

    // With stdDev 0, z * 0 = 0 for any z, so every sample equals `mean`
    // exactly, regardless of Math.random()'s actual draws. This is a fully
    // deterministic check with no monkeypatching required.
    const plan = makeGaussianKeystrokePlan('abcde', {
        charDelay: 40,
        charDelaySTD: 0,
        minPreDelayMs: 10,
    });

    check('first atom preDelayMs is 0', plan[0].preDelayMs === 0);
    check('every subsequent atom preDelayMs is exactly charDelay (40) when std=0',
        plan.slice(1).every(a => a.preDelayMs === 40),
        JSON.stringify(plan.map(a => a.preDelayMs)));
}

function testGaussianNegativeStdClampsToZero() {
    console.log('\nmakeGaussianKeystrokePlan() — negative charDelaySTD clamps to 0 (nutty.js parity)');

    const plan = makeGaussianKeystrokePlan('abcde', {
        charDelay: 25,
        charDelaySTD: -100, // should behave identically to charDelaySTD: 0
        minPreDelayMs: 10,
    });

    check('negative std still yields exactly charDelay for every subsequent atom',
        plan.slice(1).every(a => a.preDelayMs === 25),
        JSON.stringify(plan.map(a => a.preDelayMs)));
}

function testGaussianMinPreDelayFloor() {
    console.log('\nmakeGaussianKeystrokePlan() — minPreDelayMs floor');

    // charDelay below minPreDelayMs, std=0 -> every sample equals charDelay
    // exactly, which is BELOW the floor, so the floor should win.
    const plan = makeGaussianKeystrokePlan('abcde', {
        charDelay: 3,
        charDelaySTD: 0,
        minPreDelayMs: 25,
    });

    check('every subsequent atom preDelayMs is clamped up to minPreDelayMs (25)',
        plan.slice(1).every(a => a.preDelayMs === 25),
        JSON.stringify(plan.map(a => a.preDelayMs)));
}

function testGaussianFirstAtomNeverConsumesRandomness() {
    console.log('\nmakeGaussianKeystrokePlan() — first atom does not call gaussianSample at all');

    // If gaussianSample were (incorrectly) called for index 0 too, it would
    // consume two Math.random() calls before the loop even reaches index 1.
    // We verify the actual CONTRACT (index 0 preDelayMs === 0) rather than
    // spying on Math.random call count, since that's the behavior that
    // matters to callers.
    const plan = makeGaussianKeystrokePlan('xyz', { charDelay: 50, charDelaySTD: 20 });
    check('first atom preDelayMs is exactly 0 even with nonzero charDelay/STD',
        plan[0].preDelayMs === 0, `got ${plan[0].preDelayMs}`);
}

function testGaussianFormulaConformance() {
    console.log('\nmakeGaussianKeystrokePlan() — Box-Muller formula conformance (controlled Math.random)');

    // Reference implementation: a direct transcription of the pasted
    // nutty.js gaussianSample, kept independent of lib/keystroke/gaussian_plan.js
    // so this is a real conformance check, not a tautology.
    function referenceGaussianSample(mean, stdDev, u1, u2) {
        const z = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
        return mean + z * stdDev;
    }

    const originalRandom = Math.random;
    const queue = [0.37, 0.81]; // arbitrary fixed draws, consumed as [u1-source, u2]
    let callIndex = 0;
    Math.random = () => {
        const v = queue[callIndex % queue.length];
        callIndex++;
        return v;
    };

    let plan;
    try {
        // 'ab' -> index 0 consumes no randomness, index 1 consumes exactly
        // one gaussianSample call (2 Math.random() calls: u1 then u2).
        plan = makeGaussianKeystrokePlan('ab', {
            charDelay: 50,
            charDelaySTD: 10,
            minPreDelayMs: 0, // disable the floor so the raw sample is visible
        });
    } finally {
        Math.random = originalRandom;
    }

    // gaussian_plan.js computes u1 = 1 - Math.random() (first call -> 0.37),
    // so u1 = 0.63; u2 = Math.random() (second call -> 0.81).
    const expected = referenceGaussianSample(50, 10, 1 - 0.37, 0.81);

    check("atom[1].preDelayMs matches the hand-reproduced Box-Muller formula (u1 = 1 - Math.random())",
        Math.abs(plan[1].preDelayMs - expected) < 1e-9,
        `got ${plan[1].preDelayMs}, expected ${expected}`);
}

function testGaussianVariesAcrossSamples() {
    console.log('\nmakeGaussianKeystrokePlan() — real randomness actually varies delays');

    // Sanity check with real Math.random(): a long plan with a real std
    // should not produce identical delays for every atom. Loose by design —
    // this only guards against "always returns the same number" bugs, not
    // distribution shape.
    const longText = 'a'.repeat(200);
    const plan = makeGaussianKeystrokePlan(longText, {
        charDelay: 50,
        charDelaySTD: 15,
        minPreDelayMs: 0,
    });

    const delays = plan.slice(1).map(a => a.preDelayMs);
    const distinctValues = new Set(delays).size;
    check('200-atom plan produces more than a handful of distinct delay values',
        distinctValues > 20, `distinct values=${distinctValues}`);

    check('all sampled delays respect the minPreDelayMs floor (0 here)',
        delays.every(d => d >= 0));
}

function testGaussianHoldMsAndCharAtoms() {
    console.log('\nmakeGaussianKeystrokePlan() — holdMs on chords, absent on chars');

    const plan = makeGaussianKeystrokePlan('a\u2014b', {
        charDelay: 20,
        charDelaySTD: 5,
        holdMs: 12,
    });

    check('chord atoms carry holdMs === options.holdMs',
        plan.filter(a => a.kind === 'chord').every(a => a.holdMs === 12));
    check('char atoms carry no holdMs field',
        plan.filter(a => a.kind === 'char').every(a => !hasOwnHoldMs(a)));
}

function testGaussianEmptyText() {
    console.log('\nmakeGaussianKeystrokePlan() — empty string');
    const plan = makeGaussianKeystrokePlan('', { charDelay: 40, charDelaySTD: 10 });
    check('empty text produces an empty plan', Array.isArray(plan) && plan.length === 0,
        `length=${plan && plan.length}`);
}

// ---------------------------------------------------------------------------
// Cross-builder consistency — classification must be identical
// ---------------------------------------------------------------------------

function testBuildersAgreeOnClassification() {
    console.log('\nBoth builders — identical classification, only timing differs');

    const text = 'Hi! Go\u2014now\u{1F600}';

    const linearPlan = makeLinearKeystrokePlan(text, { charDelay: 5, holdMs: 5 });
    const gaussianPlan = makeGaussianKeystrokePlan(text, {
        charDelay: 5, charDelaySTD: 0, minPreDelayMs: 0,
    });

    check('both plans have the same number of atoms',
        linearPlan.length === gaussianPlan.length,
        `linear=${linearPlan.length} gaussian=${gaussianPlan.length}`);

    const sameClassification = linearPlan.every((atom, i) => {
        const other = gaussianPlan[i];
        if (atom.kind !== other.kind) return false;
        if (atom.kind === 'chord') {
            return atom.key === other.key &&
                JSON.stringify(atom.modifiers) === JSON.stringify(other.modifiers);
        }
        return atom.codepoint === other.codepoint;
    });
    check('every atom has identical kind/key/modifiers/codepoint across builders',
        sameClassification);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
    console.log('=== plan builder test suite (spec §11.2) ===');

    testLinearBasicTiming();
    testLinearDefaults();
    testLinearEmptyText();
    testLinearCharAtomFields();

    testGaussianZeroStdIsDeterministic();
    testGaussianNegativeStdClampsToZero();
    testGaussianMinPreDelayFloor();
    testGaussianFirstAtomNeverConsumesRandomness();
    testGaussianFormulaConformance();
    testGaussianVariesAcrossSamples();
    testGaussianHoldMsAndCharAtoms();
    testGaussianEmptyText();

    testBuildersAgreeOnClassification();

    console.log(`\n=== ${passed} passed, ${failed} failed ===`);
    process.exitCode = failed > 0 ? 1 : 0;
}

main();
