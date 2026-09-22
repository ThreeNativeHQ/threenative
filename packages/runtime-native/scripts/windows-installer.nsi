Unicode true
!include "MUI2.nsh"
!include "x64.nsh"
Name "@TN_NAME@"
OutFile "@TN_OUTPUT@"
InstallDir "$LOCALAPPDATA\Programs\@TN_ID@"
InstallDirRegKey HKCU "@TN_REGISTRY@" "InstallLocation"
RequestExecutionLevel user
AllowSkipFiles off
SetCompressor /SOLID lzma
@TN_ICON@
@TN_SIGN_UNINSTALLER@
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"

Section "Install"
  SetShellVarContext current
  ${IfNot} ${RunningX64}
    MessageBox MB_OK|MB_ICONSTOP "This game requires 64-bit Windows." /SD IDOK
    SetErrorLevel 1
    Abort
  ${EndIf}
  ReadRegStr $0 HKCU "@TN_REGISTRY@" "InstallLocation"
  StrCmp $0 "" locationReady
  StrCmp $0 $INSTDIR locationReady
  MessageBox MB_OK|MB_ICONSTOP "This game is already installed at $0. Uninstall it before choosing a different directory." /SD IDOK
  SetErrorLevel 1
  Abort
locationReady:
  ReadINIStr $0 "$INSTDIR\.threenative-installer.ini" "Application" "Id"
  StrCmp $0 "@TN_ID@" owned
  FindFirst $1 $2 "$INSTDIR\*"
checkDirectory:
  StrCmp $2 "" emptyDirectory
  StrCmp $2 "." nextEntry
  StrCmp $2 ".." nextEntry
  FindClose $1
  Goto occupied
nextEntry:
  FindNext $1 $2
  Goto checkDirectory
emptyDirectory:
  FindClose $1
  Goto prerequisites
occupied:
  MessageBox MB_OK|MB_ICONSTOP "Choose an empty installation directory." /SD IDOK
  SetErrorLevel 1
  Abort
owned:
  Goto prerequisites
prerequisites:
  ClearErrors
@TN_WEBVIEW@
  IfFileExists "$INSTDIR\Uninstall.exe" 0 fresh
  ExecWait '"$INSTDIR\Uninstall.exe" /S _?=$INSTDIR' $0
  IfErrors failed
  StrCmp $0 0 fresh failed
fresh:
  ClearErrors
  CreateDirectory "$INSTDIR"
  WriteINIStr "$INSTDIR\.threenative-installer.ini" "Application" "Id" "@TN_ID@"
  IfErrors failed
@TN_INSTALL_FILES@
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  IfErrors failed
  CreateDirectory "$SMPROGRAMS\@TN_ID@"
  CreateShortCut "$SMPROGRAMS\@TN_ID@\@TN_SHORTCUT@.lnk" "$INSTDIR\game\@TN_EXECUTABLE@"
  WriteRegStr HKCU "@TN_REGISTRY@" "DisplayName" "@TN_NAME@"
  WriteRegStr HKCU "@TN_REGISTRY@" "DisplayVersion" "@TN_VERSION@"
  WriteRegStr HKCU "@TN_REGISTRY@" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "@TN_REGISTRY@" "DisplayIcon" "$INSTDIR\game\@TN_EXECUTABLE@"
  WriteRegStr HKCU "@TN_REGISTRY@" "UninstallString" '$\"$INSTDIR\Uninstall.exe$\"'
  WriteRegStr HKCU "@TN_REGISTRY@" "QuietUninstallString" '$\"$INSTDIR\Uninstall.exe$\" /S'
  WriteRegDWORD HKCU "@TN_REGISTRY@" "NoModify" 1
  WriteRegDWORD HKCU "@TN_REGISTRY@" "NoRepair" 1
  IfErrors failed
  Goto done
failed:
  MessageBox MB_OK|MB_ICONSTOP "Installation failed. Close the game, check free space, and run setup again." /SD IDOK
  SetErrorLevel 1
  Abort
done:
SectionEnd

Section "Uninstall"
  SetShellVarContext current
  ReadINIStr $0 "$INSTDIR\.threenative-installer.ini" "Application" "Id"
  StrCmp $0 "@TN_ID@" remove refused
remove:
  ClearErrors
@TN_DELETE_FILES@
  IfErrors refused
@TN_DELETE_DIRECTORIES@
  ReadRegStr $0 HKCU "@TN_REGISTRY@" "InstallLocation"
  StrCmp $0 $INSTDIR 0 keepRegistration
  Delete "$SMPROGRAMS\@TN_ID@\@TN_SHORTCUT@.lnk"
  RMDir "$SMPROGRAMS\@TN_ID@"
  DeleteRegKey HKCU "@TN_REGISTRY@"
keepRegistration:
  Delete "$INSTDIR\.threenative-installer.ini"
  Delete "$INSTDIR\Uninstall.exe"
  RMDir "$INSTDIR"
  Goto removed
refused:
  MessageBox MB_OK|MB_ICONSTOP "Uninstall could not remove the game. Close it and run uninstall again." /SD IDOK
  SetErrorLevel 1
  Abort
removed:
SectionEnd
