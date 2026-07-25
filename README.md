# desktop-window-manager

A native Node.js addon with a JavaScript composition layer for OS-level input injection and window management. Built for 24/7 unattended automation on Windows (with Linux/X11 planned), it provides mouse control, keyboard input, clipboard operations, screen capture, and window queries — all driven through a single, consistent API.

The native layer exposes the input primitives the OS itself defines (`SendInput`, `GetWindowRect`, etc.); everything higher-level — clicks, chords, typed strings, cursor paths — is composed in JavaScript and is identical across platforms.

## Table of contents

- [Requirements](#requirements)
- [Installation](#installation)
- [Architecture overview](#architecture-overview)
- [Quick start](#quick-start)
- [API reference](#api-reference)
  - [Screen & window (`lib/screen.js`)](#screen--window)
  - [Mouse (`lib/mouse.js`)](#mouse)
  - [Keyboard (`lib/keyboard.js`)](#keyboard)
  - [Clipboard (`lib/clipboard.js`)](#clipboard)
  - [Path providers (`lib/path/`)](#path-providers)
  - [Keystroke plan builders (`lib/keystroke/`)](#keystroke-plan-builders)
  - [Executors](#executors)
- [Coordinate space & DPI](#coordinate-space--dpi)
- [Cancellation via AbortSignal](#cancellation-via-abortsignal)
- [Key names](#key-names)
- [Testing](#testing)
- [Known quirks](#known-quirks)
- [Folder structure](#folder-structure)

## Requirements

- **Node.js** (with N-API support)
- **cmake-js** and **node-addon-api** (build-time only)
- **jpeg-js** (runtime — pure JS JPEG encoding, no native image dependencies)
- **Windows 10 Pro** or later (v1 target platform)

For unattended/headless automation on Hyper-V virtual machines, **Basic Session Mode** (not Enhanced Session / RDP) is required for reliable display-pipeline behavior. See [Known quirks](#known-quirks).

## Installation

```bash
npm install desktop-window-manager
```

The package includes a prebuilt `.node` binary under `prebuilds/win32-x64/`. If you need to rebuild from source:

```bash
npx cmake-js compile
```

## Architecture overview

Three layers, one seam:

1. **Native primitive layer** (`src/window_manager_win.cpp`) — C++ built with cmake-js, producing a `.node` binary. Implements the OS-defined input events: cursor positioning, mouse buttons, wheel, key down/up, Unicode character injection, modifier release, and clipboard get/set.
2. **Addon seam** (`lib/addon.js`) — the single module that loads the `.node` and re-exports its raw primitives. Nothing else in the codebase touches the `.node` directly.
3. **JS composition layer** (`lib/*.js`) — the high-level API. Pure JavaScript, platform-agnostic. This is what callers interact with.

Two pluggable contracts sit inside the composition layer:

- The **mouse route** contract (spatial-temporal path) with swappable path providers (`linearPath`, `bezierPath`, or your own).
- The **keystroke plan** contract (temporal atom sequence) with swappable plan builders (`makeLinearKeystrokePlan`, `makeGaussianKeystrokePlan`, or your own).

Both contracts follow the same pattern: a pure function produces a data structure (a route or a plan), and a single executor walks it. Providers/builders are interchangeable; executors are not — there is exactly one of each.

## Quick start

```js
const screen   = require('./lib/screen');
const mouse    = require('./lib/mouse');
const keyboard = require('./lib/keyboard');
const clipboard = require('./lib/clipboard');

// Find and focus a window by process ID
screen.focusWindowByPid(12345);

// Move the cursor and click
await mouse.moveTo({ x: 500, y: 300 });
await mouse.click();

// Type some text with a per-character delay
await keyboard.typeText('Hello, world!', { charDelay: 50 });

// Paste via the clipboard (faster than typing for long strings)
await clipboard.paste('A very long string...', { verify: true });

// Capture the primary monitor as a JPEG buffer
const screenshot = screen.captureScreen('primary', 80);
require('fs').writeFileSync('screenshot.jpg', screenshot);
```

## API reference

### Screen & window

**`require('./lib/screen')`**

#### Capture

- **`captureScreen(target?, quality?)`** → `Buffer`
  Capture a screen region as a JPEG buffer.
  - `target`: `'primary'` (default), `'all'` (full virtual desktop), or a 0-based monitor index.
  - `quality`: JPEG quality 1–100 (default `80`).

- **`captureWindow(handle, quality?)`** → `Buffer`
  Capture a specific window as a JPEG buffer.

- **`captureDesktop(quality?)`** → `Buffer`
  **Deprecated.** Alias for `captureScreen('primary', quality)`. Use `captureScreen` instead.

#### Window queries

- **`getWindows()`** → `Array<WindowInfo>`
  All visible top-level windows. Tool windows (`WS_EX_TOOLWINDOW`) are excluded; titleless windows are included (identifiable by `className`).

  Each `WindowInfo` has: `{ handle, pid, className, title, position: {x, y}, size: {width, height} }`.

- **`getActiveWindow()`** → `WindowInfo | null`
  The currently focused window, or `null` if none.

- **`getCursorPosition()`** → `{x, y}`
  Current cursor position in absolute physical pixels.

#### Window manipulation

- **`focusWindow(titlePattern, useRegex?)`** → `boolean`
  Focus a window by title (case-insensitive substring match, or regex if `useRegex` is `true`).

- **`focusWindowByHandle(handle)`** → `boolean`
  Focus a window by its handle.

- **`focusWindowByPid(pid)`** → `boolean`
  Focus the first window owned by the given process ID. Preferred over title matching when the caller knows the target process, since PIDs are stable and unambiguous.

- **`moveWindow(handle, x, y)`** → `boolean`
  Move a window's top-left corner.

- **`resizeWindow(handle, width, height)`** → `boolean`
  Resize a window.

- **`closeWindow(handle)`** → `boolean`
  Ask a window to close (posts `WM_CLOSE`). Fire-and-forget: the return value indicates whether the message was posted, not whether the window actually closed. Follow up with `getWindows()` to confirm.

---

### Mouse

**`require('./lib/mouse')`**

#### Movement

- **`moveTo(to, options?)`** → `Promise<void>`
  Move the cursor from its current position to `to` (`{x, y}`).
  - `options.provider`: a path provider function (default `linearPath`). Pass `bezierPath` for humanized movement, or any custom function matching the [route contract](#path-providers).
  - `options.signal`: an `AbortSignal` for cancellation.
  - All other options are forwarded to the provider (e.g. `speedPxPerMs` for `linearPath`, or `minSpread`/`overshoot` for `bezierPath`).

```js
const { bezierPath } = require('./lib/path/bezier_path');

// Linear (default) — straight line at constant speed
await mouse.moveTo({ x: 500, y: 300 });

// Bezier — curved path with optional overshoot
await mouse.moveTo({ x: 500, y: 300 }, { provider: bezierPath });
```

- **`plotRoute(route, options?)`** → `Promise<void>`
  Inject a pre-built route directly. This is the sole route executor, re-exported here for convenience. See [Executors](#executors).

#### Clicks

- **`click(button?, options?)`** → `Promise<void>`
  Press and release a mouse button at the current position.
  - `button`: `'left'` (default), `'right'`, or `'middle'`.
  - `options.holdMs`: dwell time between down and up (default `0`).

- **`doubleClick(button?, options?)`** → `Promise<void>`
  Two clicks in quick succession.
  - `options.interClickDelay`: gap between clicks in ms (default `80`).
  - `options.holdMs`: dwell per individual click (default `0`).

- **`tripleClick(button?, options?)`** → `Promise<void>`
  Three clicks in quick succession. Same options as `doubleClick`.

- **`clickAt(to, options?)`** → `Promise<void>`
  `moveTo(to, options)` then `click()`. `options.button` selects the button (default `'left'`).

#### Raw button access

- **`mouseDown(button?)`** / **`mouseUp(button?)`**
  Single press/release events. Callers composing their own press-and-release sequences must guarantee the release themselves (e.g. via `try/finally`).

```js
// Manual drag: caller is responsible for guaranteeing mouseUp
await mouse.moveTo(dragStart);
mouse.mouseDown('left');
try {
    await mouse.moveTo(dragEnd);
} finally {
    mouse.mouseUp('left');
}
```

#### Scroll

- **`scroll(amount)`** → `boolean`
  Scroll by a signed pixel-ish amount. Positive = up (away from user), negative = down. Converted to wheel detents via `Math.round(amount * SCROLL_UNITS_PER_PIXEL)` where `SCROLL_UNITS_PER_PIXEL = 1.4`.

- **`scrollUp(n)`** / **`scrollDown(n)`** → `boolean`
  Convenience wrappers that normalize sign regardless of the sign of `n`.

---

### Keyboard

**`require('./lib/keyboard')`**

- **`tapKey(key, options?)`** → `Promise<void>`
  Press and release a single key.
  - `key`: a key name from the [key enum](#key-names).
  - `options.holdMs`: dwell between down and up (default `0`).

- **`keyChord(modifiers, key, options?)`** → `Promise<void>`
  Press modifiers in order, tap the main key (with optional `holdMs` dwell), then release the modifiers in **reverse order**. Reverse-order release is part of the contract. All presses are guaranteed to be released via `try/finally`, even if an error occurs mid-chord.

```js
await keyboard.keyChord(['control', 'shift'], 'escape');  // Ctrl+Shift+Esc
await keyboard.keyChord(['alt'], 'f4');                    // Alt+F4
await keyboard.keyChord(['control'], 'a');                 // Ctrl+A (select all)
```

- **`typeText(text, options?)`** → `Promise<void>`
  One-shot convenience: compiles `text` with the default linear plan builder and executes it. Equivalent to `runKeystrokePlan(makeLinearKeystrokePlan(text, options), options)`.
  - `options.charDelay`: constant inter-character delay in ms (default `0`).
  - `options.holdMs`: dwell per chord atom (default `0`).
  - `options.signal`: an `AbortSignal` for cancellation.

```js
// Type at full speed
await keyboard.typeText('Hello, world!');

// Type with a visible per-character delay
await keyboard.typeText('Typing slowly...', { charDelay: 80, holdMs: 20 });
```

- **`releaseAllModifiers()`** → `boolean`
  Force-release every known modifier key (Shift, Ctrl, Alt, Meta, left and right variants). Panic/recovery primitive for unattended automation — ensures a stuck modifier from a prior abort or error can't corrupt subsequent input.

---

### Clipboard

**`require('./lib/clipboard')`**

- **`clipboardSetText(text)`** → `boolean`
  Write text to the OS clipboard.

- **`clipboardGetText()`** → `string`
  Read the current clipboard text (returns `''` if empty or non-text).

- **`paste(text, options?)`** → `Promise<boolean>`
  Set the clipboard to `text`, then send `Ctrl+V` to paste it into whatever's currently focused. Returns `true` on success.
  - `options.verify`: if `true`, reads the clipboard back after setting it. If the readback doesn't match, `Ctrl+V` is **never sent** (unverified content is never pasted) and the function returns `false`.

```js
// Simple paste
await clipboard.paste('Some text to paste');

// Verified paste — safe for unattended hosts where clipboard writes can race
const success = await clipboard.paste('Important text', { verify: true });
if (!success) {
    console.error('Clipboard verification failed — paste was skipped');
}
```

---

### Path providers

Path providers are pure functions that generate a mouse route — an array of `{x, y, delayMs}` points — given a start and end coordinate. They conform to the route contract:

```js
provider(from, to, options) → Array<{x: number, y: number, delayMs: number}>
```

**Contract rules:**
- The first point is pinned to `from` with `delayMs: 0`.
- The last point is pinned to `to`.
- All coordinates are rounded integers; all `delayMs` values are non-negative.

#### Built-in providers

**`linearPath(from, to, options?)`** — `require('./lib/path/linear_path')`

Straight line at constant speed. Duration scales with distance.

- `options.speedPxPerMs`: pixels per millisecond (default `1.5`).
- `options.frameMs`: target ms between points (default `12`).
- `options.minDurationMs` / `options.maxDurationMs`: clamp floor/ceiling (default `30` / `2000`).

**`bezierPath(from, to, options?)`** — `require('./lib/path/bezier_path')`

Curved path with Fitts-inspired timing and optional overshoot-then-correct on long moves. Both control points are placed on the same side of the chord so the curve bows once rather than snaking.

See `bezier_path.js` source for the full options surface (spread, overshoot threshold, Fitts constants).

#### Writing a custom provider

Any function matching the contract is a drop-in:

```js
function myProvider(from, to, options) {
    // ...generate points...
    return [
        { x: from.x, y: from.y, delayMs: 0 },     // pinned to from
        // ...intermediate points...
        { x: to.x, y: to.y, delayMs: someDelay },  // pinned to to
    ];
}

await mouse.moveTo({ x: 500, y: 300 }, { provider: myProvider });
```

---

### Keystroke plan builders

Plan builders compile a string into a keystroke plan — an array of timed atoms — via a shared classification step. The classifier (`lib/keystroke/compiler.js`) decides per character whether it maps to a `chord` atom (letters, digits, standard US punctuation → real key events) or a `char` atom (emoji, dashes, curly quotes, anything without a clean key-enum mapping → Unicode injection via `typeChar`).

```js
builder(text, options) → Array<ChordAtom | CharAtom>
```

**Atom shapes:**

```js
// chord atom: a real key event (key down/up with optional modifiers)
{ kind: 'chord', key: 'h', modifiers: ['shift'], preDelayMs: 50, holdMs: 10 }

// char atom: a Unicode codepoint injected directly
{ kind: 'char', codepoint: 0x2014, preDelayMs: 50 }
```

The first atom always has `preDelayMs: 0` (no idle pause before the first keystroke).

#### Built-in builders

**`makeLinearKeystrokePlan(text, options?)`** — `require('./lib/keystroke/linear_plan')`

Even timing: constant `charDelay` between atoms, constant `holdMs` on chord atoms.

- `options.charDelay`: inter-character delay in ms (default `0`).
- `options.holdMs`: down-to-up dwell on chord atoms (default `0`).

**`makeGaussianKeystrokePlan(text, options)`** — `require('./lib/keystroke/gaussian_plan')`

Each inter-character gap is an independent draw from a normal distribution (Box-Muller transform), reproducing the timing model from the original `nutty.js` `typeText`.

- `options.charDelay`: mean of the distribution (ms).
- `options.charDelaySTD`: standard deviation (ms). Negative values clamp to `0`.
- `options.minPreDelayMs`: floor clamp so the Gaussian's negative tail can't produce zero/negative delays (default `10`).
- `options.holdMs`: static dwell on chord atoms (default `0`). Not Gaussian-distributed in v1.

```js
const { makeGaussianKeystrokePlan } = require('./lib/keystroke/gaussian_plan');
const { runKeystrokePlan } = require('./lib/keystroke/plan_executor');

const plan = makeGaussianKeystrokePlan('Hello!', {
    charDelay: 80,
    charDelaySTD: 20,
    holdMs: 15,
});
await runKeystrokePlan(plan);
```

---

### Executors

Each contract has exactly one executor. Executors are provider/builder-agnostic — they walk whatever data structure they're given without knowing or caring how it was generated.

**`plotRoute(route, options?)`** — `require('./lib/path/route_executor')`

Walks a route point-by-point, sleeping `delayMs` then calling `setCursorPosition(x, y)` for each point. Also re-exported from `lib/mouse.js`.

- `options.signal`: `AbortSignal` — checked before each point injection (see [Cancellation](#cancellation-via-abortsignal)).

**`runKeystrokePlan(plan, options?)`** — `require('./lib/keystroke/plan_executor')`

Walks a plan atom-by-atom, dispatching `chord` atoms to `keyChord` and `char` atoms to `typeChar`, honoring `preDelayMs` and `holdMs`.

- `options.signal`: `AbortSignal` — checked before each atom. On abort, `releaseAllModifiers()` is called before rejecting, so a cancel can never leave a modifier stuck down.

---

## Coordinate space & DPI

All coordinates in the API are **absolute screen coordinates in physical pixels**. The native module establishes DPI awareness at load time so that cursor positions, window rects, and injected coordinates all live in the same physical-pixel space.

On Windows, absolute cursor injection via `SendInput` normalizes coordinates to the `0..65535` range internally. This normalization happens inside the native layer — the JavaScript API deals only in pixels. This round-trip introduces an inherent ±1px quantization artifact, which is expected behavior and below any precision that matters for clicking on real UI elements.

---

## Cancellation via AbortSignal

Both executors (`plotRoute` and `runKeystrokePlan`) accept an `options.signal` (`AbortSignal`) as their sole cancellation channel. The signal is checked **before each point/atom injection** — a sleep that's already running is not itself interruptible; abort only prevents the next injection from starting.

On abort, the executor rejects with an `AbortError`. For `runKeystrokePlan`, `releaseAllModifiers()` is called immediately before rejecting, guaranteeing no modifier key is left stuck down.

```js
const controller = new AbortController();

// Cancel after 2 seconds
setTimeout(() => controller.abort(), 2000);

try {
    await keyboard.typeText('A very long string...', {
        charDelay: 100,
        signal: controller.signal,
    });
} catch (err) {
    if (err.name === 'AbortError') {
        console.log('Typing was cancelled — modifiers are guaranteed clean');
    }
}
```

---

## Key names

Key names are defined in `lib/keys.js` and target a standard 104-key US QWERTY layout. Categories:

- **Letters:** `a`–`z` (case is handled by the compiler via a `shift` modifier, not by separate names).
- **Digits:** `0`–`9` (top row).
- **Function keys:** `f1`–`f24`.
- **Modifiers:** `control`, `alt`, `shift`, `meta` (resolve to left variants), plus explicit `leftControl`/`rightControl`, `leftAlt`/`rightAlt`, `leftShift`/`rightShift`, `leftMeta`/`rightMeta`.
- **Navigation:** `up`, `down`, `left`, `right`, `home`, `end`, `pageUp`, `pageDown`, `insert`, `delete`.
- **Editing/whitespace:** `enter`, `tab`, `backspace`, `escape`, `space`.
- **Numpad:** `num0`–`num9`, `numAdd`, `numSubtract`, `numMultiply`, `numDivide`, `numDecimal`, `numEnter`.
- **Punctuation:** `backtick`, `minus`, `equal`, `leftBracket`, `rightBracket`, `backslash`, `semicolon`, `quote`, `comma`, `period`, `slash`.

Non-US layouts are not supported.

---

## Testing

Tests use a plain `node test.js` pass/fail harness with no framework. Run from the `test/` folder:

```bash
cd test
node screen.test.js
node path.test.js
node keyboard.test.js
node plan_builders.test.js    # pure JS — runs anywhere, no addon needed
node compiler.test.js         # pure JS — runs anywhere, no addon needed
node plan_executor.test.js
node mouse.test.js
node clipboard.test.js
```

Tests that exercise real input injection spawn throwaway Notepad instances as targets (never whatever window happens to be focused) and clean them up when done. Captured screenshots are written to `test/` as JPEG files for visual inspection.

Two test files (`compiler.test.js` and `plan_builders.test.js`) are pure JavaScript with no addon or OS dependency and can run on any platform.

---

## Known quirks

**SendInput ±1px quantization.** Absolute cursor injection via `SendInput` normalizes pixel coordinates to a 0–65535 range and back. This round-trip introduces up to ±1px of rounding error at any realistic resolution. Test assertions use a ±2px tolerance (`isWithinTolerance`) to accommodate this.

**Hyper-V Enhanced Session Mode.** Enhanced Session Mode suspends the guest's graphics subsystem on disconnect, which breaks GUI-dependent processes (Chrome/Puppeteer). Use **Basic Session Mode** for any VM running headed automation. The `tscon %SESSIONNAME% /dest:console` command (via PsExec for SYSTEM privileges) switches from Enhanced back to console/synthetic display.

**Circular require between keyboard.js and plan_executor.js.** `plan_executor.js` requires `keyboard.js` (for `keyChord`/`releaseAllModifiers`), and `keyboard.js`'s `typeText` needs `plan_executor.js`. This is resolved by lazy `require()` inside `typeText`'s function body — by the time `typeText` is called, both modules have finished loading regardless of which was required first.

**Notepad chrome offsets in drag tests.** The drag-selection smoke test in `mouse.test.js` uses hardcoded pixel offsets to target Notepad's text area. These assume classic Windows 10 Notepad chrome (title bar + single menu bar). Different Notepad versions (e.g. the ribbon-style Notepad on some Windows 11 builds) or DPI scaling may require adjusting these offsets.

---

## Folder structure

```
desktop-window-manager/
├── package.json
├── CMakeLists.txt
├── README.md
├── index.js                          # public entry point
├── src/
│   └── window_manager_win.cpp        # native C++ (Windows)
├── lib/
│   ├── addon.js                      # loads the .node binary (THE seam)
│   ├── keys.js                       # US-layout key enum
│   ├── screen.js                     # capture, window queries, cursor
│   ├── mouse.js                      # moveTo, click, scroll
│   ├── keyboard.js                   # tapKey, keyChord, typeText
│   ├── clipboard.js                  # get/set text, paste with verify
│   ├── path/
│   │   ├── route_executor.js         # plotRoute (sole route executor)
│   │   ├── linear_path.js            # default path provider
│   │   └── bezier_path.js            # humanized path provider
│   └── keystroke/
│       ├── plan_executor.js          # runKeystrokePlan (sole plan executor)
│       ├── compiler.js               # shared string → atoms classifier
│       ├── linear_plan.js            # default plan builder
│       └── gaussian_plan.js          # Gaussian-timing plan builder
├── prebuilds/
│   └── win32-x64/
│       └── desktop_window_manager.node
└── test/
    ├── screen.test.js
    ├── path.test.js
    ├── keyboard.test.js
    ├── compiler.test.js
    ├── plan_builders.test.js
    ├── plan_executor.test.js
    ├── mouse.test.js
    └── clipboard.test.js
```
