@echo off
setlocal
cd /d "%~dp0"
if not exist "db\custom.db" (
  echo Base SQLite de demonstration introuvable : db\custom.db
  exit /b 1
)
set "GOCMD_DB_FILE=%~dp0db\custom.db"
set "GOCMD_REQUIRE_SQLITE_USERS=1"
rem Dérogation explicite, uniquement pour la base démo locale fournie.
set "GOCMD_ALLOW_DEMO_DB=1"
set "PORT=3001"
set "HOSTNAME=127.0.0.1"
echo MODE DEMONSTRATION LOCAL - NE PAS UTILISER EN PRODUCTION SODEPI
echo Demarrage GoCmd sur http://127.0.0.1:3001/login
call npm run start:checked
exit /b %errorlevel%
