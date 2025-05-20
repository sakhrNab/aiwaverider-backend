# PowerShell script to test the API reachability

Write-Host "Testing API reachability..." -ForegroundColor Yellow

# Test local API access (HTTP)
Write-Host "`nTesting local API (HTTP - localhost:81):" -ForegroundColor Cyan
try {
    $response = Invoke-WebRequest -Uri "http://localhost:81/api/health" -UseBasicParsing
    Write-Host "Status: $($response.StatusCode) - $(if($response.StatusCode -eq 200){'✅ Success'}else{'❌ Failed'})" -ForegroundColor $(if($response.StatusCode -eq 200){'Green'}else{'Red'})
    Write-Host "Response: $($response.Content)" -ForegroundColor Gray
}
catch {
    Write-Host "❌ Failed to connect to localhost:81/api/health" -ForegroundColor Red
    Write-Host "Error: $_" -ForegroundColor Gray
}

# Test local API access (HTTPS) - Add this only for PowerShell 6.0 or newer
$PSVersion = $PSVersionTable.PSVersion.Major
if ($PSVersion -ge 6) {
    Write-Host "`nTesting local API (HTTPS - localhost):" -ForegroundColor Cyan
    try {
        $response = Invoke-WebRequest -Uri "https://localhost/api/health" -UseBasicParsing -SkipCertificateCheck
        Write-Host "Status: $($response.StatusCode) - $(if($response.StatusCode -eq 200){'✅ Success'}else{'❌ Failed'})" -ForegroundColor $(if($response.StatusCode -eq 200){'Green'}else{'Red'})
        Write-Host "Response: $($response.Content)" -ForegroundColor Gray
    }
    catch {
        Write-Host "❌ Failed to connect to https://localhost/api/health" -ForegroundColor Red
        Write-Host "Error: $_" -ForegroundColor Gray
    }
} else {
    Write-Host "`nSkipping HTTPS test (requires PowerShell 6.0 or newer for certificate check skipping)" -ForegroundColor Yellow
    
    # Temporarily bypass certificate validation (not recommended for production scripts)
    Write-Host "You can add a temporary certificate bypass with this code:" -ForegroundColor Gray
    Write-Host '[System.Net.ServicePointManager]::ServerCertificateValidationCallback = {$true}' -ForegroundColor Gray
}

# Test if api.aiwaverider.com is resolvable
Write-Host "`nChecking if api.aiwaverider.com is resolvable:" -ForegroundColor Cyan
try {
    $dnsResult = Resolve-DnsName -Name "api.aiwaverider.com" -ErrorAction Stop
    Write-Host "✅ api.aiwaverider.com resolves to: $($dnsResult.IPAddress)" -ForegroundColor Green
    
    # Try to connect to the actual domain (HTTP)
    Write-Host "`nTesting api.aiwaverider.com:81 (HTTP):" -ForegroundColor Cyan
    try {
        $response = Invoke-WebRequest -Uri "http://api.aiwaverider.com:81/api/health" -UseBasicParsing -TimeoutSec 5
        Write-Host "Status: $($response.StatusCode) - $(if($response.StatusCode -eq 200){'✅ Success'}else{'❌ Failed'})" -ForegroundColor $(if($response.StatusCode -eq 200){'Green'}else{'Red'})
        Write-Host "Response: $($response.Content)" -ForegroundColor Gray
    }
    catch {
        Write-Host "❌ Failed to connect to http://api.aiwaverider.com:81" -ForegroundColor Red
        Write-Host "Error: $_" -ForegroundColor Gray
    }
    
    # Try to connect to the actual domain (HTTPS) - only for PowerShell 6.0 or newer
    if ($PSVersion -ge 6) {
        Write-Host "`nTesting api.aiwaverider.com (HTTPS):" -ForegroundColor Cyan
        try {
            $response = Invoke-WebRequest -Uri "https://api.aiwaverider.com/api/health" -UseBasicParsing -TimeoutSec 5 -SkipCertificateCheck
            Write-Host "Status: $($response.StatusCode) - $(if($response.StatusCode -eq 200){'✅ Success'}else{'❌ Failed'})" -ForegroundColor $(if($response.StatusCode -eq 200){'Green'}else{'Red'})
            Write-Host "Response: $($response.Content)" -ForegroundColor Gray
        }
        catch {
            Write-Host "❌ Failed to connect to https://api.aiwaverider.com" -ForegroundColor Red
            Write-Host "Error: $_" -ForegroundColor Gray
        }
    } else {
        Write-Host "`nSkipping HTTPS test (requires PowerShell 6.0 or newer for certificate check skipping)" -ForegroundColor Yellow
    }
    
    # If connecting to the domain fails, suggest a modification to the hosts file
    Write-Host "`nSuggestion:" -ForegroundColor Yellow
    Write-Host "To test api.aiwaverider.com locally, you can add this entry to your hosts file:" -ForegroundColor Yellow
    Write-Host "127.0.0.1 api.aiwaverider.com" -ForegroundColor Cyan
    Write-Host "The hosts file is located at: C:\Windows\System32\drivers\etc\hosts" -ForegroundColor Yellow
}
catch {
    Write-Host "❌ Could not resolve api.aiwaverider.com" -ForegroundColor Red
    Write-Host "DNS resolution error: $_" -ForegroundColor Gray
    
    Write-Host "`nSuggestion:" -ForegroundColor Yellow
    Write-Host "To test api.aiwaverider.com locally, you can add this entry to your hosts file:" -ForegroundColor Yellow
    Write-Host "127.0.0.1 api.aiwaverider.com" -ForegroundColor Cyan
    Write-Host "The hosts file is located at: C:\Windows\System32\drivers\etc\hosts" -ForegroundColor Yellow
}

# Check if Docker containers are running
Write-Host "`nChecking Docker containers:" -ForegroundColor Cyan
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}" | Select-String -Pattern "nginx_prod|backend_prod|redis_prod" 