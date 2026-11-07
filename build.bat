@echo off
title DarkX Launcher - build
cd /d "%~dp0"
call npm install
if errorlevel 1 goto fail
call npm test
if errorlevel 1 goto fail
call npm run dist
if errorlevel 1 goto fail
echo.
echo Done. Installer and portable build are in the dist folder.
pause
exit /b 0
:fail
echo.
echo Build failed - see the error above.
pause
exit /b 1
