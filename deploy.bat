@echo off
echo ========================================
echo Claude Pro Extension Deployment
echo ========================================
echo.

echo [1/4] Installing vsce if needed...
call npm list -g @vscode/vsce >nul 2>&1
if errorlevel 1 (
    echo Installing @vscode/vsce globally...
    call npm install -g @vscode/vsce
) else (
    echo @vscode/vsce already installed
)
echo.

echo [2/4] Compiling TypeScript...
call npm run compile
if errorlevel 1 (
    echo ERROR: Compilation failed!
    pause
    exit /b 1
)
echo.

echo [3/4] Packaging extension...
call vsce package --allow-star-activation
if errorlevel 1 (
    echo ERROR: Packaging failed!
    pause
    exit /b 1
)
echo.

echo [4/4] Installing extension...
for %%f in (*.vsix) do (
    echo Installing %%f...
    call code --install-extension "%%f" --force
    if errorlevel 1 (
        echo ERROR: Installation failed!
        pause
        exit /b 1
    )
)
echo.

echo ========================================
echo SUCCESS! Extension deployed!
echo ========================================
echo.
echo Please reload VS Code to use the extension.
echo Press Ctrl+Shift+P and type "Reload Window"
echo.
pause
