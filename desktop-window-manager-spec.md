# desktop-window-manager — Input Injection & OS Interaction Spec

**Status:** Draft v0.7
**Date:** 2026-07-08
**Component:** `desktop-window-manager` (native Node.js addon + JS composition layer)
**Author:** Scott

---

## 1. Purpose

`desktop-window-manager` is a general-purpose OS-interaction addon for Node.js: a small
native layer that injects the input events the operating system itself defines, and a
JavaScript layer that composes those primitives into a high-level API for mouse, keyboard,
and clipboard control, plus screen and window queries.

This spec defines the component in isolation. It is not written as a replacement for any
particular library, though it is intended to make the project's current `nut.js` wrapper
(`nutty.js`) redundant. It says nothing about the systems that *consume* the addon.

The design is cross-platform by construction. Windows is the only platform implemented in
v1; Linux/X11 is planned and the contracts here are written so that a second backend can
be added without changing the JavaScript surface.

---

## 2. Scope

### 2.1 In scope (v1)

- A native **primitive** layer exposing OS-defined input events: absolute cursor
  positioning, cursor query, mouse button up/down, vertical mouse wheel, key up/down,
  direct Unicode character injection, a modifier-release safeguard, and text clipboard
  get/set.
- A JavaScript **composition** layer exposing the high-level API: clicks and their
  variants, key taps and key chords, one-shot text typing, clipboard helpers, and the
  route/plan executors described below.
- Two **contracts** for time-sequenced input:
  - the **mouse route** contract (a spatial-temporal path) with pluggable path providers,
    `linearPath` as the default and `bezierPath` as an included alternative;
  - the **keystroke plan** contract (a temporal sequence of tagged keystroke atoms) with
    pluggable plan builders, `makeLinearKeystrokePlan` as the default.
- A **US-layout key identifier** contract shared by both platform backends.
- Documentation of the **existing** screen/window functions already in the addon, plus the
  two changes agreed here (`pid` on window queries; `captureScreen` replacing
  `captureDesktop`).

### 2.2 Out of scope / non-goals

These are deliberate exclusions. Each is the kind of boundary that is obvious now and
non-obvious to a future reader, so they are stated explicitly.

- **Content normalization / character substitution.** The addon is *content-transparent*:
  whatever string a caller hands a plan builder is typed codepoint-for-codepoint. Coercing
  em-dashes to hyphens, straightening curly quotes, stripping zero-width characters, etc.,
  is caller policy and is performed by the caller *before* calling the addon. (This is a
  policy concern that varies per caller; the technical reason a previous implementation
  needed substitution — an injection path that could not handle non-ASCII — does not exist
  here, because such characters route through the Unicode path. See §11.)
- **Non-US keyboard layouts.** The key enum and its platform mappings target a standard
  104-key US QWERTY layout only. Layout-aware injection is a separate, larger problem.
- **Autorepeat / held-key timing semantics.** The addon issues discrete key down/up events;
  OS autorepeat behavior is not modeled or simulated.
- **Window-relative or element-relative coordinate math.** Converting a DOM rect or a
  window-relative offset into a screen coordinate is caller logic. The addon works in
  absolute screen (physical-pixel) coordinates only.
- **Clipboard images / rich content.** Text (`CF_UNICODETEXT` / X11 UTF-8 selection) only.
- **Raw window messaging.** `PostMessage` / `SendMessage` / `XSendEvent` are **not** exposed
  as a general JS-visible primitive. Instead, specific window-lifecycle operations
  (`closeWindow`, §8) are provided, each mapping to the correct OS-defined mechanism on
  each platform. Rationale: raw messaging is Windows-specific in shape (integer `WM_*`
  identifiers, `wParam`/`lParam`) and has no clean cross-platform equivalent — X11's
  `XSendEvent` with a `ClientMessage` uses atoms and different semantics entirely, so
  exposing raw messaging would silently make callers write Windows-only code. This mirrors
  the `SendInput`/`XTest` treatment in §6a: the OS-defined *operation* is the primitive,
  not the underlying dispatch mechanism.
- **Interrogating window internals (controls, child elements).** Finding a specific button
  or control inside a top-level window — via `EnumChildWindows`, UI Automation, or AT-SPI —
  is not in scope. Cross-platform parity is poor and the result is version-fragile
  (target application UI changes break the caller). Where possible, `closeWindow` on the
  top-level dialog is a more robust way to dismiss it than clicking a specific control.
- **Wayland.** See §7.
- **Human-like realism as a built-in behavior.** Humanization is expressed *only* as an
  optional path provider or plan builder conforming to the contracts; the core has no
  opinion about it and defaults to linear.

### 2.3 Deferred — named but not built in v1

Listed so the contracts leave room for them, but not implemented or tested in v1:

- **Drag** (mouse-button-down → move along a route → mouse-button-up). A JS composition
  that reuses `plotRoute`; excluded from v1 because it introduces press/move/release timing
  questions with no current consumer.
- **Horizontal mouse wheel** (`MOUSEEVENTF_HWHEEL` / X11 buttons 6–7).
- **Extra mouse side-buttons** (`XBUTTON1` / `XBUTTON2`). See §8 for an extension note.
- **Window state operations:** `minimizeWindow(handle)`, `maximizeWindow(handle)`,
  `restoreWindow(handle)`. Each maps cleanly on both platforms — Windows via `ShowWindow`
  with `SW_MINIMIZE`/`SW_MAXIMIZE`/`SW_RESTORE`, X11 via `_NET_WM_STATE` client messages
  (`_NET_WM_STATE_HIDDEN`, `_NET_WM_STATE_MAXIMIZED_HORZ`/`_VERT`) — and pairs naturally
  with the existing `moveWindow`/`resizeWindow`. Named here so the shape is known if a
  future use case appears; not built in v1 because no current caller needs them.

---

## 3. Guiding principle

> **The native layer exposes the input primitives the OS itself defines; the JavaScript
> layer composes everything higher-level.**

The operating system defines a finite, enumerable set of input events — "left button down,"
"key down for this virtual-key," "move the cursor to (x, y)." Those, and only those, are
native. Everything high-level — double-click, `Ctrl+F5`, click-and-hold, typing a
string — is a *composition* of primitives and lives in JavaScript, identical across
platforms.

This principle is the answer to most "should X be in the addon?" questions: if X is an event
the OS emits, it is a native primitive; if X is a convenient arrangement of such events, it
is a JS composition; if X is application meaning layered on top (which window, which
element, what the text *should* say), it is the caller's job.

---

## 4. Architecture

Three layers, one seam.

1. **Native primitive layer** (`src/*.cpp`) — one C++ file per platform, built with
   cmake-js, producing a prebuilt `.node`. Implements the primitives in §8. Platform-specific
   by definition.
2. **Addon seam** (`lib/addon.js`) — the *single* module that loads the prebuilt `.node` and
   re-exports its raw primitives. Nothing else in the codebase calls `require` on the
   `.node` directly. This isolates the platform/prebuild-path logic (currently in `index.js`)
   in one place.
3. **JS composition layer** (`lib/*.js`) — the high-level API (§9), the executors
   (`plotRoute`, `runKeystrokePlan`), and the providers/builders. Pure JavaScript, no native
   or OS assumptions beyond what the seam exposes; platform-agnostic.

`index.js` becomes a thin public entry point that re-exports the composition layer, so
existing consumers continue to `require('desktop-window-manager')` and receive both the
primitives and the high-level API.

---

## 5. Folder structure

```
desktop-window-manager/
├── package.json
├── CMakeLists.txt
├── README.md
├── index.js                      # public entry — re-exports the high-level API
├── src/                          # native C++, one file per platform
│   ├── window_manager_win.cpp
│   └── window_manager_linux.cpp  # (future — X11)
├── lib/                          # JS composition layer
│   ├── addon.js                  # loads the prebuilt .node; exposes raw primitives (SEAM)
│   ├── keys.js                   # US-layout key enum + name→platform-code contract
│   ├── mouse.js                  # click / double / triple / hold  (deferred: drag)
│   ├── keyboard.js               # tapKey / keyChord / typeText / releaseAllModifiers
│   ├── clipboard.js              # set/get text, verify-on-paste helper
│   ├── screen.js                 # captureScreen wrapper (JPEG), window queries
│   ├── path/
│   │   ├── route_executor.js     # plotRoute — the one place that injects a route
│   │   ├── linear_path.js        # default path provider
│   │   └── bezier_path.js        # humanized path provider (already written)
│   └── keystroke/
│       ├── plan_executor.js      # runKeystrokePlan — dispatches by atom kind
│       ├── compiler.js           # shared string → atoms compile step (§11.2)
│       ├── linear_plan.js        # default plan builder
│       └── gaussian_plan.js      # Gaussian pre-delay plan builder
├── prebuilds/
│   └── win32-x64/
│       └── desktop_window_manager.node
└── test/
```

The `path/` and `keystroke/` folders are structurally parallel: each holds one executor
(`route_executor.js` / `plan_executor.js`) plus the pluggable providers or builders that
conform to its contract. `lib/keystroke/compiler.js` holds the shared string→atoms step
that every plan builder invokes (see §11.2), so classification is written once and reused.

---

## 6. Coordinate space & DPI

- All coordinates in the public API are **absolute screen coordinates in physical pixels.**
- The native module must establish DPI awareness at load time
  (`SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2)`, falling back
  to `SetProcessDPIAware`) so that `GetWindowRect`, `GetSystemMetrics`, monitor enumeration,
  the cursor position, and injected coordinates all live in the same physical-pixel space. A
  process that is not DPI-aware receives virtualized metrics and will mis-place absolute
  moves on any display scaled above 100%.
- On Windows, absolute cursor injection via `SendInput` requires normalizing the target to
  the `0..65535` range over the bounding box spanning all monitors. **This normalization is
  performed inside the native layer.** The JavaScript API deals only in pixels.
- On Linux/X11, `XTestFakeMotionEvent` accepts pixel coordinates directly. The JavaScript
  API signature is therefore identical across platforms; only the native implementation
  differs.

---

## 6a. Input fidelity (injection method)

Where an OS offers more than one way to effect an input action, the native layer must choose
the path that produces the fullest emulation of real physical input — the one that
synthesizes a genuine input event through the system's normal input pipeline — rather than a
shortcut that merely sets state. The goal is a **high-fidelity event stream** (realistic move
deltas, event ordering, and timing that downstream applications receive as trusted input),
**not evasion of injection detection**: on every platform, synthesized input remains flagged
as injected to a client that specifically checks for it, and this spec makes no claim
otherwise.

- **Windows:** cursor motion, buttons, and wheel are all driven by `SendInput` (`MOUSEINPUT`
  / `KEYBDINPUT`). `SetCursorPos` is **not** used for motion — it repositions the pointer
  without generating an equivalent input event, so hooks, hit-testing, and downstream event
  consumers do not see a proper `WM_MOUSEMOVE`. Driving motion, buttons, and wheel through the
  one `SendInput` pipeline also keeps the whole mouse event stream coherently ordered and
  consistently tagged. Absolute mode
  (`MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_VIRTUALDESK`, coordinates normalized
  to `0..65535` per §6) is used so generated waypoints land exactly; relative mode is **not**
  used, because it is subject to the pointer-acceleration ("Enhance pointer precision")
  transform and would distort the path provider's coordinates.
- **Linux/X11:** the `XTest` extension (`XTestFakeMotionEvent`, `XTestFakeButtonEvent`,
  `XTestFakeKeyEvent`) is used for the same reason — it injects events into the X server's
  normal input processing, which is the extension's purpose. `XWarpPointer` is **not** used
  for motion, being the positional-only analogue of `SetCursorPos`. Note the same honesty
  caveat: an XInput2-aware client can still identify XTest-synthesized events as such; XTest
  provides fidelity, not indistinguishability.

---

## 7. Cross-platform stance

- **Windows (v1):** Win32 — `SendInput` (mouse/keyboard), `SetWindowPos`, `EnumWindows`,
  `GetWindowThreadProcessId`, GDI + `EnumDisplayMonitors` (capture), clipboard APIs.
- **Linux/X11 (planned):** `XTest` (input injection), `XRandR` (monitor geometry), X11
  selections (clipboard). This is the same foundation used by comparable native tools.
- **Wayland: explicitly out of scope.** `XTest` does not exist under a native Wayland
  session. Any automation guest running this addon must be logged into an **Xorg / X11
  session**, which is the default on the intended target distributions (verify at runtime
  with `echo $XDG_SESSION_TYPE` → `x11`, and pin the session in the display-manager config
  for unattended hosts). Supporting Wayland would require a different injection path
  (`uinput` / libei) and is not planned.
- **US keyboard layout only** (see §12).

---

## 8. Native primitive API

The complete native surface. Each returns a boolean success unless noted. This list is
intended to be finite and testable.

### Mouse

| Primitive | Semantics |
| --- | --- |
| `setCursorPosition(x, y)` | Move the cursor to absolute physical-pixel `(x, y)`, injected as an absolute `SendInput` / `XTest` motion event (§6a). Native handles coordinate normalization (§6). |
| `getCursorPosition()` | Returns `{ x, y }`, the current cursor position in physical pixels. |
| `mouseButton(button, direction)` | `button ∈ {'left','right','middle'}`; `direction ∈ {'down','up'}`. Emits one button transition at the current cursor position. |
| `mouseWheel(amount)` | Vertical wheel. `amount` is in wheel detents; positive = wheel forward (scroll up / away from user). |

### Keyboard

| Primitive | Semantics |
| --- | --- |
| `keyDown(key)` | Press `key` (a name from the key enum, §12). |
| `keyUp(key)` | Release `key`. |
| `typeChar(codepoint)` | Inject a single Unicode codepoint directly (Windows `KEYEVENTF_UNICODE`; X11 keysym remap). No layout or modifier involvement. Handles arbitrary Unicode, including characters with no key-enum mapping. |
| `releaseAllModifiers()` | Force-release every known modifier key. Panic / recovery primitive for unattended use, to clear a leaked modifier. |

### Clipboard

| Primitive | Semantics |
| --- | --- |
| `clipboardSetText(text)` | Replace clipboard contents with `text` (UTF-8 / `CF_UNICODETEXT`). |
| `clipboardGetText()` | Return current clipboard text, or `''` if none / not text. |

### Screen & window (existing addon functions — documented for completeness)

These predate this effort and are documented, not proposed. Two changes are introduced here
and marked.

| Primitive | Semantics |
| --- | --- |
| `getWindows()` | Returns an array of `{ handle, pid, className, title, position:{x,y}, size:{width,height} }`. **Change: `pid` and `className` added** — `pid` via `GetWindowThreadProcessId`, `className` via `GetClassNameW` (Windows) / `XGetClassHint` `res_class` (X11). Both make the window list self-describing so callers can match by owning process or by the OS-defined class identifier (which, unlike titles, is not localized and is more stable across application versions). |
| `getActiveWindow()` | Returns the foreground window as `{ handle, pid, className, title, position, size }` or `null`. (`pid` and `className` added for consistency with `getWindows()`.) |
| `moveWindow(handle, x, y)` | Move a window's top-left to `(x, y)`. |
| `resizeWindow(handle, width, height)` | Resize a window to `width × height`. |
| `focusWindowByHandle(handle)` | Focus / foreground a window by handle. |
| `focusWindow(titlePattern, useRegex)` | Focus the first window whose title matches. Retained, but see §9 note — PID-based identity is preferred for reliability. |
| `closeWindow(handle)` | Ask the window at `handle` to close. Windows: `PostMessage(hwnd, WM_CLOSE, 0, 0)`. X11: `XSendEvent` of a `_NET_CLOSE_WINDOW` client message to the root window per EWMH. **Fire-and-forget:** returns `true` if the message was posted successfully, `false` on failure to post (invalid handle, permission denied). The return value is **not** a claim that the window actually closed — the target application processes `WM_CLOSE` normally and may prompt, delay, or refuse (e.g., an editor with an unsaved file). Callers that need to confirm the window is gone must verify by a follow-up `getWindows()`. **Uses `PostMessage`, not `SendMessage`,** to avoid blocking on a target with a stuck message loop. |
| `captureScreen(target)` | **Change: replaces `captureDesktop`.** Native capture returning `{ data (RGBA), width, height }`. `target` selects the region (§9). |
| `captureWindow(handle)` | Native capture of one window returning `{ data (RGBA), width, height }`. |

> **Note — retired:** `captureDesktop` is removed (single call site). Its high-level
> behavior — returning a JPEG buffer with a quality specifier — is preserved by
> `captureScreen` in the JS layer (§9).
>
> **Note — related, out of scope:** the addon also exports `wakeDesktop()`. It belongs to a
> different concern (unattended display-pipeline maintenance) and is intentionally not
> covered by this spec.

**Extension note (deferred features):** horizontal wheel and the `XBUTTON1/2` side-buttons
would each be added as a native primitive following the patterns above — a `mouseHWheel(amount)`
and an extension of `mouseButton`'s `button` domain to `{'x1','x2'}` respectively — plus a
thin JS composition. They are named here so the shape is known, but not implemented in v1.

---

## 9. JS composition API (high-level layer)

All composition functions are async where they inject input over time.

### Mouse (`lib/mouse.js`)

- `moveTo(to, options)` — resolve the current position via `getCursorPosition()`, build a
  route with the configured path provider (default `linearPath`), and inject it via
  `plotRoute`. `options.provider` selects the provider; remaining options pass through.
- `plotRoute(route, options)` — the sole route executor (§10).
- `click(button = 'left')`, `doubleClick(button = 'left')`, `tripleClick(button = 'left')` —
  compositions of `mouseButton` at the current cursor position.
- `mouseDown(button = 'left')`, `mouseUp(button = 'left')` — press/release primitives at the
  current cursor position. Callers composing a press-and-release sequence themselves are
  responsible for guaranteeing the release (a `try/finally` around any body that runs
  between them, to avoid leaving a button stuck down on error). Guaranteed-release
  compositions are properly the job of higher-level operations that own the whole press-do-
  something-release lifecycle — see the deferred `drag(from, to, options)` in §2.3.
- `clickAt(to, options)` — `moveTo(to, options)` then `click()`. (Move and click remain
  independently callable; `clickAt` is convenience only.)
- `scroll(amount)` / `scrollUp(n)` / `scrollDown(n)` — map a signed request onto
  `mouseWheel`. The pixel↔detent conversion lives here, not in the native layer; the
  starting conversion factor is `SCROLL_UNITS_PER_PIXEL = 1.4`, carried over from the current
  implementation and empirical (subject to adjustment against observed behavior).
- *(deferred: `drag(from, to, options)`, horizontal scroll.)*

### Keyboard (`lib/keyboard.js`)

- `tapKey(key, options)` — `keyDown(key)` then `keyUp(key)`. `options.holdMs` (ms, default `0`)
  is the dwell held between the down and up events; `0` means back-to-back, matching the
  behavior of a spec-conforming implementation of `tapKey(key)` alone. Same semantics as the
  `holdMs` on `keyChord` and on `chord`-kind atoms in a keystroke plan.
- `keyChord(modifiers, key, options)` — press each modifier in `modifiers` (in array order),
  tap `key` (held `options.holdMs` if specified), then release the modifiers **in reverse
  order**. This is the general form for `F5`, `Ctrl+F5`, `Ctrl+Shift+Esc`, `Alt+F4`, etc.
  Reverse-order release is part of the contract and both backends must honor it.
- `typeText(text, options)` — one-shot convenience equal to
  `runKeystrokePlan(makeLinearKeystrokePlan(text, options), options)`. Keystroke-plan
  machinery (`runKeystrokePlan`, `makeLinearKeystrokePlan`, `makeGaussianKeystrokePlan`)
  lives in `lib/keystroke/` and is re-exported from the package entry (see §5, §11).
- `releaseAllModifiers()` — wraps the native safeguard.

### Clipboard (`lib/clipboard.js`)

- `clipboardSetText(text)` / `clipboardGetText()` — thin wrappers over the primitives.
- `paste(text, options)` — set the clipboard, optionally **verify** by reading it back
  (`options.verify`, useful on a flaky unattended host), then issue `keyChord(['control'], 'v')`.

### Screen & window (`lib/screen.js`)

- `captureScreen(target = 'primary', quality = 80)` — returns a **JPEG `Buffer`**.
  `target` is `'primary'` (default), a 0-based monitor index, or `'all'` (the full desktop
  across all monitors). The native call returns raw RGBA; JPEG encoding (with the `quality`
  knob) happens here via `jpeg-js`. *Note:* an `'all'` capture spans the bounding box across
  all monitors; with mismatched or non-flush monitor arrangements the union rectangle exceeds
  the real pixels and the gaps render black. This is inherent, not a defect.
- `captureWindow(handle, quality = 80)` — returns a JPEG `Buffer`; same RGBA→JPEG treatment.
- `getWindows()`, `getActiveWindow()`, `moveWindow()`, `resizeWindow()`,
  `focusWindowByHandle()`, `focusWindow()`, `closeWindow()`, `getCursorPosition()` —
  pass-throughs.
- `focusWindowByPid(pid)` — composition over `getWindows()`: filter by owning `pid`, focus
  the match. Preferred over title matching when the caller knows the process that owns the
  target window.

---

## 10. Mouse movement — route contract & providers

### 10.1 Route contract

A **route** is a flat array of points:

```js
{ x: number, y: number, delayMs: number }
```

- `x`, `y` — absolute physical-pixel coordinate of this waypoint.
- `delayMs` — how long the executor pauses **before** injecting this point.
- The **first** point is where the cursor already is: `delayMs` is `0` and it is pinned to
  the move's `from`, to avoid a rounding hop on the first injection.
- The **last** point is pinned to the move's `to`, so any provider that overshoots still
  lands exactly on the requested target.

### 10.2 Provider contract

A **path provider** is a pure function:

```js
pathProvider(from, to, options) -> route
```

Providers have no OS, native, or browser dependencies. They are unit-testable in isolation.

- `linearPath(from, to, options)` — **default.** A straight line resampled in time. The
  simplest possible route; the baseline the executor and callers assume.
- `bezierPath(from, to, options)` — an included humanized alternative (curved path, eased
  velocity, optional overshoot-and-correct). Already implemented. See §14 for attribution.

Humanization is a property of the *provider*, not of the core. Any future provider that
conforms to the route contract is a drop-in.

### 10.3 Executor

`plotRoute(route, options)` is the single point that injects a route: for each point it
sleeps `delayMs`, then calls `setCursorPosition(x, y)`. It is provider-agnostic — it neither
knows nor cares how the route was generated.

**Cancellation.** `options.signal` (an `AbortSignal`) is the sole control channel. The
executor checks it before each point injection; on abort it stops and rejects with an abort
error. Normal completion is the resolved Promise — there is no separate completion callback.

---

## 11. Text input — keystroke plan contract & builders

Text input is *not* forced into symmetry with the mouse route. A keystroke is an interval
(down, then up) rather than an instant, and a string compiles into **two kinds** of atoms
because there are two injection paths. The contract reflects that.

### 11.1 Keystroke plan contract

A **keystroke plan** (`keystrokePlan`) is a flat array of **tagged atoms**:

```js
// Character atom — injected via typeChar (Unicode path). Pre-gap timing only.
{ kind: 'char',  codepoint: number, preDelayMs: number }

// Chord atom — injected via keyChord (key-enum path). Has a real key + dwell.
{ kind: 'chord', key: KeyName, modifiers: KeyName[], preDelayMs: number, holdMs: number }
```

- `preDelayMs` — pause **before** this atom. Present on every atom; for a `char` atom it is
  the only timing field.
- `holdMs` — dwell (key-down-to-key-up) time. Present on `chord` atoms **only** — the main
  key is held `holdMs` between down and up, bracketed by its modifiers. A `char` atom has no
  `holdMs` field at all: the Unicode path has no physical key being held, so there is no dwell
  to represent. The *presence* of `holdMs` is therefore what distinguishes an atom that has a
  real key from one that does not.
- `key` / `modifiers` on chord atoms are names from the key enum (§12).

### 11.2 Builder contract

A **plan builder** compiles a string into a plan:

```js
makeXxxKeystrokePlan(text, options) -> keystrokePlan
```

Two builders are included in v1:

- `makeLinearKeystrokePlan(text, options)` — **default.** Even timing.
  - `options`: `{ charDelay = 0, holdMs = 0 }`
  - `charDelay` (ms) — the constant `preDelayMs` written on every atom **after the first**.
    The first atom is exempt (see the shared first-atom rule below). A caller who wants
    "type as fast as the loop runs" leaves it at the default of `0`; one who wants slow
    even typing sets a positive value.
  - `holdMs` (ms) — the static dwell written on every `chord` atom. Applied uniformly
    across the plan; varying dwell per keystroke is a humanization concern reserved for a
    future builder.

- `makeGaussianKeystrokePlan(text, options)` — Gaussian pre-delay timing. Reproduces the
  approach used in the current `nutty.js` `typeText`: each inter-character gap is an
  independent draw from a normal distribution.
  - `options`: `{ charDelay, charDelaySTD, minPreDelayMs = 10, holdMs = 0 }`
  - `charDelay` (ms) — the **mean** of the distribution.
  - `charDelaySTD` (ms) — the **standard deviation**.
  - `minPreDelayMs` (ms) — lower clamp applied to every sample so the negative tail of the
    Gaussian cannot produce a zero or negative sleep. Default `10`, matching current
    `nutty.js` behavior; a caller who wants faster can override.
  - `holdMs` (ms) — as with linear, the **static** dwell written on every `chord` atom.
    `holdMs` is **not** Gaussian-distributed in v1: this builder's timing model varies only
    the inter-character gap, not the dwell. A future builder can extend this.
  - Sampling uses the Box-Muller transform (see the current `nutty.js` `typeText` for the
    same implementation). Every atom after the first receives
    `preDelayMs = max(minPreDelayMs, N(charDelay, charDelaySTD²))`.

**Shared first-atom rule.** Both builders set the **first atom's `preDelayMs = 0`**, so a
plan does not sit idle before its first keystroke. This mirrors the mouse-route
first-point rule in §10.1 (the executor's initial action lands immediately). A caller who
genuinely wants a pre-typing pause can either edit the first atom or wrap the call in
their own sleep. This is a builder-level behavior, not an executor rule — the executor
simply obeys whatever `preDelayMs` a plan carries.

**Shared compile step.** All builders share one string→atoms compile step, implemented in
`lib/keystroke/compiler.js`. The compiler decides, per character, whether it becomes a
`chord` atom or a `char` atom.

- Characters with a clean US-layout key-enum mapping (letters, digits, standard punctuation)
  compile to **`chord`** atoms — e.g. `H` → `{ kind:'chord', key:'h', modifiers:['shift'] }`.
  This path yields the highest-fidelity key events (real `code`/`keyCode` values).
- Everything else compiles to **`char`** atoms routed through `typeChar` (the Unicode path):
  emoji, dashes, curly quotes, and any codepoint without a clean enum mapping.

The classification is a pure technical determination — it has a single correct answer per
codepoint and is **builder-invariant.** The builder *name* refers only to the **timing model**
layered on top (linear and Gaussian in v1; a future `makeHumanKeystrokePlan` would inherit
the identical classification and vary only the delays/dwell). This is the `isDirectlyTypeable`
discrimination from the current `nutty.js` typing path, relocated into the compiler; the
substitution table does **not** come along (see §2.2 — content is the caller's concern).

### 11.3 Executor

`runKeystrokePlan(plan, options)` walks the plan and **dispatches by `kind`**: `chord` atoms
to `keyChord`, `char` atoms to `typeChar`, honoring `preDelayMs` (and `holdMs` for chords).
It is a small dispatcher over the primitive layer — a sibling of `plotRoute`, not a second
copy of it.

**Cancellation.** As with `plotRoute`, `options.signal` (an `AbortSignal`) is the sole
control channel, checked before each atom; on abort the executor stops and rejects, and
normal completion is the resolved Promise. Because an abort can land mid-chord — after a
modifier is down but before it is released — the executor calls `releaseAllModifiers()`
before rejecting, so a cancel can never leave `Shift`, `Ctrl`, `Alt`, or `Meta` stuck down
on an unattended host.

---

## 12. Key identifier contract (US layout)

Both platform backends map from a **stable set of key names** to their platform codes
(Windows virtual-key codes; X11 keysyms/keycodes). Callers use names only; the mapping table
is the main place cross-platform bugs can hide and is therefore an explicit deliverable in
`lib/keys.js` with a per-platform mapping in each backend.

Scope: **standard 104-key US QWERTY** only. Categories:

- **Letters:** `a`–`z` (case handled by the plan compiler via a `shift` modifier, not by
  separate names).
- **Digits:** `0`–`9` (top row).
- **Function keys:** `f1`–`f24`.
- **Modifiers:** left/right variants — `leftControl`/`rightControl`, `leftAlt`/`rightAlt`,
  `leftShift`/`rightShift`, `leftMeta`/`rightMeta` — plus generic aliases `control`, `alt`,
  `shift`, `meta` resolving to the left variant.
- **Navigation:** `up`, `down`, `left`, `right`, `home`, `end`, `pageUp`, `pageDown`,
  `insert`, `delete`.
- **Editing / whitespace:** `enter`, `tab`, `backspace`, `escape`, `space`.
- **Numpad:** `num0`–`num9`, `numAdd`, `numSubtract`, `numMultiply`, `numDivide`,
  `numDecimal`, `numEnter`.
- **Symbol/punctuation keys** as needed for chord-path typing of ASCII punctuation.

Non-US layouts are out of scope (§2.2).

---

## 13. Testing & definition of done

Because the native surface (§8) is a finite, enumerable list, "done" is well-defined:

- **Native primitives:** each implemented and verified on Windows against a known target
  (e.g., injecting into a controlled text field / harness window and asserting the resulting
  events or contents). Each primitive has a clear pass/fail.
- **Pure-JS units** (path providers, plan builders): deterministic structural assertions —
  a route starts at `from` and ends at `to`, timing is non-negative and monotonic in
  cumulative time, point/atom counts are bounded; a plan classifies a known mixed string into
  the expected `chord`/`char` atom sequence. Humanized output is asserted on *properties*
  (endpoints pinned, bounded curvature/duration), not exact coordinates.
- **Compositions** (click/double/chord/typeText/paste): asserted as the expected primitive
  event sequence (e.g., `keyChord(['shift'],'h')` ⇒ shift-down, h-down, h-up, shift-up).
- **Definition of done for v1:** the §8 primitive set implemented and tested on Windows; the
  §9 composition layer implemented; the §10 and §11 contracts stable with their default
  providers/builders (`linearPath`, `makeLinearKeystrokePlan`) and the included `bezierPath`;
  the §12 US key enum complete for Windows. Linux/X11 backend is explicitly a later
  milestone.

---

## 14. Attribution

`bezier_path.js` is a clean-room implementation written from standard curve math. Two design
ideas were adopted after review of Xetera's **ghost-cursor** (MIT,
`https://github.com/Xetera/ghost-cursor`) and reimplemented in our own code:

1. Placing both Bézier control points on the **same side** of the chord, so the curve bows
   once rather than snaking.
2. **Overshoot** via a point sampled uniformly from a disk around the target
   (`radius * sqrt(random)` for area-uniformity).

All other math (vector operations, direct cubic-Bézier evaluation, arc-length resampling,
Fitts-inspired timing) is standard and independently written; ghost-cursor's `bezier-js`
dependency and its speed-derivative function are not used.
