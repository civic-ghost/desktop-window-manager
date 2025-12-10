const path = require('path');
const os = require('os');

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
 * Get all visible windows on the desktop
 * @returns {Array<{handle: number, title: string}>} Array of window objects
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
 * Get the currently active/focused window
 * @returns {{handle: number, title: string, position: {x, y}, size: {width, height} } | null} Active window or null
 */
function getActiveWindow() {
    return addon.getActiveWindow();
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
function resizeWindow(handle, x, y) {
    return addon.resizeWindow(handle, x, y);
}

module.exports = {
    getWindows,
    focusWindow,
    focusWindowByHandle,
    getActiveWindow,
    moveWindow,
    resizeWindow
};
