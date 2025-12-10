const windowManager = require('./index');

console.log('Desktop Window Manager Test\n');

// Test 1: Get all windows
console.log('=== Test 1: Get All Windows ===');
try {
    const windows = windowManager.getWindows();
    console.log(`Found ${windows.length} windows:`);
    windows.forEach((win, idx) => {
        console.log(`  ${idx + 1}. "${win.title}" (handle: ${win.handle})`);
    });
} catch (error) {
    console.error('Error:', error.message);
}

console.log('\n=== Test 2: Get Active Window ===');
let activeWindow = null;
try {
    activeWindow = windowManager.getActiveWindow();
    if (activeWindow) {
        console.log(`Active window: "${activeWindow.title}" (handle: ${activeWindow.handle})`);
    } else {
        console.log('No active window found');
    }
} catch (error) {
    console.error('Error:', error.message);
}

console.log('\n=== Test 2.1: Move Active Window ===');
try {
    if (activeWindow) {
        const success = windowManager.moveWindow(activeWindow.handle, activeWindow.position.x+50, activeWindow.position.y-50 );
        console.log(success ? 'Successfully moved window!' : 'Window not moved');
    } 
} catch (error) {
    console.error('Error:', error.message);
}

console.log('\n=== Test 2.2: Resize Active Window ===');
try {
    if (activeWindow) {
        const success = windowManager.resizeWindow(activeWindow.handle, activeWindow.size.width+50, activeWindow.size.height );
        console.log(success ? 'Successfully resized window!' : 'Window not resized');
    } 
} catch (error) {
    console.error('Error:', error.message);
}
console.log('\n=== Test 3: Focus Window by Title ===');
// Try to focus a Chrome window (adjust the title as needed)
const searchTitle = 'Chrome';
console.log(`Attempting to focus window with title containing "${searchTitle}"...`);
try {
    const success = windowManager.focusWindow(searchTitle);
    console.log(success ? 'Successfully focused window!' : 'Window not found');
} catch (error) {
    console.error('Error:', error.message);
}

console.log('\n=== Test 4: Focus Window by Regex ===');
// Try using regex to match any browser
const regexPattern = '.*(Chrome|Firefox|Edge).*';
console.log(`Attempting to focus window matching regex "${regexPattern}"...`);
try {
    const success = windowManager.focusWindow(regexPattern, true);
    console.log(success ? 'Successfully focused window!' : 'Window not found');
} catch (error) {
    console.error('Error:', error.message);
}

console.log('\nTests complete!');
