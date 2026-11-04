@echo off
chcp 65001 > nul
cd /d "%~dp0"
title 絶縁抵抗測定報告書アプリ

if not exist "node\node.exe" (
  echo [エラー] node\node.exe が見つかりません。zip をすべて展開してから実行してください。
  pause
  exit /b 1
)
echo 起動しています... このウィンドウを閉じるとアプリが終了します。
"node\node.exe" "dist\server\main.mjs" %*
if errorlevel 2 (
  pause
) else if errorlevel 1 (
  echo.
  echo [エラー] アプリが異常終了しました。上のメッセージを確認してください。
  pause
)
