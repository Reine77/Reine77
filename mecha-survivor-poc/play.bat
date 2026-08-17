@echo off
setlocal
cd /d "%~dp0"
set PORT=8080

where python >nul 2>nul
if %ERRORLEVEL%==0 set PYCMD=python
if not defined PYCMD (
    where python3 >nul 2>nul
    if %ERRORLEVEL%==0 set PYCMD=python3
)

if defined PYCMD (
    echo Starting local server with %PYCMD% on http://localhost:%PORT% ...
    start "Mecha Survivor Server" cmd /k "%PYCMD% -m http.server %PORT%"
    timeout /t 2 /nobreak >nul
    start "" http://localhost:%PORT%
    echo.
    echo Server is running in the other window titled "Mecha Survivor Server".
    echo Close that window when you're done playing to stop the server.
    echo.
    pause
    goto :eof
)

where npx >nul 2>nul
if %ERRORLEVEL%==0 (
    echo Python not found - trying Node.js instead...
    start "Mecha Survivor Server" cmd /k "npx --yes serve -l %PORT% ."
    timeout /t 3 /nobreak >nul
    start "" http://localhost:%PORT%
    echo.
    echo Server is running in the other window titled "Mecha Survivor Server".
    echo Close that window when you're done playing to stop the server.
    echo.
    pause
    goto :eof
)

echo Could not find Python or Node.js on this computer.
echo Install one of these, then double-click this file again:
echo.
echo   Python:  https://www.python.org/downloads/   (check "Add python.exe to PATH" during install)
echo   Node.js: https://nodejs.org/
echo.
pause
