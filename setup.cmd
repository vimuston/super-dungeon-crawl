@echo off
rem One-time: install deps in WSL, clone current crawl, build webtiles.
rem Uses the default WSL distribution; set SDC_WSL_DISTRO to pick another.
if defined SDC_WSL_DISTRO (
  wsl -d %SDC_WSL_DISTRO% --cd "%~dp0." -- bash scripts/setup.sh
) else (
  wsl --cd "%~dp0." -- bash scripts/setup.sh
)
pause
