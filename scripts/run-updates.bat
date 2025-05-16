@echo off
echo Running database updates for review system...
cd %~dp0\..
node scripts/update-user-records.js
echo Update completed.
pause 