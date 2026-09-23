@echo off
setlocal DisableDelayedExpansion
chcp 65001 >nul
"C:\Program Files\nodejs\node.exe" "C:\Users\soto\projects\PlotStack\native\host.mjs" %*
