@echo off
rem ---------------------------------------------------------------------------
rem  Dashboard-Server bei jeder Anmeldung starten -- EIN Doppelklick.
rem
rem  Doppelklick auf diese Datei      -> Autostart EIN
rem  autostart-einrichten.cmd  aus    -> Autostart AUS
rem
rem  WARUM NICHT schtasks [gemessen 27.08.2026]: "schtasks /create /sc onlogon"
rem  antwortet ohne Administratorrechte mit "Zugriff verweigert". Der
rem  Autostart-Ordner des Benutzers braucht keine erhoehten Rechte und tut
rem  dasselbe -- er startet, sobald du angemeldet bist.
rem ---------------------------------------------------------------------------
setlocal
set "START=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "ZIEL=%START%\keel-harness-dashboard.vbs"
set "QUELLE=%~dp0start-server-hidden.vbs"

if /i "%~1"=="aus" goto :entfernen

if not exist "%QUELLE%" (
  echo FEHLER: %QUELLE% fehlt -- ohne sie gibt es nichts zu starten.
  pause
  exit /b 1
)

> "%ZIEL%" echo ' Startet den Dashboard-Server der Werkbank bei jeder Anmeldung, ohne Fenster.
>>"%ZIEL%" echo ' Angelegt von dashboard/autostart-einrichten.cmd. Entfernen: dieselbe Datei
>>"%ZIEL%" echo ' mit dem Argument  aus  aufrufen, oder diese Datei hier loeschen.
>>"%ZIEL%" echo Dim schale
>>"%ZIEL%" echo Set schale = CreateObject("WScript.Shell")
>>"%ZIEL%" echo schale.Run "wscript.exe ""%QUELLE%""", 0, False

if not exist "%ZIEL%" (
  echo FEHLER: %ZIEL% wurde nicht angelegt.
  pause
  exit /b 1
)

echo Autostart EIN.
echo   Eintrag : %ZIEL%
echo   startet : %QUELLE%
echo   Adresse : http://127.0.0.1:8766/
echo.
echo Der Server laeuft ab der naechsten Anmeldung von selbst.
echo Jetzt sofort starten? Dann diese Datei schliessen und
echo start-server.cmd doppelklicken.
pause
exit /b 0

:entfernen
if exist "%ZIEL%" (
  del "%ZIEL%"
  echo Autostart AUS -- %ZIEL% geloescht.
) else (
  echo Autostart war nicht eingerichtet -- nichts zu tun.
)
pause
exit /b 0
