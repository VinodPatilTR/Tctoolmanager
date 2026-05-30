@echo off
REM Auto-start the TCTool SQL backend.
REM Adjust SQL_DATABASE / SQL_AUTH below if needed.

cd /d "%~dp0"

set SQL_SERVER=eu2-dev-taxcaddy-sqlsrv.database.windows.net
set SQL_DATABASE=TaxCaddyDev
set SQL_AUTH=default
set PORT=3000

REM Run hidden (no console window). Logs go to backend.log.
start "" /min cmd /c "node sql-server.js >> backend.log 2>&1"
