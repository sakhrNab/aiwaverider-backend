@echo off
echo Running agent download count migration script...
echo.
node scripts/updateAgentsWithDownloadCounts.js
echo.
echo Migration completed.
pause 