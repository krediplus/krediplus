@echo off
setlocal
cd /d "%~dp0"
chcp 65001 >nul

echo ============================================================
echo KREDI+ BACKEND MOBILE 2.0.3 - ACTUALIZAR GITHUB
echo ============================================================

git status
echo.
echo Se agregaran los cambios del hotfix 2.0.3.
git add .
if errorlevel 1 goto :error
git commit -m "Fix Railway dist main - Kredi+ Backend 2.0.3"
if errorlevel 1 (
  echo No se creo commit nuevo. Puede que ya estuviera confirmado.
)
git push origin main
if errorlevel 1 goto :error

echo.
echo [OK] Cambios enviados a GitHub. Railway debe redesplegar automaticamente.
pause
exit /b 0

:error
echo.
echo ERROR: revisa el mensaje anterior. No se uso --force.
pause
exit /b 1
