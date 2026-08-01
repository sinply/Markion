@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul
title Markion - Release Build

echo ============================================
echo  Markion Release Build
echo ============================================
echo.

REM ---- locate Node.js (project requires >= 20) ----
set "NODE_EXE="
where node >nul 2>&1 && set "NODE_EXE=node"
if not defined NODE_EXE (
  if exist "D:\Program Files\nodejs\node.exe" set "NODE_EXE=D:\Program Files\nodejs\node.exe"
)
if not defined NODE_EXE (
  if exist "C:\Program Files\nodejs\node.exe" set "NODE_EXE=C:\Program Files\nodejs\node.exe"
)
if not defined NODE_EXE (
  echo [ERROR] Node.js not found. Install Node.js >= 20 first.
  pause & exit /b 1
)
set "PATH=%~dp0node_modules\.bin;%PATH%"

REM ---- locate Rust cargo ----
set "CARGO_EXE="
where cargo >nul 2>&1 && set "CARGO_EXE=cargo"
if not defined CARGO_EXE (
  if exist "%USERPROFILE%\.cargo\bin\cargo.exe" set "CARGO_EXE=%USERPROFILE%\.cargo\bin\cargo.exe"
)
if not defined CARGO_EXE (
  echo [ERROR] Rust toolchain not found. Install via rustup first.
  pause & exit /b 1
)
set "PATH=%USERPROFILE%\.cargo\bin;%PATH%"

echo [1/4] Installing frontend dependencies...
call npm install
if errorlevel 1 ( echo [ERROR] npm install failed & pause & exit /b 1 )

echo.
echo [2/4] Running TypeScript type check...
call npx tsc --noEmit
if errorlevel 1 ( echo [ERROR] TypeScript check failed & pause & exit /b 1 )

echo.
echo [3/4] Running frontend unit tests...
call npx vitest run
if errorlevel 1 ( echo [ERROR] Tests failed & pause & exit /b 1 )

echo.
echo [4/4] Building release executable...
call npm run tauri build
if errorlevel 1 ( echo [ERROR] Tauri build failed & pause & exit /b 1 )

echo.
echo ============================================
echo  Build successful!
echo  Executable: src-tauri\target\release\markion.exe
echo ============================================
if exist "src-tauri\target\release\markion.exe" (
  explorer "%~dp0src-tauri\target\release"
)
pause
