#!/bin/bash
echo "========================================"
echo "Claude Pro Extension Deployment"
echo "========================================"
echo ""

echo "[1/4] Installing vsce if needed..."
if ! npm list -g @vscode/vsce &>/dev/null; then
    echo "Installing @vscode/vsce globally..."
    npm install -g @vscode/vsce
else
    echo "@vscode/vsce already installed"
fi
echo ""

echo "[2/4] Compiling TypeScript..."
npm run compile
if [ $? -ne 0 ]; then
    echo "ERROR: Compilation failed!"
    exit 1
fi
echo ""

echo "[3/4] Packaging extension..."
vsce package --allow-star-activation
if [ $? -ne 0 ]; then
    echo "ERROR: Packaging failed!"
    exit 1
fi
echo ""

echo "[4/4] Installing extension..."
for file in *.vsix; do
    echo "Installing $file..."
    code --install-extension "$file" --force
    if [ $? -ne 0 ]; then
        echo "ERROR: Installation failed!"
        exit 1
    fi
done
echo ""

echo "========================================"
echo "SUCCESS! Extension deployed!"
echo "========================================"
echo ""
echo "Please reload VS Code to use the extension."
echo "Press Ctrl+Shift+P and type 'Reload Window'"
echo ""
