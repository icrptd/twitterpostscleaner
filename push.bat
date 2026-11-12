@echo off
chcp 65001 >nul
title Push X Tweets Cleaner to GitHub
setlocal EnableDelayedExpansion
cd /d "%~dp0"

set "REPO=x-tweets-cleaner"
set "DESC=Browser extension for Brave, Chrome and Edge that cleans up your X (Twitter) account: bulk-delete replies, posts or both, and undo reposts. Preview mode, human-like pacing, 100%% local."

where git >nul 2>nul
if errorlevel 1 (
  echo [x] Git is not installed. Get it from https://git-scm.com/download/win and run this again.
  pause & exit /b 1
)

rem --- make sure git knows who you are ---
for /f "delims=" %%i in ('git config --global user.email') do set "GE=%%i"
if not defined GE (
  set /p GN=Your name for commits ^(e.g. Rami^):
  set /p GE=Your GitHub email:
  git config --global user.name "!GN!"
  git config --global user.email "!GE!"
)

rem --- first commit ---
if not exist ".git" (
  git init -q
  git branch -M main
)
git add -A
git commit -q -m "X Tweets Cleaner v1.0.0" 2>nul
git branch -M main

rem --- push: use GitHub CLI if available (creates the repo for you) ---
where gh >nul 2>nul
if not errorlevel 1 (
  gh auth status >nul 2>nul || gh auth login
  git remote get-url origin >nul 2>nul
  if errorlevel 1 (
    gh repo create %REPO% --public --source . --remote origin --description "!DESC!" --push
  ) else (
    git push -u origin main
  )
  goto done
)

rem --- otherwise: create the repo on github.com first, then paste its URL ---
git remote get-url origin >nul 2>nul
if errorlevel 1 (
  echo.
  echo 1^) Go to https://github.com/new
  echo 2^) Repository name: %REPO%   ^(leave README / license / .gitignore UNticked^)
  echo 3^) Click Create repository and copy its URL
  echo.
  set /p URL=Paste the repo URL here:
  git remote add origin !URL!
)
git push -u origin main

:done
echo.
echo Done. If a browser window asked you to sign in to GitHub, that's normal.
pause
