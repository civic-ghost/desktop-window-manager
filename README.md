# Desktop Window Manager (CMake Build)

A native Node.js addon for desktop window management. Currently supports Windows, with Linux (X11) support planned.

## Features

- Enumerate all visible desktop windows
- Get window titles and handles
- Focus windows by title (substring or regex matching)
- Focus windows by handle
- Get currently active window
- Restore minimized windows when focusing

## Prerequisites

### For Building:
- CMake 3.15 or higher
- **Windows:** Visual Studio 2019 or later with C++ support
- **Linux:** GCC/Clang, X11 development libraries
- Node.js 14.0.0 or higher
- node-addon-api: `npm install node-addon-api`

### For Using:
- Node.js 14.0.0 or higher (no build tools needed)

## Building from Source

### Step 1: Install Dependencies

```bash
cd desktop-window-manager
npm install
```

This installs `node-addon-api` which is needed for the build.

### Step 2: Build with CMake

#### Windows (using Visual Studio):

```bash
# Create build directory
mkdir build
cd build

# Configure (generates Visual Studio project)
cmake ..

# Build
cmake --build . --config Release

# The .node file is automatically copied to prebuilds/win32-x64/
```

#### Windows (using Visual Studio GUI):

```bash
mkdir build
cd build
cmake ..
```

Then open `desktop_window_manager.sln` in Visual Studio and build.

#### Linux:

```bash
mkdir build
cd build
cmake ..
make

# The .node file is automatically copied to prebuilds/linux-x64/
```

### Step 3: Test

```bash
npm test
```

## Installation in Other Projects

Once built, you can install this package in your projects:

```bash
# From local directory
npm install /path/to/desktop-window-manager

# Or with pnpm
pnpm add file:/path/to/desktop-window-manager
```

The package includes the pre-built `.node` file, so **no compilation is required** during installation.

## API

### getWindows()

Returns an array of all visible windows.

```javascript
const windowManager = require('desktop-window-manager');

const windows = windowManager.getWindows();
// Returns: [{handle: 123456, title: "Chrome - Google"}, ...]
```

### focusWindow(titlePattern, useRegex = false)

Focus a window by title. Returns `true` if found and focused, `false` otherwise.

```javascript
// Simple substring match (case-insensitive)
windowManager.focusWindow('Chrome');

// Regex match
windowManager.focusWindow('.*(Chrome|Firefox).*', true);
```

### focusWindowByHandle(handle)

Focus a window by its numeric handle. Returns `true` if focused, `false` otherwise.

```javascript
const windows = windowManager.getWindows();
const chromeWindow = windows.find(w => w.title.includes('Chrome'));
if (chromeWindow) {
    windowManager.focusWindowByHandle(chromeWindow.handle);
}
```

### getActiveWindow()

Returns the currently active (focused) window, or `null` if none.

```javascript
const active = windowManager.getActiveWindow();
// Returns: {handle: 123456, title: "Active Window"} or null
```

## Project Structure

```
desktop-window-manager/
├── CMakeLists.txt           # CMake build configuration
├── package.json             # NPM package (no build step on install)
├── index.js                 # JavaScript API wrapper
├── test.js                  # Test file
├── README.md                # This file
├── prebuilds/              # Pre-built .node files
│   ├── win32-x64/
│   │   └── desktop_window_manager.node
│   └── linux-x64/
│       └── desktop_window_manager.node
└── src/
    ├── window_manager_win.cpp    # Windows implementation
    └── window_manager_linux.cpp  # Linux implementation (stub)
```

## How It Works

Unlike the node-gyp approach which compiles on every `npm install`, this project:

1. **Build once** with CMake (on your dev machine)
2. **Commit the .node file** in `prebuilds/` directory
3. **Install anywhere** without requiring build tools

This is the same approach used by `libnut-core` and other native Node.js addons.

## Platform Support

- ✅ Windows (fully implemented)
- 🚧 Linux/X11 (planned)
- ❌ macOS (not planned)

## Development Notes

### Why CMake instead of node-gyp?

- **Simpler deployment**: No compilation during npm install
- **Faster installs**: Just copy the pre-built .node file
- **Better debugging**: CMake is easier to debug than gyp
- **Familiar workflow**: Standard C++ build process
- **IDE integration**: Open in Visual Studio directly

### Debugging in Visual Studio

1. Build with CMake to generate `.sln` file
2. Open `build/desktop_window_manager.sln` in Visual Studio
3. Set breakpoints in C++ code
4. Debug as normal C++ project

## License

MIT

## Author

Scott
