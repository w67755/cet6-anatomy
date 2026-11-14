@echo off
chcp 65001 >nul
cd /d "%~dp0"
setlocal
set "NODE_EXE="

where node >nul 2>nul && set "NODE_EXE=node"
if not defined NODE_EXE if exist "%LOCALAPPDATA%\Programs\nodejs\node.exe" set "NODE_EXE=%LOCALAPPDATA%\Programs\nodejs\node.exe"
if not defined NODE_EXE if exist "%ProgramFiles%\nodejs\node.exe" set "NODE_EXE=%ProgramFiles%\nodejs\node.exe"
if not defined NODE_EXE if exist "%ProgramFiles(x86)%\nodejs\node.exe" set "NODE_EXE=%ProgramFiles(x86)%\nodejs\node.exe"
if not defined NODE_EXE if exist "%USERPROFILE%\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe" set "NODE_EXE=%USERPROFILE%\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"

if not defined NODE_EXE (
  echo   [x] Node.js not found. Install Node 18+ ^(https://nodejs.org^)
  pause
  exit /b 1
)

echo   Checking with: %NODE_EXE%
"%NODE_EXE%" --check server.mjs || (echo. & echo   [x] server.mjs 语法有问题 & pause & exit /b 1)
"%NODE_EXE%" --check public\app.js || (echo. & echo   [x] public\app.js 语法有问题 & pause & exit /b 1)
echo.
echo   [ok] 语法检查通过，可以 commit 了
pause
