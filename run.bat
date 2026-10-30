@echo off
rem card-collection-factory: launcher for Windows (double-click).
rem Checks Node.js, installs what is missing (tools\setup.mjs), then starts the product.
rem Saved with CRLF line endings.
chcp 65001 >nul
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
    echo.
    echo   Не найден Node.js. Скачайте и установите его ^(версия LTS^): https://nodejs.org
    echo   Потом запустите этот файл снова.
    echo.
    pause
    exit /b 1
)

node tools\setup.mjs %*
set "RC=%ERRORLEVEL%"
rem When the editor exists, its start goes here, after a successful setup.
echo.
pause
exit /b %RC%
