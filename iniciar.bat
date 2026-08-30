@echo off
cd /d "%~dp0"
echo Iniciando el servidor de Ale King...

set NODE_EXE=node
where node >nul 2>nul
if errorlevel 1 set NODE_EXE="C:\Program Files\nodejs\node.exe"

start "Servidor - Ale King" cmd /k %NODE_EXE% server.js
timeout /t 2 /nobreak >nul
start "" "http://localhost:3000"
