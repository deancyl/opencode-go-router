Set WshShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
rootDir = fso.GetParentFolderName(WScript.ScriptFullName)
batFile = rootDir & "\start-daemon.bat"

WshShell.CurrentDirectory = rootDir
WshShell.Run Chr(34) & batFile & Chr(34), 0, False
