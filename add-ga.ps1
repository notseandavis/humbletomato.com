# Add Google Analytics 4 to all HTML files

$gaScript = @'
    <!-- Google Analytics 4 -->
    <!-- TODO: Replace G-XXXXXXXXXX with your actual GA4 Measurement ID -->
    <script async src="https://www.googletagmanager.com/gtag/js?id=G-XXXXXXXXXX"></script>
    <script>
        window.dataLayer = window.dataLayer || [];
        function gtag(){dataLayer.push(arguments);}
        gtag('js', new Date());
        gtag('config', 'G-XXXXXXXXXX');
    </script>
'@

# Find all HTML files
$htmlFiles = Get-ChildItem -Recurse -Filter *.html

Write-Host "Found $($htmlFiles.Count) HTML files"
Write-Host ""

foreach ($file in $htmlFiles) {
    Write-Host "Processing: $($file.Name)"
    
    $content = Get-Content $file.FullName -Raw -Encoding UTF8
    
    # Check if GA is already present
    if ($content -match 'googletagmanager\.com/gtag/js') {
        Write-Host "  GA already exists, skipping"
        continue
    }
    
    # Add GA script right before </head>
    $newContent = $content.Replace('</head>', $gaScript + "`r`n</head>")
    
    Set-Content -Path $file.FullName -Value $newContent -NoNewline -Encoding UTF8
    Write-Host "  Added GA4 tracking"
}

Write-Host ""
Write-Host "Done! All HTML files have been updated."
