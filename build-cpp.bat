@echo off
REM Build script for Windows using cmake-js

echo.
echo Building with cmake-js...
call npx cmake-js compile
if errorlevel 1 (
    echo Build failed
    exit /b 1
)

echo.
echo Build complete!
echo The .node file has been copied to prebuilds/win32-x64/

echo.
echo Done!
