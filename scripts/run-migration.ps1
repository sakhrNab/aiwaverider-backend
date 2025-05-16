Write-Host "Running agent download count migration script..." -ForegroundColor Green
Write-Host 

try {
    node scripts/updateAgentsWithDownloadCounts.js
    Write-Host 
    Write-Host "Migration completed successfully." -ForegroundColor Green
}
catch {
    Write-Host "Error running migration script: $_" -ForegroundColor Red
}

Write-Host "Press any key to exit..."
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown") 