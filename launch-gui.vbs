Set objShell = CreateObject("Wscript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
rootDir = fso.GetParentFolderName(WScript.ScriptFullName)
appExe = rootDir & "\OpenCodeRouterApp.exe"

extraArgs = ""
For i = 0 To WScript.Arguments.Count - 1
    extraArgs = extraArgs & " " & WScript.Arguments(i)
Next

objShell.CurrentDirectory = rootDir

If fso.FileExists(appExe) Then
    cmd = Chr(34) & appExe & Chr(34) & extraArgs
    objShell.Run cmd, 1, False
Else
    trayScript = rootDir & "\tray-daemon.ps1"
    psExe = "C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe"
    If Not fso.FileExists(psExe) Then
        psExe = "powershell.exe"
    End If
    cmd = Chr(34) & psExe & Chr(34) & " -Sta -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File " & Chr(34) & trayScript & Chr(34) & extraArgs
    objShell.Run cmd, 0, False
End If
