#include <napi.h>
#include <windows.h>
#include <string>
#include <vector>
#include <regex>
#include <algorithm>
#include <cctype>
#include <unordered_map>

// -----------------------------------------------------------------------------
// DPI awareness (spec §6)
// -----------------------------------------------------------------------------

#ifndef DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2
DECLARE_HANDLE(DPI_AWARENESS_CONTEXT);
#define DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2 ((DPI_AWARENESS_CONTEXT)-4)
#endif

static void InitDpiAwareness() {
    typedef BOOL (WINAPI *SetProcessDpiAwarenessContextFn)(DPI_AWARENESS_CONTEXT);

    HMODULE hUser32 = GetModuleHandleW(L"user32.dll");
    if (hUser32) {
        auto pFn = reinterpret_cast<SetProcessDpiAwarenessContextFn>(
            GetProcAddress(hUser32, "SetProcessDpiAwarenessContext"));
        if (pFn && pFn(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2)) {
            return;
        }
    }
    SetProcessDPIAware();
}

// -----------------------------------------------------------------------------
// UTF-8 helpers
// -----------------------------------------------------------------------------

static std::string WideToUtf8(const wchar_t* wide, int wideLen) {
    if (wideLen <= 0) return std::string();
    int utf8Len = WideCharToMultiByte(
        CP_UTF8, 0, wide, wideLen, nullptr, 0, nullptr, nullptr);
    if (utf8Len <= 0) return std::string();
    std::string result(static_cast<size_t>(utf8Len), '\0');
    WideCharToMultiByte(
        CP_UTF8, 0, wide, wideLen, result.data(), utf8Len, nullptr, nullptr);
    return result;
}

static std::string GetWindowTitleUtf8(HWND hwnd) {
    int wideLen = GetWindowTextLengthW(hwnd);
    if (wideLen <= 0) return std::string();
    std::vector<wchar_t> buffer(static_cast<size_t>(wideLen) + 1);
    int actual = GetWindowTextW(hwnd, buffer.data(), wideLen + 1);
    if (actual <= 0) return std::string();
    return WideToUtf8(buffer.data(), actual);
}

// Class names are bounded — 256 wchar_t is well over any real Win32 class name.
static std::string GetWindowClassNameUtf8(HWND hwnd) {
    wchar_t buf[256];
    int len = GetClassNameW(hwnd, buf, 256);
    return len > 0 ? WideToUtf8(buf, len) : std::string();
}

static std::string AsciiToLower(const std::string& s) {
    std::string out;
    out.reserve(s.size());
    for (unsigned char c : s) {
        out.push_back(static_cast<char>(std::tolower(c)));
    }
    return out;
}

// -----------------------------------------------------------------------------
// Window enumeration
// -----------------------------------------------------------------------------

struct WindowInfo {
    HWND handle;
    std::string title;
};

// Filter (spec change v0.5): return every visible top-level window that is
// NOT a tool window (WS_EX_TOOLWINDOW). The previous "must have a non-empty
// title" filter was dropped because callers need to identify shell dialogs
// (e.g. the Windows Update prompt) by className, and those often have no
// title. WS_EX_TOOLWINDOW is the classic "not user-facing" flag — it
// excludes floating palettes, tray helpers, and tooltip carriers while
// leaving real dialogs (which are not tool windows) intact.
BOOL CALLBACK EnumWindowsProc(HWND hwnd, LPARAM lParam) {
    auto* windows = reinterpret_cast<std::vector<WindowInfo>*>(lParam);

    if (IsWindowVisible(hwnd)) {
        LONG exStyle = GetWindowLongW(hwnd, GWL_EXSTYLE);
        if (!(exStyle & WS_EX_TOOLWINDOW)) {
            WindowInfo info;
            info.handle = hwnd;
            info.title = GetWindowTitleUtf8(hwnd); // may be empty; that's fine
            windows->push_back(std::move(info));
        }
    }

    return TRUE;
}

// Assemble the JS-facing object for one window. Shared by getWindows and
// getActiveWindow so pid / className / rect handling stays in one place.
//
// Failure policy: null-on-failure (not throw). A window can vanish between
// EnumWindows returning and this call (transient dialog closing, another
// process destroying its window), so the natural fix is "skip this entry"
// rather than "abort the whole enumeration". getWindows() filters nulls
// out of its result; getActiveWindow() passes null through, which is the
// same shape as "no active window right now".
static Napi::Value BuildWindowObject(Napi::Env env, HWND hwnd, const std::string& title) {
    RECT rect;
    if (!GetWindowRect(hwnd, &rect)) {
        return env.Null();
    }

    // GetWindowThreadProcessId returns 0 on failure (typically an invalid
    // or already-destroyed HWND). Anything else is a valid thread id, and
    // the pid is written through the out-param.
    DWORD pid = 0;
    if (GetWindowThreadProcessId(hwnd, &pid) == 0) {
        return env.Null();
    }

    std::string className = GetWindowClassNameUtf8(hwnd);

    Napi::Object obj = Napi::Object::New(env);
    obj.Set("handle",    Napi::Number::New(env, reinterpret_cast<int64_t>(hwnd)));
    obj.Set("pid",       Napi::Number::New(env, static_cast<uint32_t>(pid)));
    obj.Set("className", Napi::String::New(env, className));
    obj.Set("title",     Napi::String::New(env, title));

    Napi::Object position = Napi::Object::New(env);
    position.Set("x", Napi::Number::New(env, rect.left));
    position.Set("y", Napi::Number::New(env, rect.top));
    obj.Set("position", position);

    Napi::Object size = Napi::Object::New(env);
    size.Set("width",  Napi::Number::New(env, rect.right - rect.left));
    size.Set("height", Napi::Number::New(env, rect.bottom - rect.top));
    obj.Set("size", size);

    return obj;
}

Napi::Value GetWindows(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    std::vector<WindowInfo> windows;
    EnumWindows(EnumWindowsProc, reinterpret_cast<LPARAM>(&windows));

    // Skip nulls (windows that vanished between EnumWindows and construction).
    // A single dead entry no longer aborts the whole enumeration.
    Napi::Array result = Napi::Array::New(env);
    uint32_t writeIdx = 0;
    for (size_t i = 0; i < windows.size(); i++) {
        Napi::Value obj = BuildWindowObject(env, windows[i].handle, windows[i].title);
        if (obj.IsNull()) continue;
        result.Set(writeIdx++, obj);
    }

    return result;
}

Napi::Value FocusWindow(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (info.Length() < 1 || !info[0].IsString()) {
        Napi::TypeError::New(env, "String expected").ThrowAsJavaScriptException();
        return env.Null();
    }

    std::string pattern = info[0].As<Napi::String>().Utf8Value();
    bool useRegex = (info.Length() > 1 && info[1].IsBoolean())
        ? info[1].As<Napi::Boolean>().Value() : false;

    std::vector<WindowInfo> windows;
    EnumWindows(EnumWindowsProc, reinterpret_cast<LPARAM>(&windows));

    HWND targetWindow = nullptr;

    if (useRegex) {
        try {
            std::regex re(pattern, std::regex::icase);
            for (const auto& win : windows) {
                // Empty titles never match; focusWindow is a title-based API.
                if (!win.title.empty() && std::regex_search(win.title, re)) {
                    targetWindow = win.handle;
                    break;
                }
            }
        } catch (const std::regex_error&) {
            Napi::Error::New(env, "Invalid regex pattern").ThrowAsJavaScriptException();
            return env.Null();
        }
    } else {
        std::string lowerPattern = AsciiToLower(pattern);
        for (const auto& win : windows) {
            if (win.title.empty()) continue;
            if (AsciiToLower(win.title).find(lowerPattern) != std::string::npos) {
                targetWindow = win.handle;
                break;
            }
        }
    }

    if (targetWindow) {
        if (IsIconic(targetWindow)) {
            ShowWindow(targetWindow, SW_RESTORE);
        }
        SetForegroundWindow(targetWindow);
        SetFocus(targetWindow);
        return Napi::Boolean::New(env, true);
    }

    return Napi::Boolean::New(env, false);
}

Napi::Value FocusWindowByHandle(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (info.Length() < 1 || !info[0].IsNumber()) {
        Napi::TypeError::New(env, "Number expected").ThrowAsJavaScriptException();
        return env.Null();
    }

    int64_t handleValue = info[0].As<Napi::Number>().Int64Value();
    HWND hwnd = reinterpret_cast<HWND>(handleValue);

    if (!IsWindow(hwnd)) {
        return Napi::Boolean::New(env, false);
    }

    if (IsIconic(hwnd)) {
        ShowWindow(hwnd, SW_RESTORE);
    }
    SetForegroundWindow(hwnd);
    SetFocus(hwnd);

    return Napi::Boolean::New(env, true);
}

Napi::Value GetActiveWindowInfo(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    HWND hwnd = ::GetForegroundWindow();
    if (!hwnd) return env.Null();

    // BuildWindowObject returns null if the window vanishes mid-call; we
    // pass that through, which is the same semantic as "no active window".
    std::string title = GetWindowTitleUtf8(hwnd);
    return BuildWindowObject(env, hwnd, title);
}

// Ask a window to close (spec change v0.5).
//
// PostMessage is REQUIRED here — do NOT change to SendMessage. PostMessage
// is fire-and-forget; SendMessage blocks until the target processes the
// message, which hangs the caller indefinitely if the target's message
// loop is stuck. This mirrors §6a's "OS-defined operation is the primitive,
// not the underlying dispatch mechanism" principle.
//
// Return value semantics: true = the message was successfully posted to the
// target's message queue. false = the post itself failed (invalid handle,
// permission denied, etc.). NOT a claim that the window closed — the target
// application processes WM_CLOSE normally and may prompt, delay, or refuse
// (e.g. an editor with unsaved changes). Callers that need to verify
// closure must do a follow-up getWindows() check themselves.
//
// Named CloseWindowEx (not CloseWindow) because <windows.h> declares
// CloseWindow as a Win32 function; the unqualified name at the export
// site would resolve to the Win32 symbol and fail template matching in
// Napi::Function::New. Same pattern as MoveWindowEx and GetActiveWindowInfo.
Napi::Value CloseWindowEx(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (info.Length() < 1 || !info[0].IsNumber()) {
        Napi::TypeError::New(env, "Expected 1 argument: handle")
            .ThrowAsJavaScriptException();
        return env.Null();
    }

    int64_t handleValue = info[0].As<Napi::Number>().Int64Value();
    HWND hwnd = reinterpret_cast<HWND>(handleValue);

    if (!IsWindow(hwnd)) {
        return Napi::Boolean::New(env, false);
    }

    BOOL posted = PostMessageW(hwnd, WM_CLOSE, 0, 0);
    return Napi::Boolean::New(env, posted != 0);
}

Napi::Value MoveWindowEx(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (info.Length() < 3) {
        Napi::TypeError::New(env, "Expected 3 arguments: handle, x, y").ThrowAsJavaScriptException();
        return env.Null();
    }
    if (!info[0].IsNumber() || !info[1].IsNumber() || !info[2].IsNumber()) {
        Napi::TypeError::New(env, "All arguments must be numbers").ThrowAsJavaScriptException();
        return env.Null();
    }

    int64_t handleValue = info[0].As<Napi::Number>().Int64Value();
    HWND hwnd = reinterpret_cast<HWND>(handleValue);

    if (!IsWindow(hwnd)) {
        return Napi::Boolean::New(env, false);
    }

    int x = info[1].As<Napi::Number>().Int32Value();
    int y = info[2].As<Napi::Number>().Int32Value();

    BOOL result = SetWindowPos(hwnd, nullptr, x, y, 0, 0,
        SWP_NOSIZE | SWP_NOZORDER);

    return Napi::Boolean::New(env, result != 0);
}

Napi::Value ResizeWindow(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (info.Length() < 3) {
        Napi::TypeError::New(env, "Expected 3 arguments: handle, width, height").ThrowAsJavaScriptException();
        return env.Null();
    }
    if (!info[0].IsNumber() || !info[1].IsNumber() || !info[2].IsNumber()) {
        Napi::TypeError::New(env, "All arguments must be numbers").ThrowAsJavaScriptException();
        return env.Null();
    }

    int64_t handleValue = info[0].As<Napi::Number>().Int64Value();
    HWND hwnd = reinterpret_cast<HWND>(handleValue);

    if (!IsWindow(hwnd)) {
        return Napi::Boolean::New(env, false);
    }

    int width = info[1].As<Napi::Number>().Int32Value();
    int height = info[2].As<Napi::Number>().Int32Value();

    BOOL result = SetWindowPos(hwnd, nullptr, 0, 0, width, height,
        SWP_NOMOVE | SWP_NOZORDER);

    return Napi::Boolean::New(env, result != 0);
}

// -----------------------------------------------------------------------------
// Screen capture
//
// Failure policy for the capture pipeline: throw on failure. These are
// single-target operations with no natural fallback — if BitBlt or GetDIBits
// fails there is no partial result to return, and a silent black buffer
// would be indistinguishable from a successful capture of a blank screen.
// Every GDI resource acquired along the way is released before the throw
// so we don't leak GDI handles when a capture aborts.
// -----------------------------------------------------------------------------

static BOOL CALLBACK EnumMonitorsProc(HMONITOR, HDC, LPRECT lprcMonitor, LPARAM dwData) {
    auto* monitors = reinterpret_cast<std::vector<RECT>*>(dwData);
    monitors->push_back(*lprcMonitor);
    return TRUE;
}

static std::vector<RECT> EnumerateMonitors() {
    std::vector<RECT> monitors;
    EnumDisplayMonitors(nullptr, nullptr, EnumMonitorsProc,
                        reinterpret_cast<LPARAM>(&monitors));
    return monitors;
}

static Napi::Value CaptureRegion(Napi::Env env, int srcX, int srcY, int width, int height) {
    if (width <= 0 || height <= 0) {
        Napi::Error::New(env, "Invalid capture region dimensions")
            .ThrowAsJavaScriptException();
        return env.Null();
    }

    HDC hdcScreen = GetDC(NULL);
    if (!hdcScreen) {
        Napi::Error::New(env, "GetDC failed")
            .ThrowAsJavaScriptException();
        return env.Null();
    }

    HDC hdcMem = CreateCompatibleDC(hdcScreen);
    if (!hdcMem) {
        ReleaseDC(NULL, hdcScreen);
        Napi::Error::New(env, "CreateCompatibleDC failed")
            .ThrowAsJavaScriptException();
        return env.Null();
    }

    HBITMAP hBitmap = CreateCompatibleBitmap(hdcScreen, width, height);
    if (!hBitmap) {
        DeleteDC(hdcMem);
        ReleaseDC(NULL, hdcScreen);
        Napi::Error::New(env, "CreateCompatibleBitmap failed")
            .ThrowAsJavaScriptException();
        return env.Null();
    }

    HGDIOBJ hOld = SelectObject(hdcMem, hBitmap);

    if (!BitBlt(hdcMem, 0, 0, width, height, hdcScreen, srcX, srcY, SRCCOPY)) {
        SelectObject(hdcMem, hOld);
        DeleteObject(hBitmap);
        DeleteDC(hdcMem);
        ReleaseDC(NULL, hdcScreen);
        Napi::Error::New(env, "BitBlt failed")
            .ThrowAsJavaScriptException();
        return env.Null();
    }

    BITMAPINFOHEADER bi = {};
    bi.biSize = sizeof(BITMAPINFOHEADER);
    bi.biWidth = width;
    bi.biHeight = -height;
    bi.biPlanes = 1;
    bi.biBitCount = 32;
    bi.biCompression = BI_RGB;

    size_t dataSize = (size_t)width * height * 4;
    auto buffer = Napi::Buffer<uint8_t>::New(env, dataSize);

    // GetDIBits returns the number of scan lines copied, or 0 on failure.
    // On failure the buffer contents are undefined — treat as hard error.
    int linesCopied = GetDIBits(hdcMem, hBitmap, 0, height, buffer.Data(),
                                (BITMAPINFO*)&bi, DIB_RGB_COLORS);
    if (linesCopied == 0) {
        SelectObject(hdcMem, hOld);
        DeleteObject(hBitmap);
        DeleteDC(hdcMem);
        ReleaseDC(NULL, hdcScreen);
        Napi::Error::New(env, "GetDIBits failed")
            .ThrowAsJavaScriptException();
        return env.Null();
    }

    // BGRA -> RGBA, force alpha to opaque.
    uint8_t* data = buffer.Data();
    for (size_t i = 0; i < dataSize; i += 4) {
        uint8_t tmp = data[i];
        data[i]     = data[i + 2];
        data[i + 2] = tmp;
        data[i + 3] = 255;
    }

    SelectObject(hdcMem, hOld);
    DeleteObject(hBitmap);
    DeleteDC(hdcMem);
    ReleaseDC(NULL, hdcScreen);

    Napi::Object result = Napi::Object::New(env);
    result.Set("data",   buffer);
    result.Set("width",  Napi::Number::New(env, width));
    result.Set("height", Napi::Number::New(env, height));
    return result;
}

Napi::Value CaptureDesktop(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    int width  = GetSystemMetrics(SM_CXSCREEN);
    int height = GetSystemMetrics(SM_CYSCREEN);
    return CaptureRegion(env, 0, 0, width, height);
}

Napi::Value CaptureScreen(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (info.Length() == 0 || info[0].IsUndefined() || info[0].IsNull()) {
        int w = GetSystemMetrics(SM_CXSCREEN);
        int h = GetSystemMetrics(SM_CYSCREEN);
        return CaptureRegion(env, 0, 0, w, h);
    }

    if (info[0].IsString()) {
        std::string target = info[0].As<Napi::String>().Utf8Value();
        if (target == "primary") {
            int w = GetSystemMetrics(SM_CXSCREEN);
            int h = GetSystemMetrics(SM_CYSCREEN);
            return CaptureRegion(env, 0, 0, w, h);
        }
        if (target == "all") {
            int x = GetSystemMetrics(SM_XVIRTUALSCREEN);
            int y = GetSystemMetrics(SM_YVIRTUALSCREEN);
            int w = GetSystemMetrics(SM_CXVIRTUALSCREEN);
            int h = GetSystemMetrics(SM_CYVIRTUALSCREEN);
            return CaptureRegion(env, x, y, w, h);
        }
        Napi::TypeError::New(env,
            "Invalid target string: expected 'primary' or 'all'")
            .ThrowAsJavaScriptException();
        return env.Null();
    }

    if (info[0].IsNumber()) {
        int idx = info[0].As<Napi::Number>().Int32Value();
        auto monitors = EnumerateMonitors();
        if (idx < 0 || idx >= static_cast<int>(monitors.size())) {
            Napi::RangeError::New(env,
                "Monitor index " + std::to_string(idx) +
                " out of range (have " + std::to_string(monitors.size()) +
                " monitor(s))")
                .ThrowAsJavaScriptException();
            return env.Null();
        }
        const RECT& r = monitors[idx];
        return CaptureRegion(env, r.left, r.top,
                             r.right - r.left, r.bottom - r.top);
    }

    Napi::TypeError::New(env,
        "Expected string ('primary'|'all') or number (monitor index)")
        .ThrowAsJavaScriptException();
    return env.Null();
}

Napi::Value CaptureWindow(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (info.Length() < 1 || !info[0].IsNumber()) {
        Napi::TypeError::New(env, "Expected 1 argument: handle")
            .ThrowAsJavaScriptException();
        return env.Null();
    }

    int64_t handleValue = info[0].As<Napi::Number>().Int64Value();
    HWND hwnd = reinterpret_cast<HWND>(handleValue);

    if (!IsWindow(hwnd)) {
        Napi::Error::New(env, "Invalid window handle")
            .ThrowAsJavaScriptException();
        return env.Null();
    }

    RECT rect;
    if (!GetWindowRect(hwnd, &rect)) {
        Napi::Error::New(env, "GetWindowRect failed")
            .ThrowAsJavaScriptException();
        return env.Null();
    }

    int width  = rect.right - rect.left;
    int height = rect.bottom - rect.top;

    if (width <= 0 || height <= 0) {
        Napi::Error::New(env, "Window has invalid dimensions")
            .ThrowAsJavaScriptException();
        return env.Null();
    }

    HDC hdcWindow = GetWindowDC(hwnd);
    if (!hdcWindow) {
        Napi::Error::New(env, "GetWindowDC failed")
            .ThrowAsJavaScriptException();
        return env.Null();
    }

    HDC hdcMem = CreateCompatibleDC(hdcWindow);
    if (!hdcMem) {
        ReleaseDC(hwnd, hdcWindow);
        Napi::Error::New(env, "CreateCompatibleDC failed")
            .ThrowAsJavaScriptException();
        return env.Null();
    }

    HBITMAP hBitmap = CreateCompatibleBitmap(hdcWindow, width, height);
    if (!hBitmap) {
        DeleteDC(hdcMem);
        ReleaseDC(hwnd, hdcWindow);
        Napi::Error::New(env, "CreateCompatibleBitmap failed")
            .ThrowAsJavaScriptException();
        return env.Null();
    }

    HGDIOBJ hOld = SelectObject(hdcMem, hBitmap);

    // PrintWindow handles occluded windows (Win 8.1+ with PW_RENDERFULLCONTENT).
    // Fall back to BitBlt if it fails. If BOTH fail, no pixels were transferred
    // and we must not silently return a blank buffer.
    BOOL captured = PrintWindow(hwnd, hdcMem, PW_RENDERFULLCONTENT);
    if (!captured) {
        captured = BitBlt(hdcMem, 0, 0, width, height, hdcWindow, 0, 0, SRCCOPY);
    }
    if (!captured) {
        SelectObject(hdcMem, hOld);
        DeleteObject(hBitmap);
        DeleteDC(hdcMem);
        ReleaseDC(hwnd, hdcWindow);
        Napi::Error::New(env, "Both PrintWindow and BitBlt failed")
            .ThrowAsJavaScriptException();
        return env.Null();
    }

    BITMAPINFOHEADER bi = {};
    bi.biSize = sizeof(BITMAPINFOHEADER);
    bi.biWidth = width;
    bi.biHeight = -height;
    bi.biPlanes = 1;
    bi.biBitCount = 32;
    bi.biCompression = BI_RGB;

    size_t dataSize = (size_t)width * height * 4;
    auto buffer = Napi::Buffer<uint8_t>::New(env, dataSize);

    int linesCopied = GetDIBits(hdcMem, hBitmap, 0, height, buffer.Data(),
                                (BITMAPINFO*)&bi, DIB_RGB_COLORS);
    if (linesCopied == 0) {
        SelectObject(hdcMem, hOld);
        DeleteObject(hBitmap);
        DeleteDC(hdcMem);
        ReleaseDC(hwnd, hdcWindow);
        Napi::Error::New(env, "GetDIBits failed")
            .ThrowAsJavaScriptException();
        return env.Null();
    }

    uint8_t* data = buffer.Data();
    for (size_t i = 0; i < dataSize; i += 4) {
        uint8_t tmp = data[i];
        data[i]     = data[i + 2];
        data[i + 2] = tmp;
        data[i + 3] = 255;
    }

    SelectObject(hdcMem, hOld);
    DeleteObject(hBitmap);
    DeleteDC(hdcMem);
    ReleaseDC(hwnd, hdcWindow);

    Napi::Object result = Napi::Object::New(env);
    result.Set("data", buffer);
    result.Set("width", Napi::Number::New(env, width));
    result.Set("height", Napi::Number::New(env, height));

    return result;
}

Napi::Value WakeDesktop(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    SetThreadExecutionState(ES_SYSTEM_REQUIRED | ES_DISPLAY_REQUIRED);

    INPUT inputs[2] = {};

    inputs[0].type       = INPUT_MOUSE;
    inputs[0].mi.dx      = 1;
    inputs[0].mi.dy      = 1;
    inputs[0].mi.dwFlags = MOUSEEVENTF_MOVE;

    inputs[1].type       = INPUT_MOUSE;
    inputs[1].mi.dx      = -1;
    inputs[1].mi.dy      = -1;
    inputs[1].mi.dwFlags = MOUSEEVENTF_MOVE;

    UINT sent = SendInput(2, inputs, sizeof(INPUT));

    return Napi::Boolean::New(env, sent == 2);
}

// -----------------------------------------------------------------------------
// Mouse primitives (spec §8)
// -----------------------------------------------------------------------------

static void NormalizeToVirtualDesk(int x, int y, LONG* outDx, LONG* outDy) {
    int vx = GetSystemMetrics(SM_XVIRTUALSCREEN);
    int vy = GetSystemMetrics(SM_YVIRTUALSCREEN);
    int vw = GetSystemMetrics(SM_CXVIRTUALSCREEN) - 1;
    int vh = GetSystemMetrics(SM_CYVIRTUALSCREEN) - 1;

    *outDx = MulDiv(x - vx, 65535, vw > 0 ? vw : 1);
    *outDy = MulDiv(y - vy, 65535, vh > 0 ? vh : 1);
}

Napi::Value SetCursorPosition(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (info.Length() < 2 || !info[0].IsNumber() || !info[1].IsNumber()) {
        Napi::TypeError::New(env, "Expected 2 numbers: x, y")
            .ThrowAsJavaScriptException();
        return env.Null();
    }

    int x = info[0].As<Napi::Number>().Int32Value();
    int y = info[1].As<Napi::Number>().Int32Value();

    LONG dx, dy;
    NormalizeToVirtualDesk(x, y, &dx, &dy);

    INPUT in = {};
    in.type       = INPUT_MOUSE;
    in.mi.dx      = dx;
    in.mi.dy      = dy;
    in.mi.dwFlags = MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_VIRTUALDESK;

    UINT sent = SendInput(1, &in, sizeof(INPUT));
    return Napi::Boolean::New(env, sent == 1);
}

Napi::Value GetCursorPosition(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    POINT pt;
    if (!GetCursorPos(&pt)) {
        Napi::Error::New(env, "GetCursorPos failed").ThrowAsJavaScriptException();
        return env.Null();
    }

    Napi::Object result = Napi::Object::New(env);
    result.Set("x", Napi::Number::New(env, pt.x));
    result.Set("y", Napi::Number::New(env, pt.y));
    return result;
}

Napi::Value MouseButton(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (info.Length() < 2 || !info[0].IsString() || !info[1].IsString()) {
        Napi::TypeError::New(env, "Expected 2 strings: button, direction")
            .ThrowAsJavaScriptException();
        return env.Null();
    }

    std::string button    = info[0].As<Napi::String>().Utf8Value();
    std::string direction = info[1].As<Napi::String>().Utf8Value();

    DWORD flag = 0;
    if (button == "left") {
        if (direction == "down")      flag = MOUSEEVENTF_LEFTDOWN;
        else if (direction == "up")   flag = MOUSEEVENTF_LEFTUP;
    } else if (button == "right") {
        if (direction == "down")      flag = MOUSEEVENTF_RIGHTDOWN;
        else if (direction == "up")   flag = MOUSEEVENTF_RIGHTUP;
    } else if (button == "middle") {
        if (direction == "down")      flag = MOUSEEVENTF_MIDDLEDOWN;
        else if (direction == "up")   flag = MOUSEEVENTF_MIDDLEUP;
    }

    if (flag == 0) {
        Napi::TypeError::New(env,
            "Invalid button ('left'|'right'|'middle') or direction ('down'|'up')")
            .ThrowAsJavaScriptException();
        return env.Null();
    }

    INPUT in = {};
    in.type       = INPUT_MOUSE;
    in.mi.dwFlags = flag;

    UINT sent = SendInput(1, &in, sizeof(INPUT));
    return Napi::Boolean::New(env, sent == 1);
}

Napi::Value MouseWheel(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (info.Length() < 1 || !info[0].IsNumber()) {
        Napi::TypeError::New(env, "Number expected: amount (detents, +up / -down)")
            .ThrowAsJavaScriptException();
        return env.Null();
    }

    int amount = info[0].As<Napi::Number>().Int32Value();

    INPUT in = {};
    in.type       = INPUT_MOUSE;
    in.mi.dwFlags = MOUSEEVENTF_WHEEL;
    in.mi.mouseData = static_cast<DWORD>(amount * WHEEL_DELTA);

    UINT sent = SendInput(1, &in, sizeof(INPUT));
    return Napi::Boolean::New(env, sent == 1);
}

// -----------------------------------------------------------------------------
// Keyboard primitives (spec §8, §12)
// -----------------------------------------------------------------------------

struct KeyMapping {
    WORD vk;
    bool extended;
};

static const std::unordered_map<std::string, KeyMapping>& GetKeyMap() {
    static const std::unordered_map<std::string, KeyMapping> map = {
        // Letters
        {"a", {'A', false}}, {"b", {'B', false}}, {"c", {'C', false}},
        {"d", {'D', false}}, {"e", {'E', false}}, {"f", {'F', false}},
        {"g", {'G', false}}, {"h", {'H', false}}, {"i", {'I', false}},
        {"j", {'J', false}}, {"k", {'K', false}}, {"l", {'L', false}},
        {"m", {'M', false}}, {"n", {'N', false}}, {"o", {'O', false}},
        {"p", {'P', false}}, {"q", {'Q', false}}, {"r", {'R', false}},
        {"s", {'S', false}}, {"t", {'T', false}}, {"u", {'U', false}},
        {"v", {'V', false}}, {"w", {'W', false}}, {"x", {'X', false}},
        {"y", {'Y', false}}, {"z", {'Z', false}},

        // Digits
        {"0", {'0', false}}, {"1", {'1', false}}, {"2", {'2', false}},
        {"3", {'3', false}}, {"4", {'4', false}}, {"5", {'5', false}},
        {"6", {'6', false}}, {"7", {'7', false}}, {"8", {'8', false}},
        {"9", {'9', false}},

        // Function keys
        {"f1",  {VK_F1,  false}}, {"f2",  {VK_F2,  false}},
        {"f3",  {VK_F3,  false}}, {"f4",  {VK_F4,  false}},
        {"f5",  {VK_F5,  false}}, {"f6",  {VK_F6,  false}},
        {"f7",  {VK_F7,  false}}, {"f8",  {VK_F8,  false}},
        {"f9",  {VK_F9,  false}}, {"f10", {VK_F10, false}},
        {"f11", {VK_F11, false}}, {"f12", {VK_F12, false}},
        {"f13", {VK_F13, false}}, {"f14", {VK_F14, false}},
        {"f15", {VK_F15, false}}, {"f16", {VK_F16, false}},
        {"f17", {VK_F17, false}}, {"f18", {VK_F18, false}},
        {"f19", {VK_F19, false}}, {"f20", {VK_F20, false}},
        {"f21", {VK_F21, false}}, {"f22", {VK_F22, false}},
        {"f23", {VK_F23, false}}, {"f24", {VK_F24, false}},

        // Modifiers
        {"control",      {VK_LCONTROL, false}},
        {"leftControl",  {VK_LCONTROL, false}},
        {"rightControl", {VK_RCONTROL, true }},
        {"alt",          {VK_LMENU,    false}},
        {"leftAlt",      {VK_LMENU,    false}},
        {"rightAlt",     {VK_RMENU,    true }},
        {"shift",        {VK_LSHIFT,   false}},
        {"leftShift",    {VK_LSHIFT,   false}},
        {"rightShift",   {VK_RSHIFT,   false}},
        {"meta",         {VK_LWIN,     true }},
        {"leftMeta",     {VK_LWIN,     true }},
        {"rightMeta",    {VK_RWIN,     true }},

        // Navigation
        {"up",       {VK_UP,     true}},
        {"down",     {VK_DOWN,   true}},
        {"left",     {VK_LEFT,   true}},
        {"right",    {VK_RIGHT,  true}},
        {"home",     {VK_HOME,   true}},
        {"end",      {VK_END,    true}},
        {"pageUp",   {VK_PRIOR,  true}},
        {"pageDown", {VK_NEXT,   true}},
        {"insert",   {VK_INSERT, true}},
        {"delete",   {VK_DELETE, true}},

        // Editing / whitespace
        {"enter",     {VK_RETURN, false}},
        {"tab",       {VK_TAB,    false}},
        {"backspace", {VK_BACK,   false}},
        {"escape",    {VK_ESCAPE, false}},
        {"space",     {VK_SPACE,  false}},

        // Numpad
        {"num0", {VK_NUMPAD0, false}}, {"num1", {VK_NUMPAD1, false}},
        {"num2", {VK_NUMPAD2, false}}, {"num3", {VK_NUMPAD3, false}},
        {"num4", {VK_NUMPAD4, false}}, {"num5", {VK_NUMPAD5, false}},
        {"num6", {VK_NUMPAD6, false}}, {"num7", {VK_NUMPAD7, false}},
        {"num8", {VK_NUMPAD8, false}}, {"num9", {VK_NUMPAD9, false}},
        {"numAdd",      {VK_ADD,      false}},
        {"numSubtract", {VK_SUBTRACT, false}},
        {"numMultiply", {VK_MULTIPLY, false}},
        {"numDivide",   {VK_DIVIDE,   true }},
        {"numDecimal",  {VK_DECIMAL,  false}},
        {"numEnter",    {VK_RETURN,   true }},

        // Punctuation
        {"backtick",     {VK_OEM_3,      false}},
        {"minus",        {VK_OEM_MINUS,  false}},
        {"equal",        {VK_OEM_PLUS,   false}},
        {"leftBracket",  {VK_OEM_4,      false}},
        {"rightBracket", {VK_OEM_6,      false}},
        {"backslash",    {VK_OEM_5,      false}},
        {"semicolon",    {VK_OEM_1,      false}},
        {"quote",        {VK_OEM_7,      false}},
        {"comma",        {VK_OEM_COMMA,  false}},
        {"period",       {VK_OEM_PERIOD, false}},
        {"slash",        {VK_OEM_2,      false}},
    };
    return map;
}

static Napi::Value SendKeyEvent(const Napi::CallbackInfo& info, bool keyup) {
    Napi::Env env = info.Env();

    if (info.Length() < 1 || !info[0].IsString()) {
        Napi::TypeError::New(env, "Expected 1 string argument: key name")
            .ThrowAsJavaScriptException();
        return env.Null();
    }

    std::string name = info[0].As<Napi::String>().Utf8Value();
    const auto& map = GetKeyMap();
    auto it = map.find(name);
    if (it == map.end()) {
        Napi::TypeError::New(env, "Unknown key name: " + name)
            .ThrowAsJavaScriptException();
        return env.Null();
    }

    INPUT in = {};
    in.type = INPUT_KEYBOARD;
    in.ki.wVk = it->second.vk;
    in.ki.dwFlags =
        (keyup             ? KEYEVENTF_KEYUP       : 0) |
        (it->second.extended ? KEYEVENTF_EXTENDEDKEY : 0);

    UINT sent = SendInput(1, &in, sizeof(INPUT));
    return Napi::Boolean::New(env, sent == 1);
}

Napi::Value KeyDown(const Napi::CallbackInfo& info) { return SendKeyEvent(info, false); }
Napi::Value KeyUp  (const Napi::CallbackInfo& info) { return SendKeyEvent(info, true);  }

Napi::Value TypeChar(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (info.Length() < 1 || !info[0].IsNumber()) {
        Napi::TypeError::New(env, "Expected 1 number argument: codepoint")
            .ThrowAsJavaScriptException();
        return env.Null();
    }

    uint32_t cp = info[0].As<Napi::Number>().Uint32Value();

    if (cp > 0x10FFFF || (cp >= 0xD800 && cp <= 0xDFFF)) {
        Napi::RangeError::New(env, "Codepoint out of range or lone surrogate")
            .ThrowAsJavaScriptException();
        return env.Null();
    }

    if (cp < 0x10000) {
        INPUT inputs[2] = {};
        inputs[0].type       = INPUT_KEYBOARD;
        inputs[0].ki.wScan   = static_cast<WORD>(cp);
        inputs[0].ki.dwFlags = KEYEVENTF_UNICODE;

        inputs[1].type       = INPUT_KEYBOARD;
        inputs[1].ki.wScan   = static_cast<WORD>(cp);
        inputs[1].ki.dwFlags = KEYEVENTF_UNICODE | KEYEVENTF_KEYUP;

        UINT sent = SendInput(2, inputs, sizeof(INPUT));
        return Napi::Boolean::New(env, sent == 2);
    }

    uint32_t adjusted = cp - 0x10000;
    WORD high = static_cast<WORD>(0xD800 | (adjusted >> 10));
    WORD low  = static_cast<WORD>(0xDC00 | (adjusted & 0x3FF));

    INPUT inputs[4] = {};
    inputs[0].type       = INPUT_KEYBOARD;
    inputs[0].ki.wScan   = high;
    inputs[0].ki.dwFlags = KEYEVENTF_UNICODE;

    inputs[1].type       = INPUT_KEYBOARD;
    inputs[1].ki.wScan   = low;
    inputs[1].ki.dwFlags = KEYEVENTF_UNICODE;

    inputs[2].type       = INPUT_KEYBOARD;
    inputs[2].ki.wScan   = high;
    inputs[2].ki.dwFlags = KEYEVENTF_UNICODE | KEYEVENTF_KEYUP;

    inputs[3].type       = INPUT_KEYBOARD;
    inputs[3].ki.wScan   = low;
    inputs[3].ki.dwFlags = KEYEVENTF_UNICODE | KEYEVENTF_KEYUP;

    UINT sent = SendInput(4, inputs, sizeof(INPUT));
    return Napi::Boolean::New(env, sent == 4);
}

Napi::Value ReleaseAllModifiers(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    struct Mod { WORD vk; bool extended; };
    static const Mod mods[] = {
        {VK_LSHIFT,   false},
        {VK_RSHIFT,   false},
        {VK_LCONTROL, false},
        {VK_RCONTROL, true },
        {VK_LMENU,    false},
        {VK_RMENU,    true },
        {VK_LWIN,     true },
        {VK_RWIN,     true },
    };

    INPUT inputs[8] = {};
    for (int i = 0; i < 8; i++) {
        inputs[i].type       = INPUT_KEYBOARD;
        inputs[i].ki.wVk     = mods[i].vk;
        inputs[i].ki.dwFlags =
            KEYEVENTF_KEYUP |
            (mods[i].extended ? KEYEVENTF_EXTENDEDKEY : 0);
    }

    UINT sent = SendInput(8, inputs, sizeof(INPUT));
    return Napi::Boolean::New(env, sent == 8);
}

// -----------------------------------------------------------------------------
// Clipboard primitives (spec §8)
// -----------------------------------------------------------------------------

static bool OpenClipboardWithRetry() {
    for (int attempts = 0; attempts < 10; attempts++) {
        if (OpenClipboard(nullptr)) return true;
        Sleep(10);
    }
    return false;
}

Napi::Value ClipboardSetText(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (info.Length() < 1 || !info[0].IsString()) {
        Napi::TypeError::New(env, "Expected 1 string argument").ThrowAsJavaScriptException();
        return env.Null();
    }

    std::string utf8 = info[0].As<Napi::String>().Utf8Value();

    int wideLen = MultiByteToWideChar(CP_UTF8, 0, utf8.c_str(), -1, nullptr, 0);
    if (wideLen <= 0) return Napi::Boolean::New(env, false);

    HGLOBAL hMem = GlobalAlloc(GMEM_MOVEABLE, wideLen * sizeof(wchar_t));
    if (!hMem) return Napi::Boolean::New(env, false);

    wchar_t* dst = static_cast<wchar_t*>(GlobalLock(hMem));
    if (!dst) {
        GlobalFree(hMem);
        return Napi::Boolean::New(env, false);
    }

    MultiByteToWideChar(CP_UTF8, 0, utf8.c_str(), -1, dst, wideLen);
    GlobalUnlock(hMem);

    if (!OpenClipboardWithRetry()) {
        GlobalFree(hMem);
        return Napi::Boolean::New(env, false);
    }

    EmptyClipboard();
    HANDLE set = SetClipboardData(CF_UNICODETEXT, hMem);
    CloseClipboard();

    if (!set) {
        GlobalFree(hMem);
        return Napi::Boolean::New(env, false);
    }

    return Napi::Boolean::New(env, true);
}

Napi::Value ClipboardGetText(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (!OpenClipboardWithRetry()) {
        return Napi::String::New(env, "");
    }

    HANDLE hData = GetClipboardData(CF_UNICODETEXT);
    if (!hData) {
        CloseClipboard();
        return Napi::String::New(env, "");
    }

    wchar_t* wide = static_cast<wchar_t*>(GlobalLock(hData));
    if (!wide) {
        CloseClipboard();
        return Napi::String::New(env, "");
    }

    int wideLen = static_cast<int>(wcslen(wide));
    std::string utf8 = WideToUtf8(wide, wideLen);

    GlobalUnlock(hData);
    CloseClipboard();

    return Napi::String::New(env, utf8);
}

// -----------------------------------------------------------------------------
// Init
// -----------------------------------------------------------------------------

Napi::Object Init(Napi::Env env, Napi::Object exports) {
    InitDpiAwareness();

    // Windows & screen
    exports["getWindows"]          = Napi::Function::New(env, GetWindows);
    exports["focusWindow"]         = Napi::Function::New(env, FocusWindow);
    exports["focusWindowByHandle"] = Napi::Function::New(env, FocusWindowByHandle);
    exports["getActiveWindow"]     = Napi::Function::New(env, GetActiveWindowInfo);
    exports["closeWindow"]         = Napi::Function::New(env, CloseWindowEx);
    exports["moveWindow"]          = Napi::Function::New(env, MoveWindowEx);
    exports["resizeWindow"]        = Napi::Function::New(env, ResizeWindow);
    exports["captureDesktop"]      = Napi::Function::New(env, CaptureDesktop);
    exports["captureScreen"]       = Napi::Function::New(env, CaptureScreen);
    exports["captureWindow"]       = Napi::Function::New(env, CaptureWindow);
    exports["wakeDesktop"]         = Napi::Function::New(env, WakeDesktop);

    // Mouse primitives
    exports["setCursorPosition"]   = Napi::Function::New(env, SetCursorPosition);
    exports["getCursorPosition"]   = Napi::Function::New(env, GetCursorPosition);
    exports["mouseButton"]         = Napi::Function::New(env, MouseButton);
    exports["mouseWheel"]          = Napi::Function::New(env, MouseWheel);

    // Keyboard primitives
    exports["keyDown"]             = Napi::Function::New(env, KeyDown);
    exports["keyUp"]               = Napi::Function::New(env, KeyUp);
    exports["typeChar"]            = Napi::Function::New(env, TypeChar);
    exports["releaseAllModifiers"] = Napi::Function::New(env, ReleaseAllModifiers);

    // Clipboard primitives
    exports["clipboardSetText"]    = Napi::Function::New(env, ClipboardSetText);
    exports["clipboardGetText"]    = Napi::Function::New(env, ClipboardGetText);

    return exports;
}

NODE_API_MODULE(desktop_window_manager, Init)
