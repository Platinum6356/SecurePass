@echo off
setlocal
cd /d "%~dp0"
where py >nul 2>nul
if errorlevel 1 goto python
py -3 server.py
if errorlevel 1 pause
exit /b
:python
python server.py
if errorlevel 1 pause
