# Build the standalone Windows package: crawl (Cygwin build, webtiles) +
# the Super Dungeon Crawl client + a small launcher exe, no server needed.
#
#   build-windows.ps1 init       one time: install Cygwin + build deps
#   build-windows.ps1 build      crawl.exe, crawlhost.exe, DLLs (~15 min)
#   build-windows.ps1 stage      re-stage only client / game data
#   build-windows.ps1 launcher   compile the launcher exe (.NET SDK)
#   build-windows.ps1 package    -> dist\super-dungeon-crawl.exe (one file, game files inside)
#   build-windows.ps1 all        init (if needed), build, stage, launcher, package
#
# Env:
#   SDC_WIN_ROOT  work dir for Cygwin, the crawl sources and staging (a few GB;
#                 default %LOCALAPPDATA%\sdc-build). No spaces in the path:
#                 crawl's Makefile can't handle them.
#   SDC_DIST      where the exe goes (default dist\ in the checkout)
#   SDC_JOBS      parallel build jobs (default: all cores)
param([Parameter(Position = 0)][string]$Step = '')

$ErrorActionPreference = 'Stop'
$Here = Split-Path -Parent $PSScriptRoot
$Root = if ($env:SDC_WIN_ROOT) { $env:SDC_WIN_ROOT } else { Join-Path $env:LOCALAPPDATA 'sdc-build' }
if ($Root -match '\s') { throw "SDC_WIN_ROOT must not contain spaces: '$Root' (set SDC_WIN_ROOT to e.g. C:\sdc-build)" }
$Cyg = Join-Path $Root 'cygwin64'
$Pkgs = Join-Path $Root 'cygwin-pkgs'
$Out = Join-Path $Root 'out'
$Bash = Join-Path $Cyg 'bin\bash.exe'
$Mirror = 'https://mirrors.kernel.org/sourceware/cygwin/'
$Packages = @(
    'gcc-core', 'gcc-g++', 'make', 'bison', 'flex', 'pkg-config', 'git', 'patch',
    'python3', 'python3-pip', 'libncurses-devel', 'libpng-devel',
    'libfreetype-devel', 'libsqlite3-devel', 'zlib-devel', 'liblua5.1-devel', 'libiconv-devel',
    'zip', 'unzip', 'rsync'
) -join ','

function ToCyg([string]$p) { & (Join-Path $Cyg 'bin\cygpath.exe') -u $p }

function Invoke-Cyg([string]$cmd) {
    $env:SDC_HERE = ToCyg $Here
    $env:SDC_WIN_OUT = ToCyg $Out
    & $Bash -lc $cmd
    if ($LASTEXITCODE -ne 0) { throw "cygwin step failed ($LASTEXITCODE)" }
}

function Init {
    New-Item -ItemType Directory -Force $Root, $Pkgs | Out-Null
    $setup = Join-Path $Root 'setup-x86_64.exe'
    if (-not (Test-Path $setup)) {
        Invoke-WebRequest 'https://cygwin.com/setup-x86_64.exe' -OutFile $setup
    }
    & $setup -q -n -N -d -R $Cyg -s $Mirror -l $Pkgs -P $Packages | Out-Null
    # setup.exe returns before the post-install scripts finish in -q mode
    while (Get-Process setup-x86_64 -ErrorAction SilentlyContinue) { Start-Sleep 3 }
    if (-not (Test-Path $Bash)) { throw 'Cygwin install failed' }
}

function Build-Crawl([string]$what) {
    Invoke-Cyg "bash '$(ToCyg $Here)/scripts/cygbuild-windows.sh' $what"
}

function Build-Launcher {
    $dest = Join-Path $Out 'launcher'
    # self-contained single file: nothing to install on the player's PC
    dotnet publish (Join-Path $Here 'windows\Launcher.csproj') -c Release -r win-x64 `
        --self-contained -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true `
        -o $dest
    if ($LASTEXITCODE -ne 0) { throw 'launcher build failed' }
}

function Package {
    $pkg = Join-Path $Out 'pkg'
    if (-not (Test-Path (Join-Path $pkg 'bin\crawl.exe'))) { throw 'run build first' }
    foreach ($f in 'LICENSE', 'NOTICE') { Copy-Item (Join-Path $Here $f) $pkg -Force }
    $dist = if ($env:SDC_DIST) { $env:SDC_DIST } else { Join-Path $Here 'dist' }
    New-Item -ItemType Directory -Force $dist | Out-Null

    # the game files, minus whatever the player made if this tree has been played
    $stage = Join-Path $Out 'payload'
    Remove-Item $stage -Recurse -Force -ErrorAction SilentlyContinue
    New-Item -ItemType Directory -Force $stage | Out-Null
    robocopy $pkg $stage /E /XD saves morgue /XF (Join-Path $pkg 'crawl\rcs\player.rc') *.err super-dungeon-crawl.exe README.txt /NFL /NDL /NJH /NJS /NP | Out-Null
    $zip = Join-Path $Out 'payload.zip'
    Remove-Item $zip -ErrorAction SilentlyContinue
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    [IO.Compression.ZipFile]::CreateFromDirectory($stage, $zip, [IO.Compression.CompressionLevel]::Optimal, $false)

    # one exe: launcher + zip + trailer [zip length: int64][id: 16 bytes]["SDCPAYLD"] (see windows/Payload.cs)
    $exe = Join-Path $dist 'super-dungeon-crawl.exe'
    Copy-Item (Join-Path $Out 'launcher\super-dungeon-crawl.exe') $exe -Force
    $out = [IO.File]::Open($exe, [IO.FileMode]::Append)
    try {
        $in = [IO.File]::OpenRead($zip)
        try { $in.CopyTo($out) } finally { $in.Dispose() }
        $out.Write([BitConverter]::GetBytes([int64](Get-Item $zip).Length), 0, 8)
        $id = [Guid]::NewGuid().ToByteArray()
        $out.Write($id, 0, 16)
        $out.Write([Text.Encoding]::ASCII.GetBytes('SDCPAYLD'), 0, 8)
    } finally { $out.Dispose() }
    Write-Host ('{0}: {1:N0} MB' -f $exe, ((Get-Item $exe).Length / 1MB))
}

switch ($Step) {
    'init'     { Init }
    'build'    { Build-Crawl 'build' }
    'stage'    { Build-Crawl 'stage' }
    'launcher' { Build-Launcher }
    'package'  { Package }
    'all' {
        if (-not (Test-Path $Bash)) { Init }
        Build-Crawl 'build'; Build-Launcher; Package
    }
    default { Write-Host "usage: build-windows.ps1 init|build|stage|launcher|package|all  (work dir: $Root)"; exit 2 }
}
