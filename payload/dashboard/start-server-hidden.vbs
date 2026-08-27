' Startet den Dashboard-Server ohne Konsolenfenster (fuer den Anmelde-Start).
'
' NODE MIT VOLLEM PFAD [gemessen 27.08.2026]: Der Aufruf "node ..." schlug hier
' still fehl -- der Prozess, der diese Datei startet (wscript aus dem Autostart),
' bringt nicht denselben PATH mit wie eine Eingabeaufforderung. Sichtbar war
' davon nichts: das Fenster ist ja unterdrueckt. Deshalb wird node an den
' bekannten Orten gesucht, und wenn es nirgends liegt, schreibt das Skript eine
' Zeile nach %TEMP%\keel-dashboard-start.log statt lautlos aufzugeben.
Option Explicit
Dim schale, dateien, hier, wurzel, node, kandidaten, i, protokoll

Set schale = CreateObject("WScript.Shell")
Set dateien = CreateObject("Scripting.FileSystemObject")

hier = Left(WScript.ScriptFullName, InStrRev(WScript.ScriptFullName, "\"))
' OHNE abschliessenden Backslash [gemessen 27.08.2026 -- der eigentliche Grund,
' warum der Anmelde-Start nie lief]: "C:\...\keel-harness-live-1\" endet im
' Befehl auf Backslash-Anfuehrungszeichen. Windows liest das als MASKIERTES
' Anfuehrungszeichen, der Rest der Zeile verrutscht, und node bekommt Muell --
' lautlos, weil das Fenster unterdrueckt ist.
wurzel = Left(hier, Len(hier) - Len("dashboard\") - 1)
protokoll = schale.ExpandEnvironmentStrings("%TEMP%") & "\keel-dashboard-start.log"

kandidaten = Array( _
  schale.ExpandEnvironmentStrings("%ProgramFiles%") & "\nodejs\node.exe", _
  schale.ExpandEnvironmentStrings("%ProgramFiles(x86)%") & "\nodejs\node.exe", _
  schale.ExpandEnvironmentStrings("%LOCALAPPDATA%") & "\Programs\nodejs\node.exe", _
  schale.ExpandEnvironmentStrings("%APPDATA%") & "\nvm\node.exe")

node = ""
For i = 0 To UBound(kandidaten)
  If node = "" And dateien.FileExists(kandidaten(i)) Then node = kandidaten(i)
Next

If node = "" Then
  ' Letzter Versuch ueber den PATH -- und wenn auch das nichts wird, steht der
  ' Grund im Protokoll.
  node = "node"
  Dim strom
  Set strom = dateien.OpenTextFile(protokoll, 8, True)
  strom.WriteLine Now & " node.exe an keinem bekannten Ort gefunden -- versuche PATH"
  strom.Close
End If

schale.Run """" & node & """ """ & hier & "serve.js"" --wurzel """ & wurzel & """ --port 8766", 0, False
