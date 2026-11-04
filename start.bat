@echo off
chcp 65001 > nul
cd /d %~dp0
if not exist node_modules (
  echo 初回セットアップ中: npm install
  call npm install || goto :error
)
call npm start
goto :eof
:error
echo セットアップに失敗しました。Node.js 20 以上がインストールされているか確認してください。
pause
