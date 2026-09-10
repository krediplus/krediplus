@echo off
setlocal
cd /d "%~dp0"
chcp 65001 >nul

echo ============================================================
echo   KREDI+ API 2.0 - SUBIR A RAILWAY (PROYECTO NUEVO)
echo ============================================================
echo.
where railway >nul 2>&1
if errorlevel 1 (
  echo No se encontro Railway CLI.
  echo Instala con: npm install -g @railway/cli
  echo Luego ejecuta este archivo nuevamente.
  pause
  exit /b 1
)
where node >nul 2>&1 || (echo Node.js no esta instalado.& pause & exit /b 1)

echo [1/4] Instalando dependencias y validando TypeScript...
call npm install
if errorlevel 1 goto :error
call npm run build
if errorlevel 1 goto :error

echo [2/4] Verificando sesion Railway...
railway whoami
if errorlevel 1 (
  echo Ejecutando login...
  railway login
  if errorlevel 1 goto :error
)

echo [3/4] ATENCION: enlaza ESTA carpeta a un PROYECTO NUEVO de Railway.
echo Si aun no esta enlazado, Railway te pedira seleccionar/crear el proyecto.
railway status >nul 2>&1 || railway link
if errorlevel 1 goto :error

echo [4/4] Subiendo backend 2.0...
railway up
if errorlevel 1 goto :error

echo.
echo [OK] Codigo enviado a Railway. Configura PostgreSQL, Redis, JWT_SECRET y revisa /api/v2/health.
pause
exit /b 0
:error
echo.
echo ERROR: no se pudo completar el proceso. La version legacy NO fue modificada.
pause
exit /b 1
