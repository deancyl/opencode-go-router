Set WshShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
rootDir = fso.GetParentFolderName(WScript.ScriptFullName)
trayScript = rootDir & "\tray-daemon.ps1"
psExe = "C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe"
If Not fso.FileExists(psExe) Then
    psExe = "powershell.exe"
End If

cmd = "cmd.exe /d /c " & Chr(34) & Chr(34) & psExe & Chr(34) & " -Sta -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File " & Chr(34) & trayScript & Chr(34) & Chr(34)
WshShell.CurrentDirectory = rootDir
WshShell.Run cmd, 0, False
