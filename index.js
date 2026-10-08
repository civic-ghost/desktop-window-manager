'use strict';

// index.js — public package entry point (spec §4).
//
// Thin re-export layer. Two tiers:
//
//   - Raw native primitives (spec §8) live NESTED under `primitives`. Several
//     primitive names collide with higher-level composition functions of the
//     same name (captureWindow, getCursorPosition, clipboardSetText/GetText)
//     — nesting keeps it unambiguous which one a caller is getting, at the
//     cost of requiring existing consumers of the old flat index.js to update
//     any import that specifically wanted a raw primitive (see wakeDesktop
//     below). Composition-layer equivalents of the same name are NOT
//     shadowed or hidden; they simply live at the top level instead.
//
//   - Everything else — the composition layer (screen, mouse, keyboard,
//     clipboard), the keystroke-plan machinery, and the path providers — is
//     re-exported FLAT at the top level. None of these names collide with
//     each other, so flat re-export is unambiguous here.
//
// wakeDesktop is a raw primitive with no composition-layer equivalent (it's
// explicitly out of scope for this spec — an unattended display-pipeline
// concern, not an input-injection one) and now lives at primitives.wakeDesktop
// instead of the top level. Existing consumers (e.g. BrowserSession.js) need
// a one-line import update to match.

const addon = require('./lib/addon');

const screen = require('./lib/screen');
const mouse = require('./lib/mouse');
const keyboard = require('./lib/keyboard');
const clipboard = require('./lib/clipboard');

const { runKeystrokePlan } = require('./lib/keystroke/plan_executor');
const { makeLinearKeystrokePlan } = require('./lib/keystroke/linear_plan');
const { makeGaussianKeystrokePlan } = require('./lib/keystroke/gaussian_plan');

const { linearPath } = require('./lib/path/linear_path');
const { bezierPath } = require('./lib/path/bezier_path');

module.exports = {
    // Raw native primitives (spec §8), nested. e.g.:
    //   primitives.wakeDesktop()        — no composition-layer equivalent
    //   primitives.captureWindow(h)     — raw { data (RGBA), width, height }
    //   primitives.getCursorPosition()  — identical to the top-level one,
    //                                     since screen.js's version is a
    //                                     pure pass-through
    primitives: addon,

    // Screen & window (lib/screen.js)
    ...screen,

    // Mouse (lib/mouse.js)
    ...mouse,

    // Keyboard (lib/keyboard.js)
    ...keyboard,

    // Clipboard (lib/clipboard.js)
    ...clipboard,

    // Keystroke-plan machinery (lib/keystroke/) — explicitly re-exported
    // from the package entry per spec §9 / §11.
    runKeystrokePlan,
    makeLinearKeystrokePlan,
    makeGaussianKeystrokePlan,

    // Path providers (lib/path/) — re-exported for convenience so callers
    // can pass them as moveTo()'s options.provider without a deeper require,
    // e.g. moveTo(to, { provider: bezierPath }).
    linearPath,
    bezierPath,
};
