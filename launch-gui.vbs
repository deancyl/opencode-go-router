Set objShell = CreateObject("Wscript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
rootDir = fso.GetParentFolderName(WScript.ScriptFullName)
appExe = rootDir & "\OpenCodeRouterApp.exe"
trayExe = rootDir & "\OpenCodeRouterTray.exe"
trayScript = rootDir & "\tray-daemon.ps1"

hasSilent = False
extraArgs = ""
For i = 0 To WScript.Arguments.Count - 1
    If LCase(WScript.Arguments(i)) = "-silent" Or LCase(WScript.Arguments(i)) = "/silent" Then
        hasSilent = True
    End If
    extraArgs = extraArgs & " " & WScript.Arguments(i)
Next

objShell.CurrentDirectory = rootDir

If hasSilent Then
    ' 杀软绝对免疫优先：首选原生编译的 C# WinExe 托盘程序 (0 误报，毫秒级启动，极低内存)
    If fso.FileExists(trayExe) Then
        cmd = Chr(34) & trayExe & Chr(34) & extraArgs
        objShell.Run cmd, 0, False
    ElseIf fso.FileExists(trayScript) Then
        psExe = "C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe"
        If Not fso.FileExists(psExe) Then psExe = "powershell.exe"
        cmd = Chr(34) & psExe & Chr(34) & " -Sta -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File " & Chr(34) & trayScript & Chr(34) & extraArgs
        objShell.Run cmd, 0, False
    End If
ElseIf fso.FileExists(appExe) Then
    cmd = Chr(34) & appExe & Chr(34) & extraArgs
    objShell.Run cmd, 1, False
ElseIf fso.FileExists(trayExe) Then
    cmd = Chr(34) & trayExe & Chr(34) & extraArgs
    objShell.Run cmd, 0, False
ElseIf fso.FileExists(trayScript) Then
    psExe = "C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe"
    If Not fso.FileExists(psExe) Then psExe = "powershell.exe"
    cmd = Chr(34) & psExe & Chr(34) & " -Sta -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File " & Chr(34) & trayScript & Chr(34) & extraArgs
    objShell.Run cmd, 0, False
End If
