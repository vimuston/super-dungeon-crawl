@echo off
rem Start Super Dungeon Crawl webtiles in WSL and open the browser.
rem Uses the default WSL distribution; set SDC_WSL_DISTRO to pick another.
start "" http://localhost:8080
if defined SDC_WSL_DISTRO (
  wsl -d %SDC_WSL_DISTRO% --cd "%~dp0." -- bash scripts/run.sh
) else (
  wsl --cd "%~dp0." -- bash scripts/run.sh
)
