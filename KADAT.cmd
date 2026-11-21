@echo off
rem KADAT 2 - local launch of the tactical scene on Windows.
rem Double-click this file. It checks Node.js 24, installs dependencies from the
rem lockfile (pnpm 11 via Corepack, no administrator rights needed) and opens the browser.
chcp 65001 >nul
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js не найден. Установите Node.js 24:
  echo https://nodejs.org/dist/v24.19.0/node-v24.19.0-x64.msi
  pause
  exit /b 1
)

for /f "tokens=1 delims=." %%v in ('node -p "process.versions.node"') do set "NODE_MAJOR=%%v"
if not "%NODE_MAJOR%"=="24" (
  echo Нужна Node.js версии 24, а установлена:
  node -v
  echo Скачайте Node.js 24: https://nodejs.org/dist/v24.19.0/node-v24.19.0-x64.msi
  pause
  exit /b 1
)

set "COREPACK_ENABLE_DOWNLOAD_PROMPT=0"
echo Установка зависимостей по lockfile...
call corepack pnpm install --frozen-lockfile
if errorlevel 1 (
  echo Не удалось установить зависимости. Пришлите этот текст разработчику.
  pause
  exit /b 1
)

echo Запуск KADAT 2. Браузер откроется через несколько секунд: http://127.0.0.1:5173
echo Чтобы остановить, закройте это окно.
start "" /min cmd /c "timeout /t 5 /nobreak >nul & explorer http://127.0.0.1:5173"
rem Call the client package directly: the root script would need pnpm on PATH.
call corepack pnpm --filter @kadat/client dev
pause
