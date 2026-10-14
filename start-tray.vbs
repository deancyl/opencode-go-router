Set WshShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
rootDir = fso.GetParentFolderName(WScript.ScriptFullName)
trayScript = rootDir & "\tray-daemon.ps1"
psExe = "C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe"
If Not fso.FileExists(psExe) Then
    psExe = "powershell.exe"
End If

hasSilent = False
extraArgs = ""
For i = 0 To WScript.Arguments.Count - 1
    If LCase(WScript.Arguments(i)) = "-silent" Then
        hasSilent = True
    End If
    extraArgs = extraArgs & " " & WScript.Arguments(i)
Next
If Not hasSilent Then
    extraArgs = " -Silent" & extraArgs
End If

cmd = Chr(34) & psExe & Chr(34) & " -Sta -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File " & Chr(34) & trayScript & Chr(34) & extraArgs
WshShell.CurrentDirectory = rootDir
WshShell.Run cmd, 0, False
