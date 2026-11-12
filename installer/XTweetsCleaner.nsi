; =====================================================================
;  X Tweets Cleaner — Windows installer (NSIS 3)
;  Build:  makensis XTweetsCleaner.nsi
;
;  After you publish to the Chrome Web Store, put the extension ID here
;  and rebuild: the installer will then make Brave/Chrome/Edge install it
;  from the store automatically (no Developer mode needed).
;      !define WEBSTORE_ID "abcdefghijklmnopabcdefghijklmnop"
; =====================================================================

Unicode true
!include "MUI2.nsh"

!define APP_NAME    "X Tweets Cleaner"
!define APP_VERSION "1.0.0"
!define APP_PUBLISHER "Rami | icrptd"
!define UNINST_KEY  "Software\Microsoft\Windows\CurrentVersion\Uninstall\XTweetsCleaner"

Name "${APP_NAME}"
OutFile "XTweetsCleaner-Setup-${APP_VERSION}.exe"
InstallDir "$LOCALAPPDATA\${APP_NAME}"
InstallDirRegKey HKCU "Software\XTweetsCleaner" "InstallDir"
RequestExecutionLevel user
SetCompressor /SOLID lzma
BrandingText "${APP_NAME} ${APP_VERSION}"

VIProductVersion "${APP_VERSION}.0"
VIAddVersionKey "ProductName" "${APP_NAME}"
VIAddVersionKey "FileDescription" "${APP_NAME} Setup"
VIAddVersionKey "FileVersion" "${APP_VERSION}"
VIAddVersionKey "CompanyName" "${APP_PUBLISHER}"
VIAddVersionKey "LegalCopyright" "${APP_PUBLISHER}"

; ---------- look ----------
!define MUI_ICON   "icon.ico"
!define MUI_UNICON "icon.ico"
!define MUI_WELCOMEFINISHPAGE_BITMAP   "side.bmp"
!define MUI_UNWELCOMEFINISHPAGE_BITMAP "side.bmp"
!define MUI_HEADERIMAGE
!define MUI_HEADERIMAGE_RIGHT
!define MUI_HEADERIMAGE_BITMAP "header.bmp"
!define MUI_ABORTWARNING

!define MUI_WELCOMEPAGE_TITLE "Welcome to ${APP_NAME}"
!define MUI_WELCOMEPAGE_TEXT "This will install ${APP_NAME} ${APP_VERSION}, a browser extension for Brave, Chrome and Edge that cleans up your X account: your replies, your posts, or both.$\r$\n$\r$\nIt runs only in your browser and never asks for your password.$\r$\n$\r$\nClick Next to continue."

!define MUI_FINISHPAGE_TITLE "${APP_NAME} is ready"
!ifdef WEBSTORE_ID
  !define MUI_FINISHPAGE_TEXT "Restart Brave. It will ask you to enable ${APP_NAME}. Click Enable, and you're done."
!else
  !define MUI_FINISHPAGE_TEXT "One last step: turn it on in your browser. The setup guide shows you how. It takes about 20 seconds."
!endif
!define MUI_FINISHPAGE_RUN
!define MUI_FINISHPAGE_RUN_TEXT "Open the setup guide"
!define MUI_FINISHPAGE_RUN_FUNCTION OpenGuide
!define MUI_FINISHPAGE_SHOWREADME
!define MUI_FINISHPAGE_SHOWREADME_TEXT "Open the extension folder"
!define MUI_FINISHPAGE_SHOWREADME_FUNCTION OpenFolder

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

!insertmacro MUI_LANGUAGE "English"

; ---------- install ----------
Section "Install"
  SetOutPath "$INSTDIR"
  File "guide.html"
  File "icon.ico"

  SetOutPath "$INSTDIR\extension"
  File /r "..\extension\*.*"

  WriteRegStr HKCU "Software\XTweetsCleaner" "InstallDir" "$INSTDIR"

  !ifdef WEBSTORE_ID
    ; Ask Brave / Chrome / Edge to install the published store version
    WriteRegStr HKCU "Software\BraveSoftware\Brave-Browser\Extensions\${WEBSTORE_ID}" "update_url" "https://clients2.google.com/service/update2/crx"
    WriteRegStr HKCU "Software\Google\Chrome\Extensions\${WEBSTORE_ID}" "update_url" "https://clients2.google.com/service/update2/crx"
    WriteRegStr HKCU "Software\Microsoft\Edge\Extensions\${WEBSTORE_ID}" "update_url" "https://clients2.google.com/service/update2/crx"
  !endif

  ; Start menu
  CreateDirectory "$SMPROGRAMS\${APP_NAME}"
  CreateShortcut "$SMPROGRAMS\${APP_NAME}\${APP_NAME} - Setup guide.lnk" "$INSTDIR\guide.html" "" "$INSTDIR\icon.ico"
  CreateShortcut "$SMPROGRAMS\${APP_NAME}\Extension folder.lnk" "$INSTDIR\extension" "" "$INSTDIR\icon.ico"
  CreateShortcut "$SMPROGRAMS\${APP_NAME}\Uninstall ${APP_NAME}.lnk" "$INSTDIR\Uninstall.exe"

  ; Apps & features entry
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  WriteRegStr   HKCU "${UNINST_KEY}" "DisplayName" "${APP_NAME}"
  WriteRegStr   HKCU "${UNINST_KEY}" "DisplayVersion" "${APP_VERSION}"
  WriteRegStr   HKCU "${UNINST_KEY}" "Publisher" "${APP_PUBLISHER}"
  WriteRegStr   HKCU "${UNINST_KEY}" "DisplayIcon" "$INSTDIR\icon.ico"
  WriteRegStr   HKCU "${UNINST_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr   HKCU "${UNINST_KEY}" "UninstallString" '"$INSTDIR\Uninstall.exe"'
  WriteRegDWORD HKCU "${UNINST_KEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINST_KEY}" "NoRepair" 1
SectionEnd

Function OpenGuide
  ExecShell "open" "$INSTDIR\guide.html"
FunctionEnd

Function OpenFolder
  ExecShell "open" "$INSTDIR\extension"
FunctionEnd

; ---------- uninstall ----------
Section "Uninstall"
  !ifdef WEBSTORE_ID
    DeleteRegKey HKCU "Software\BraveSoftware\Brave-Browser\Extensions\${WEBSTORE_ID}"
    DeleteRegKey HKCU "Software\Google\Chrome\Extensions\${WEBSTORE_ID}"
    DeleteRegKey HKCU "Software\Microsoft\Edge\Extensions\${WEBSTORE_ID}"
  !endif
  RMDir /r "$SMPROGRAMS\${APP_NAME}"
  RMDir /r "$INSTDIR\extension"
  Delete "$INSTDIR\guide.html"
  Delete "$INSTDIR\icon.ico"
  Delete "$INSTDIR\Uninstall.exe"
  RMDir "$INSTDIR"
  DeleteRegKey HKCU "${UNINST_KEY}"
  DeleteRegKey HKCU "Software\XTweetsCleaner"
SectionEnd
