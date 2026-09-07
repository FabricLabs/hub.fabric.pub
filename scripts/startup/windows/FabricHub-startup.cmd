@echo off
REM Fabric Hub — start at login (Bitcoin, Fabric peer, Lightning).
REM Packaged layout: resources\startup\windows\  (exe is ..\..\..\FabricHub.exe)
setlocal
set "DIR=%~dp0"
set "EXE=%DIR%..\..\..\FabricHub.exe"
if exist "%EXE%" (
  start "" "%EXE%" --hidden %*
  exit /b 0
)
set "EXE=%LOCALAPPDATA%\Programs\Fabric Hub\FabricHub.exe"
if exist "%EXE%" (
  start "" "%EXE%" --hidden %*
  exit /b 0
)
echo Fabric Hub executable not found. Install the desktop app, or use tray: Run at startup.
exit /b 1
