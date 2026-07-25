// lib/addon.js — the addon seam (spec §4).
//
// Loads the prebuilt native .node and re-exports its raw primitives. This is
// the single module that knows the platform/prebuild path convention. All
// composition-layer modules (mouse.js, keyboard.js, ...) require this file,
// not the .node directly.

const path = require('path');
const os = require('os');

function getPrebuildPath() {
    const platform = os.platform();

    let platformDir;
    if (platform === 'win32') {
        platformDir = 'win32-x64';
    } else if (platform === 'linux') {
        platformDir = 'linux-x64';
    } else {
        throw new Error(`Unsupported platform: ${platform}`);
    }

    return path.join(__dirname, '..', 'prebuilds', platformDir, 'desktop_window_manager.node');
}

let native;
try {
    native = require(getPrebuildPath());
} catch (error) {
    throw new Error(
        `Failed to load desktop-window-manager native addon.\n` +
        `Platform: ${os.platform()}-${os.arch()}\n` +
        `Expected: ${getPrebuildPath()}\n` +
        `Error: ${error.message}`
    );
}

module.exports = native;
