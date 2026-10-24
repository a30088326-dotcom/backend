@echo off
cd /d "%~dp0"
set "HR_CHECK_NODE=node"
where node >nul 2>&1
if errorlevel 1 (
    if exist "D:\New Folder\nod nod\node.exe" (
        set "HR_CHECK_NODE=D:\New Folder\nod nod\node.exe"
    ) else (
        echo Node.js was not found.
        pause
        exit /b 1
    )
)
"%HR_CHECK_NODE%" "%~dp0check-local.cjs"
if errorlevel 1 (
    echo Some checks failed. Review the messages above.
) else (
    echo All local HR checks passed.
)
pause
