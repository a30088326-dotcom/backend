Set WshShell = CreateObject("WScript.Shell")
Set FileSystem = CreateObject("Scripting.FileSystemObject")
ProjectFolder = FileSystem.GetParentFolderName(WScript.ScriptFullName)
WshShell.Run chr(34) & ProjectFolder & "\start-app.bat" & Chr(34), 0
Set FileSystem = Nothing
Set WshShell = Nothing
