@echo off
chcp 65001 >nul
echo.
echo ============================================================
echo  PREVENT - Restablecer contraseña del usuario EASY
echo ============================================================
echo.
echo  Este comando solo debe ser ejecutado por SOFTEASY-WEB.
echo  Se le pedira la nueva contraseña dos veces.
echo  Minimo 8 caracteres.
echo.
echo ============================================================
echo.

set DATABASE_URL=postgresql+psycopg2://postgres:PreventPg2026Local1@127.0.0.1:5432/prevent_utf8
set FLASK_ENV=production

call .venv\Scripts\activate.bat

flask reset-easy-password

echo.
pause
