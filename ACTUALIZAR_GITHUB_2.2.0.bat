@echo off
setlocal
cd /d "%~dp0"
chcp 65001 >nul

echo ============================================================
echo KREDI+ BACKEND MOBILE 2.2.0 - ACTUALIZAR GITHUB
echo ============================================================

where git >nul 2>nul || (echo ERROR: Git no esta instalado o no esta en PATH.& pause & exit /b 1)

git status
if errorlevel 1 goto :error

git add -A
if errorlevel 1 goto :error

git commit -m "Kredi+ Backend Mobile 2.2.0 - Build 11"
if errorlevel 1 (
  echo.
  echo No se creo un commit nuevo. Puede que no existan cambios pendientes.
)

git push
if errorlevel 1 goto :error

echo.
echo ============================================================
echo ACTUALIZACION COMPLETADA

echo Railway podra desplegar Backend Mobile 2.2.0 desde el repositorio.
echo ============================================================
pause
exit /b 0

:error
echo.
echo ERROR: revisa el mensaje anterior antes de continuar.
pause
exit /b 1
