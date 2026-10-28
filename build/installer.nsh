; Included by electron-builder (nsis.include).

; An update keeps the exe path, so Explorer keeps showing the old icon on the
; desktop, Start menu and taskbar shortcuts. ie4uinit -show reloads them.
; Sysnative reaches the 64-bit System32 from the 32-bit installer.
!macro customInstall
  ${if} ${FileExists} "$WINDIR\Sysnative\ie4uinit.exe"
    nsExec::Exec '"$WINDIR\Sysnative\ie4uinit.exe" -show'
  ${elseif} ${FileExists} "$SYSDIR\ie4uinit.exe"
    nsExec::Exec '"$SYSDIR\ie4uinit.exe" -show'
  ${endIf}
!macroend
