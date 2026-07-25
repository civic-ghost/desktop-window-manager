const path = require('path');
const os = require('os');
const jpeg = require('jpeg-js');

// Determine platform-specific path
function getPrebuildPath() {
    const platform = os.platform();
    const arch = os.arch();
    
    let platformDir;
    if (platform === 'win32') {
        platformDir = 'win32-x64';
    } else if (platform === 'linux') {
        platformDir = 'linux-x64';
    } else {
        throw new Error(`Unsupported platform: ${platform}`);
    }
    
    return path.join(__dirname, 'prebuilds', platformDir, 'desktop_window_manager.node');
}

// Load the native addon
let addon;
try {
    addon = require(getPrebuildPath());
} catch (error) {
    throw new Error(
        `Failed to load desktop-window-manager native addon.\n` +
        `Platform: ${os.platform()}-${os.arch()}\n` +
        `Expected: ${getPrebuildPath()}\n` +
        `Error: ${error.message}`
    );
}

/**
 * Get all visible top-level windows.
 *
 * Tool windows (WS_EX_TOOLWINDOW) are excluded; windows with no title are
 * included and can be identified by `className` (e.g. shell dialogs like
 * Windows Update prompts).
 *
 * @returns {Array<{
 *   handle: number,
 *   pid: number,
 *   className: string,
 *   title: string,
 *   position: {x: number, y: number},
 *   size: {width: number, height: number}
 * }>} Array of window objects
 */
function getWindows() {
    return addon.getWindows();
}

/**
 * Focus a window by title (case-insensitive substring match or regex)
 * @param {string} titlePattern - Window title to search for
 * @param {boolean} [useRegex=false] - Whether to treat pattern as regex
 * @returns {boolean} True if window was found and focused, false otherwise
 */
function focusWindow(titlePattern, useRegex = false) {
    return addon.focusWindow(titlePattern, useRegex);
}

/**
 * Focus a window by its handle
 * @param {number} handle - Window handle from getWindows()
 * @returns {boolean} True if window was focused, false otherwise
 */
function focusWindowByHandle(handle) {
    return addon.focusWindowByHandle(handle);
}

/**
 * Get the currently active/focused window.
 *
 * @returns {{
 *   handle: number,
 *   pid: number,
 *   className: string,
 *   title: string,
 *   position: {x: number, y: number},
 *   size: {width: number, height: number}
 * } | null} Active window, or null if there is no foreground window
 */
function getActiveWindow() {
    return addon.getActiveWindow();
}

/**
 * Ask a window to close.
 *
 * Fire-and-forget: posts WM_CLOSE to the target's message queue and returns
 * immediately. The return value indicates whether the post succeeded — NOT
 * whether the window actually closed. The target application processes
 * WM_CLOSE normally and may prompt (unsaved changes), delay, or refuse.
 * Callers that need to verify closure should follow up with getWindows().
 *
 * Uses PostMessage (not SendMessage) so a stuck target message loop cannot
 * hang the caller.
 *
 * @param {number} handle - Window handle from getWindows() or getActiveWindow()
 * @returns {boolean} True if the WM_CLOSE message was successfully posted,
 *                    false on failure to post (invalid handle, permission denied)
 */
function closeWindow(handle) {
    return addon.closeWindow(handle);
}

/**
 * Move the window
 * @param {number} handle - Window handle from getWindows() or getActiveWindow()
 * @param {number} x - The new window X position
 * @param {number} y - The new window Y position
 * @returns {boolean} True if window was moved, false otherwise
 */
function moveWindow(handle, x, y) {
    return addon.moveWindow(handle, x, y);
}

/**
 * Resize the window
 * @param {number} handle - Window handle from getWindows() or getActiveWindow()
 * @param {number} width - The new window width
 * @param {number} height - The new window height
 * @returns {boolean} True if window was resized, false otherwise
 */
function resizeWindow(handle, width, height) {
    return addon.resizeWindow(handle, width, height);
}

/**
 * Capture the primary desktop as a JPEG buffer
 * @param {number} [quality=80] - JPEG quality 1-100
 * @returns {Buffer} JPEG image data
 */
function captureDesktop(quality = 80) {
    const raw = addon.captureDesktop();
    const jpegData = jpeg.encode({
        data: raw.data,
        width: raw.width,
        height: raw.height
    }, quality);
    return jpegData.data;
}

/**
 * Capture a specific window as a JPEG buffer
 * @param {number} handle - Window handle from getWindows() or getActiveWindow()
 * @param {number} [quality=80] - JPEG quality 1-100
 * @returns {Buffer} JPEG image data
 */
function captureWindow(handle, quality = 80) {
    const raw = addon.captureWindow(handle);
    const jpegData = jpeg.encode({
        data: raw.data,
        width: raw.width,
        height: raw.height
    }, quality);
    return jpegData.data;
}

/**
 * Wake the desktop / display pipeline with a synthetic no-op mouse move
 * (net cursor displacement is zero) plus a one-shot display-required
 * assertion. Use before operations that require a responsive desktop
 * compositor — e.g. launching a headed browser on an unattended VM whose
 * display pipeline has gone dormant.
 * @returns {boolean} True if the input events were injected successfully
 */
function wakeDesktop() {
    return addon.wakeDesktop();
}

module.exports = {
    getWindows,
    focusWindow,
    focusWindowByHandle,
    getActiveWindow,
    closeWindow,
    moveWindow,
    resizeWindow,
    captureDesktop,
    captureWindow,
    wakeDesktop
};
