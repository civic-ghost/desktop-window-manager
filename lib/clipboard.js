'use strict';

// lib/clipboard.js — Clipboard composition layer (spec §9).

const addon = require('./addon');
const { keyChord } = require('./keyboard');

/**
 * Write text to the clipboard. Thin wrapper over the native primitive.
 *
 * @param {string} text
 * @returns {boolean}
 */
function clipboardSetText(text) {
    return addon.clipboardSetText(text);
}

/**
 * Read the current clipboard text. Thin wrapper over the native primitive.
 *
 * @returns {string}
 */
function clipboardGetText() {
    return addon.clipboardGetText();
}

/**
 * Set the clipboard to `text`, then paste it into whatever's currently
 * focused via Ctrl+V.
 *
 * With `options.verify`, the clipboard is read back immediately after being
 * set, before Ctrl+V is sent — useful on a flaky unattended host where the
 * OS-level clipboard write could silently fail or race with something else.
 * If the readback doesn't match what was just set, Ctrl+V is NOT sent (never
 * paste unverified content) and this returns `false`. This matches the rest
 * of the library's convention: thrown errors are reserved for invalid input
 * (bad key/button names), while runtime/operational outcomes like this one
 * are reported via a boolean return, same as moveWindow/resizeWindow/
 * focusWindow/closeWindow.
 *
 * @param {string} text
 * @param {Object} [options]
 * @param {boolean} [options.verify=false]  Read the clipboard back after
 *   setting it, and skip the paste if it doesn't match.
 * @returns {Promise<boolean>} `true` if the paste was sent (verification
 *   passed, or wasn't requested); `false` if verification was requested and
 *   failed, in which case Ctrl+V was never sent.
 */
async function paste(text, options = {}) {
    const { verify = false } = options;

    clipboardSetText(text);

    if (verify) {
        const readback = clipboardGetText();
        if (readback !== text) {
            return false;
        }
    }

    await keyChord(['control'], 'v');
    return true;
}

module.exports = {
    clipboardSetText,
    clipboardGetText,
    paste,
};
