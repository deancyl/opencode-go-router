Set WshShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
rootDir = fso.GetParentFolderName(WScript.ScriptFullName)
serverJs = rootDir & "\server.js"
logFile = rootDir & "\router.log"

' Locate node.exe dynamically
nodeExe = "node.exe"
If fso.FileExists("C:\Program Files\nodejs\node.exe") Then
    nodeExe = "C:\Program Files\nodejs\node.exe"
ElseIf fso.FileExists(WshShell.ExpandEnvironmentStrings("%LOCALAPPDATA%\Programs\node\node.exe")) Then
    nodeExe = WshShell.ExpandEnvironmentStrings("%LOCALAPPDATA%\Programs\node\node.exe")
End If

cmd = "cmd.exe /d /c " & Chr(34) & Chr(34) & nodeExe & Chr(34) & " " & Chr(34) & serverJs & Chr(34) & " >> " & Chr(34) & logFile & Chr(34) & " 2>&1" & Chr(34)
WshShell.CurrentDirectory = rootDir
WshShell.Run cmd, 0, False
