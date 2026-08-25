' Startet den Dashboard-Server ohne Konsolenfenster (fuer den Anmelde-Trigger).
' Verdrahtung: siehe start-server.cmd (schtasks onlogon).
Dim schale, hier
Set schale = CreateObject("WScript.Shell")
hier = Left(WScript.ScriptFullName, InStrRev(WScript.ScriptFullName, "\"))
schale.Run "node """ & hier & "serve.js"" --wurzel """ & Left(hier, Len(hier) - Len("dashboard\")) & """ --port 8766", 0, False
