@echo off
setlocal enabledelayedexpansion

echo ======================================================
echo    TorBox Streamer - Native Host Installer (Windows)
echo ======================================================
echo.

set "TARGET_DIR=%APPDATA%\TorBoxStreamer"
if not exist "%TARGET_DIR%" mkdir "%TARGET_DIR%"

set "HOST_EXE="
if exist "%~dp0torbox-host.exe" (
    set "HOST_EXE=%~dp0torbox-host.exe"
) else if exist "%~dp0..\dist\torbox-host.exe" (
    set "HOST_EXE=%~dp0..\dist\torbox-host.exe"
) else if exist "%~dp0native_host.exe" (
    set "HOST_EXE=%~dp0native_host.exe"
)

if defined HOST_EXE (
    echo [OK] Found standalone host executable: !HOST_EXE!
    copy /Y "!HOST_EXE!" "%TARGET_DIR%\torbox-host.exe" >nul
    set "FINAL_EXEC=%TARGET_DIR%\torbox-host.exe"
) else if exist "%~dp0native_host.py" (
    echo [INFO] Standalone binary not found. Using Python script fallback...
    copy /Y "%~dp0native_host.py" "%TARGET_DIR%\native_host.py" >nul
    set "FINAL_EXEC=%TARGET_DIR%\native_host.py"
) else (
    echo [ERROR] Could not find torbox-host.exe or native_host.py in the current directory!
    echo Please make sure you extracted all files from the release archive.
    pause
    exit /b 1
)

:: Escape backslashes for JSON
set "ESCAPED_EXEC=%FINAL_EXEC:\=\\%"

set "GECKO_MANIFEST=%TARGET_DIR%\com.torbox_streamer.host.firefox.json"
set "CHROMIUM_MANIFEST=%TARGET_DIR%\com.torbox_streamer.host.chrome.json"

:: Write Gecko Manifest (Firefox, Waterfox, Zen)
(
    echo {
    echo   "name": "com.torbox_streamer.host",
    echo   "description": "TorBox Streamer Native Messaging Host",
    echo   "path": "!ESCAPED_EXEC!",
    echo   "type": "stdio",
    echo   "allowed_extensions": [
    echo     "torbox-streamer@flamprakis.com"
    echo   ]
    echo }
) > "%GECKO_MANIFEST%"

:: Write Chromium Manifest (Chrome, Brave, Edge)
(
    echo {
    echo   "name": "com.torbox_streamer.host",
    echo   "description": "TorBox Streamer Native Messaging Host",
    echo   "path": "!ESCAPED_EXEC!",
    echo   "type": "stdio",
    echo   "allowed_origins": [
    echo     "chrome-extension://*/"
    echo   ]
    echo }
) > "%CHROMIUM_MANIFEST%"

echo [OK] Created native host manifests in %TARGET_DIR%

:: Register Registry Keys for Firefox & Chrome families
set "REG_PATH_MOZILLA=HKCU\Software\Mozilla\NativeMessagingHosts\com.torbox_streamer.host"
REG ADD "%REG_PATH_MOZILLA%" /ve /t REG_SZ /d "%GECKO_MANIFEST%" /f >nul 2>&1

set "REG_PATH_CHROME=HKCU\Software\Google\Chrome\NativeMessagingHosts\com.torbox_streamer.host"
REG ADD "%REG_PATH_CHROME%" /ve /t REG_SZ /d "%CHROMIUM_MANIFEST%" /f >nul 2>&1

echo.
echo ======================================================
echo  [SUCCESS] Native Host registered successfully!
echo  You can now launch MPV / VLC directly from TorBox Streamer.
echo ======================================================
echo.
pause
