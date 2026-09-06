@echo off
setlocal
node "%~dp0..\.claude\package-context.js" --selbsttest
set "test_exit=%ERRORLEVEL%"
exit /b %test_exit%
