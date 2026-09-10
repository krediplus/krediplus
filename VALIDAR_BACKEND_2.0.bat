@echo off
setlocal
cd /d "%~dp0"
chcp 65001 >nul

echo ============================================================
echo KREDI+ BACKEND MOBILE 2.2.0 - VALIDACION COMPLETA
echo ============================================================

where node >nul 2>nul || (echo ERROR: Node.js no esta instalado.& pause & exit /b 1)
where npm >nul 2>nul || (echo ERROR: npm no esta disponible.& pause & exit /b 1)

call npm install
if errorlevel 1 goto :error
call npx prisma format
if errorlevel 1 goto :error
call npx prisma validate
if errorlevel 1 goto :error
call npx prisma generate
if errorlevel 1 goto :error
call npm run build
if errorlevel 1 goto :error

if not exist "dist\main.js" (
  echo ERROR: npm run build termino, pero no existe dist\main.js
  goto :error
)

echo.
echo ============================================================
echo VALIDACION CORRECTA
echo Prisma compila y NestJS genera dist\main.js correctamente.
echo ============================================================
pause
exit /b 0

:error
echo.
echo ============================================================
echo VALIDACION FALLIDA
echo Corrige el error anterior antes de subir a Railway.
echo ============================================================
pause
exit /b 1
