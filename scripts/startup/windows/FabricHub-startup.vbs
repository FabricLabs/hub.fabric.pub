' Fabric Hub — silent start at login (no cmd window).
Set sh = CreateObject("Wscript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
exe = fso.BuildPath(dir, "..\..\..\FabricHub.exe")
If Not fso.FileExists(exe) Then
  exe = sh.ExpandEnvironmentStrings("%LOCALAPPDATA%\Programs\Fabric Hub\FabricHub.exe")
End If
If fso.FileExists(exe) Then
  sh.Run """" & exe & """ --hidden", 0, False
End If
