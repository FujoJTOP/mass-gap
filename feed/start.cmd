@echo off
rem Live view of the DSH session that is solving the mass gap.
rem   http://127.0.0.1:8123/       page polls /live.json every 5 s
rem   --push=240  also commit+push data/snapshot.json so the public Pages build refreshes
cd /d "%~dp0.."
node feed\livefeed.mjs --serve=8123 %*
