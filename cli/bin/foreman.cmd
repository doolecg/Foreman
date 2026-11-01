@echo off
rem Runs the foreman CLI with the Foreman app binary as Node (FOREMAN_NODE), or plain node.
rem ELECTRON_RUN_AS_NODE is set only inside this script, never in the operator's shell.
setlocal
set "FOREMAN_CJS=%~dp0foreman.cjs"
if not exist "%FOREMAN_CJS%" set "FOREMAN_CJS=%~dp0..\..\out\cli\foreman.cjs"
if not defined FOREMAN_NODE goto plain
set ELECTRON_RUN_AS_NODE=1
"%FOREMAN_NODE%" "%FOREMAN_CJS%" %*
exit /b %ERRORLEVEL%
:plain
node "%FOREMAN_CJS%" %*
exit /b %ERRORLEVEL%
