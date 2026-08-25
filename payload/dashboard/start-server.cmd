@echo off
rem Startet den Dashboard-Server dieses Workspace dauerhaft-fensterlos.
rem Doppelklick genuegt. Fuer den Start bei jeder Anmeldung einmalig ausfuehren:
rem
rem   schtasks /create /tn keel-harness-dashboard /sc onlogon /f ^
rem     /tr "wscript.exe \"%~dp0start-server-hidden.vbs\""
rem
rem Entfernen:  schtasks /delete /tn keel-harness-dashboard /f
set WURZEL=%~dp0..
start "keel-harness-dashboard" /min node "%~dp0serve.js" --wurzel "%WURZEL%" --port 8766
