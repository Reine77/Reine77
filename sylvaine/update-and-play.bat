@echo off
setlocal

rem Move to the folder this .bat file lives in, so it works no matter
rem where you double-click it from.
cd /d "%~dp0"

echo Pulling the latest build...
git pull origin claude/sylvaine-idle-rpg-evj2nk

if errorlevel 1 (
    echo.
    echo Git pull failed - see the error above.
    echo Common cause: you have local changes. If you never edit these
    echo files by hand, this shouldn't happen.
    pause
    exit /b 1
)

echo.
echo Opening the game...
start "" "index.html"
