Set objShell = CreateObject("Wscript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
rootDir = fso.GetParentFolderName(WScript.ScriptFullName)
trayExe = rootDir & "\OpenCodeRouterTray.exe"
If fso.FileExists(trayExe) Then
    cmd = """" & trayExe & """"
    objShell.Run cmd, 0, False
Else
    trayScript = rootDir & "\tray-runner.ps1"
    cmd = "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & trayScript & """"
    objShell.Run cmd, 0, False
End If
