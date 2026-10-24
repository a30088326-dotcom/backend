@echo off
cd /d "%~dp0"
set "HR_NODE_EXE=node"
where node >nul 2>&1
if errorlevel 1 (
    if exist "D:\New Folder\nod nod\node.exe" (
        set "HR_NODE_EXE=D:\New Folder\nod nod\node.exe"
    ) else (
        echo Node.js was not found. Install Node.js or add it to PATH.
        pause
        exit /b 1
    )
)
"%HR_NODE_EXE%" "%~dp0start-local.cjs"
if errorlevel 1 (
    pause
    exit /b 1
)
start "" "http://localhost:5174"
