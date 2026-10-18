# Installs the Showcase Studio app this plugin runs on Windows: the version
# in ..\app-version, downloaded from showcasestudio.dev (or
# $env:SHOWCASE_STUDIO_DOWNLOAD_URL), checked against the release's SHA-256
# hash, into %LOCALAPPDATA%\Programs\Showcase Studio (or
# $env:SHOWCASE_STUDIO_INSTALL_DIR\Showcase Studio). Replaces an older
# version there. No admin rights needed.
#
# bin/install-app runs this on Windows. PowerShell on purpose: Claude Code
# doesn't need Node, so this can't either.
#
# $env:SHOWCASE_STUDIO_RELEASE_DIR names a folder that already holds the zip
# and SHA256SUMS-win-x64 (a local build); then nothing is downloaded. The
# Windows CI job installs its own build this way.
$ErrorActionPreference = "Stop"

$base = if ($env:SHOWCASE_STUDIO_DOWNLOAD_URL) { $env:SHOWCASE_STUDIO_DOWNLOAD_URL } else { "https://showcasestudio.dev/download" }
$root = Split-Path -Parent $PSScriptRoot
$version = (Get-Content (Join-Path $root "app-version") -Raw).Trim()
$installRoot = if ($env:SHOWCASE_STUDIO_INSTALL_DIR) { $env:SHOWCASE_STUDIO_INSTALL_DIR } else { Join-Path $env:LOCALAPPDATA "Programs" }
$dest = Join-Path $installRoot "Showcase Studio"
$exe = Join-Path $dest "Showcase Studio.exe"
$zip = "Showcase-Studio-$version-win-x64.zip"
$sums = "SHA256SUMS-win-x64"

function Fail($message) {
  [Console]::Error.WriteLine("install-app: $message")
  exit 1
}

if ([Environment]::Is64BitOperatingSystem -ne $true -or $env:PROCESSOR_ARCHITECTURE -eq "ARM64") {
  Fail "Showcase Studio $version for Windows is built for 64-bit Intel and AMD processors only."
}
$local = $env:SHOWCASE_STUDIO_RELEASE_DIR

if (Test-Path $exe) {
  # Windows keeps four parts (0.2.0.0); the release has three.
  $installed = ((Get-Item $exe).VersionInfo.ProductVersion -split "\.")[0..2] -join "."
  if ($installed -eq $version) {
    Write-Output "Showcase Studio $version is already installed at $dest"
    exit 0
  }
}

$work = Join-Path ([IO.Path]::GetTempPath()) ("showcase-studio-" + [Guid]::NewGuid())
New-Item -ItemType Directory $work | Out-Null
try {
  if ($local) {
    Write-Output "Installing Showcase Studio $version from $local..."
    foreach ($file in @($zip, $sums)) {
      if (-not (Test-Path (Join-Path $local $file))) { Fail "$local has no $file." }
      Copy-Item (Join-Path $local $file) $work
    }
  } else {
    Write-Output "Downloading Showcase Studio $version from $base..."
    # Windows PowerShell 5.1 may not offer TLS 1.2 by default, and its
    # progress bar slows a large download many times over.
    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
    $ProgressPreference = "SilentlyContinue"
    foreach ($file in @($zip, $sums)) {
      try { Invoke-WebRequest -UseBasicParsing -Uri "$base/v$version/$file" -OutFile (Join-Path $work $file) }
      catch { Fail "Couldn't download $base/v$version/$file. Check your internet connection, and that release $version has a Windows build." }
    }
  }

  $expected = (Get-Content (Join-Path $work $sums) -Raw).Trim().Split(" ", [StringSplitOptions]::RemoveEmptyEntries)[0]
  # .NET directly, not Get-FileHash or Expand-Archive: those live in modules
  # that Windows PowerShell can fail to load when it was started from a
  # PowerShell 7 session, which leaves its own module path behind.
  $stream = [IO.File]::OpenRead((Join-Path $work $zip))
  try {
    $sha = [Security.Cryptography.SHA256]::Create()
    $actual = -join ($sha.ComputeHash($stream) | ForEach-Object { $_.ToString("x2") })
  } finally {
    $stream.Dispose()
  }
  if ($expected -ne $actual.ToLower()) {
    Fail "The download doesn't match its SHA-256 hash, so nothing was installed."
  }

  $unpacked = Join-Path $work "unpacked"
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  [IO.Compression.ZipFile]::ExtractToDirectory((Join-Path $work $zip), $unpacked)
  if (-not (Test-Path (Join-Path $unpacked "Showcase Studio.exe"))) {
    Fail "The download doesn't contain Showcase Studio.exe, so nothing was installed."
  }

  New-Item -ItemType Directory -Force $installRoot | Out-Null
  if (Test-Path $dest) {
    try { Remove-Item -Recurse -Force $dest }
    catch { Fail "Couldn't replace $dest. Quit Showcase Studio (and Claude Code sessions using it), then try again." }
  }
  Move-Item $unpacked $dest
} finally {
  Remove-Item -Recurse -Force $work -ErrorAction SilentlyContinue
}

Write-Output "Installed Showcase Studio $version at $dest"
Write-Output "Next: reconnect the showcase-studio MCP server (/mcp in Claude Code) or start a new session, so its tools appear."
