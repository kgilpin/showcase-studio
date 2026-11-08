@echo off
rem Starts Showcase Studio as Claude Code's MCP server on Windows: the app's
rem --mcp mode, talking MCP on stdin and stdout. bin/studio-mcp does the same
rem on macOS, and on Windows when Claude Code runs it through Git Bash; this
rem file covers Windows when the server is started as bin\studio-mcp.cmd.
rem
rem It looks for the app at %SHOWCASE_STUDIO_APP% (Showcase Studio.exe or its
rem folder), then in %SHOWCASE_STUDIO_INSTALL_DIR%\Showcase Studio and
rem %LOCALAPPDATA%\Programs\Showcase Studio, where bin\install-app puts it.
rem With SHOWCASE_STUDIO_SRC set, it runs that checkout's
rem scripts\studio-mcp.mjs with node (or %SHOWCASE_STUDIO_NODE%) instead.
rem
rem The app runs directly, not through PowerShell, so the MCP messages on
rem stdin and stdout pass through untouched.
setlocal

if defined SHOWCASE_STUDIO_SRC (
  if not exist "%SHOWCASE_STUDIO_SRC%\scripts\studio-mcp.mjs" (
    echo showcase-studio: SHOWCASE_STUDIO_SRC is set, but "%SHOWCASE_STUDIO_SRC%\scripts\studio-mcp.mjs" doesn't exist. Point it at a Showcase Studio checkout. 1>&2
    exit /b 1
  )
  if defined SHOWCASE_STUDIO_NODE (
    "%SHOWCASE_STUDIO_NODE%" "%SHOWCASE_STUDIO_SRC%\scripts\studio-mcp.mjs"
  ) else (
    node "%SHOWCASE_STUDIO_SRC%\scripts\studio-mcp.mjs"
  )
  exit /b %ERRORLEVEL%
)

set "exe="
if defined SHOWCASE_STUDIO_APP (
  if exist "%SHOWCASE_STUDIO_APP%\Showcase Studio.exe" (
    set "exe=%SHOWCASE_STUDIO_APP%\Showcase Studio.exe"
  ) else if exist "%SHOWCASE_STUDIO_APP%" (
    set "exe=%SHOWCASE_STUDIO_APP%"
  )
)
rem A SHOWCASE_STUDIO_APP that names nothing is an error, not a fallback
rem to the installed app: the variable is how a local build is tried.
if defined SHOWCASE_STUDIO_APP if not defined exe (
  echo showcase-studio: SHOWCASE_STUDIO_APP is set, but there is no Showcase Studio.exe at "%SHOWCASE_STUDIO_APP%". Unset it to use the installed app. 1>&2
  exit /b 1
)
if not defined exe if defined SHOWCASE_STUDIO_INSTALL_DIR (
  if exist "%SHOWCASE_STUDIO_INSTALL_DIR%\Showcase Studio\Showcase Studio.exe" (
    set "exe=%SHOWCASE_STUDIO_INSTALL_DIR%\Showcase Studio\Showcase Studio.exe"
  )
)
if not defined exe (
  if exist "%LOCALAPPDATA%\Programs\Showcase Studio\Showcase Studio.exe" (
    set "exe=%LOCALAPPDATA%\Programs\Showcase Studio\Showcase Studio.exe"
  )
)

if not defined exe (
  echo showcase-studio: the Showcase Studio app isn't installed. Install it with: "%~dp0install-app" 1>&2
  exit /b 1
)

"%exe%" --mcp
exit /b %ERRORLEVEL%
