' Launch the ledger in browser "app mode": standalone window, no address bar or browser buttons.
' Prefers the system default browser (Chrome/Edge), so existing data in that browser is kept.
Option Explicit
Dim fso, sh, dir, url, progId, candidates, p, i, edge1, edge2, chrome1, chrome2, chrome3
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
url = "file:///" & Replace(dir, "\", "/") & "/index.html?app=1"

edge1 = sh.ExpandEnvironmentStrings("%ProgramFiles(x86)%") & "\Microsoft\Edge\Application\msedge.exe"
edge2 = sh.ExpandEnvironmentStrings("%ProgramFiles%") & "\Microsoft\Edge\Application\msedge.exe"
chrome1 = sh.ExpandEnvironmentStrings("%ProgramFiles%") & "\Google\Chrome\Application\chrome.exe"
chrome2 = sh.ExpandEnvironmentStrings("%ProgramFiles(x86)%") & "\Google\Chrome\Application\chrome.exe"
chrome3 = sh.ExpandEnvironmentStrings("%LocalAppData%") & "\Google\Chrome\Application\chrome.exe"

progId = ""
On Error Resume Next
progId = sh.RegRead("HKCU\Software\Microsoft\Windows\Shell\Associations\UrlAssociations\http\UserChoice\ProgId")
On Error GoTo 0

If InStr(1, progId, "Chrome", vbTextCompare) > 0 Then
  candidates = Array(chrome1, chrome2, chrome3, edge1, edge2)
Else
  candidates = Array(edge1, edge2, chrome1, chrome2, chrome3)
End If

For i = 0 To UBound(candidates)
  p = candidates(i)
  If fso.FileExists(p) Then
    sh.Run """" & p & """ --app=""" & url & """ --window-size=1200,860", 1, False
    WScript.Quit
  End If
Next

' Fallback: default browser, normal window
sh.Run url, 1, False
