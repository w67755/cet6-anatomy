@echo off
chcp 65001 >nul
cd /d "%~dp0"
setlocal
set "PORT=7788"
set "NODE_EXE="

rem 1) Node on PATH
where node >nul 2>nul && set "NODE_EXE=node"
rem 2) Common install locations
if not defined NODE_EXE if exist "%LOCALAPPDATA%\Programs\nodejs\node.exe" set "NODE_EXE=%LOCALAPPDATA%\Programs\nodejs\node.exe"
if not defined NODE_EXE if exist "%ProgramFiles%\nodejs\node.exe" set "NODE_EXE=%ProgramFiles%\nodejs\node.exe"
if not defined NODE_EXE if exist "%ProgramFiles(x86)%\nodejs\node.exe" set "NODE_EXE=%ProgramFiles(x86)%\nodejs\node.exe"
rem 3) The Node that ships with DeepSeek Harness (convenient fallback)
if not defined NODE_EXE if exist "%USERPROFILE%\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe" set "NODE_EXE=%USERPROFILE%\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"
if not defined NODE_EXE if exist "D:\dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe" set "NODE_EXE=D:\dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"

if not defined NODE_EXE (
  echo.
  echo   [x] Node.js not found.
  echo       Install Node 18+ from https://nodejs.org , or edit this file
  echo       and set NODE_EXE to the full path of your node.exe
  echo.
  pause
  exit /b 1
)

echo   Starting with: %NODE_EXE%
"%NODE_EXE%" server.mjs

echo.
echo   Server stopped.
pause
