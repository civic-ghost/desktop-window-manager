#include <napi.h>
#include <windows.h>
#include <string>
#include <vector>
#include <regex>

struct WindowInfo {
    HWND handle;
    std::string title;
};

// Callback for EnumWindows
BOOL CALLBACK EnumWindowsProc(HWND hwnd, LPARAM lParam) {
    auto* windows = reinterpret_cast<std::vector<WindowInfo>*>(lParam);
    
    // Only include visible windows with titles
    if (IsWindowVisible(hwnd)) {
        int length = GetWindowTextLengthA(hwnd);
        if (length > 0) {
            char* buffer = new char[length + 1];
            GetWindowTextA(hwnd, buffer, length + 1);
            
            WindowInfo info;
            info.handle = hwnd;
            info.title = std::string(buffer);
            windows->push_back(info);
            
            delete[] buffer;
        }
    }
    
    return TRUE;
}

// Get all windows
Napi::Value GetWindows(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    std::vector<WindowInfo> windows;
    EnumWindows(EnumWindowsProc, reinterpret_cast<LPARAM>(&windows));
    
    Napi::Array result = Napi::Array::New(env, windows.size());
    
    for (size_t i = 0; i < windows.size(); i++) {
        Napi::Object obj = Napi::Object::New(env);
        obj.Set("handle", Napi::Number::New(env, reinterpret_cast<int64_t>(windows[i].handle)));
        obj.Set("title", Napi::String::New(env, windows[i].title));
        result[i] = obj;
    }
    
    return result;
}

// Focus a window by title (supports regex)
Napi::Value FocusWindow(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    if (info.Length() < 1 || !info[0].IsString()) {
        Napi::TypeError::New(env, "String expected").ThrowAsJavaScriptException();
        return env.Null();
    }
    
    std::string pattern = info[0].As<Napi::String>().Utf8Value();
    bool useRegex = (info.Length() > 1 && info[1].IsBoolean()) ? info[1].As<Napi::Boolean>().Value() : false;
    
    std::vector<WindowInfo> windows;
    EnumWindows(EnumWindowsProc, reinterpret_cast<LPARAM>(&windows));
    
    HWND targetWindow = nullptr;
    
    if (useRegex) {
        try {
            std::regex re(pattern, std::regex::icase);
            for (const auto& win : windows) {
                if (std::regex_search(win.title, re)) {
                    targetWindow = win.handle;
                    break;
                }
            }
        } catch (const std::regex_error&) {
            Napi::Error::New(env, "Invalid regex pattern").ThrowAsJavaScriptException();
            return env.Null();
        }
    } else {
        // Simple case-insensitive substring match
        std::string lowerPattern = pattern;
        std::transform(lowerPattern.begin(), lowerPattern.end(), lowerPattern.begin(), ::tolower);
        
        for (const auto& win : windows) {
            std::string lowerTitle = win.title;
            std::transform(lowerTitle.begin(), lowerTitle.end(), lowerTitle.begin(), ::tolower);
            
            if (lowerTitle.find(lowerPattern) != std::string::npos) {
                targetWindow = win.handle;
                break;
            }
        }
    }
    
    if (targetWindow) {
        // Restore if minimized
        if (IsIconic(targetWindow)) {
            ShowWindow(targetWindow, SW_RESTORE);
        }
        
        // Bring to foreground and set focus
        SetForegroundWindow(targetWindow);
        SetFocus(targetWindow);
        
        return Napi::Boolean::New(env, true);
    }
    
    return Napi::Boolean::New(env, false);
}

// Focus window by handle
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
    
    // Restore if minimized
    if (IsIconic(hwnd)) {
        ShowWindow(hwnd, SW_RESTORE);
    }
    
    // Bring to foreground and set focus
    SetForegroundWindow(hwnd);
    SetFocus(hwnd);
    
    return Napi::Boolean::New(env, true);
}

// Get active/focused window
Napi::Value GetActiveWindowInfo(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    HWND hwnd = ::GetForegroundWindow();
    
    if (!hwnd) {
        return env.Null();
    }
    
    int length = GetWindowTextLengthA(hwnd);
    std::string title;
    
    if (length > 0) {
        char* buffer = new char[length + 1];
        GetWindowTextA(hwnd, buffer, length + 1);
        title = std::string(buffer);
        delete[] buffer;
    }
    
    Napi::Object result = Napi::Object::New(env);
    result.Set("handle", Napi::Number::New(env, reinterpret_cast<int64_t>(hwnd)));
    result.Set("title", Napi::String::New(env, title));
    
    return result;
}

// Initialize the addon
Napi::Object Init(Napi::Env env, Napi::Object exports) {
    exports["getWindows"] = Napi::Function::New(env, GetWindows);
    exports["focusWindow"] = Napi::Function::New(env, FocusWindow);
    exports["focusWindowByHandle"] = Napi::Function::New(env, FocusWindowByHandle);
    exports["getActiveWindow"] = Napi::Function::New(env, GetActiveWindowInfo);
    
    return exports;
}

NODE_API_MODULE(desktop_window_manager, Init)
