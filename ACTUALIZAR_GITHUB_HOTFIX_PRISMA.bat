@echo off
setlocal
cd /d "%~dp0"
echo ============================================================
echo KREDI+ BACKEND MOBILE 2.0.1 - HOTFIX PRISMA / RAILWAY
echo ============================================================

git status
if errorlevel 1 goto :error

git add prisma/schema.prisma package.json HOTFIX_PRISMA_RAILWAY_2.0.1.md VALIDAR_BACKEND_2.0.bat
if errorlevel 1 goto :error

git commit -m "Fix Prisma schema for Railway - Backend 2.0.1"
if errorlevel 1 echo No se creo commit nuevo. Si no hay cambios, puede ser normal.

git push origin main
if errorlevel 1 goto :error

echo.
echo Push completado. Railway debe iniciar un nuevo deploy automaticamente.
pause
exit /b 0

:error
echo.
echo ERROR. Revisa el mensaje anterior.
pause
exit /b 1
