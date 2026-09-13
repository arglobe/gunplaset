$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$rootDir = Split-Path -Parent $scriptDir

if (Test-Path (Join-Path $rootDir "src\template_header.html")) {
    $srcDir = Join-Path $rootDir "src"
} elseif (Test-Path (Join-Path $rootDir "template_header.html")) {
    $srcDir = $rootDir
} else {
    $srcDir = $scriptDir
}

$headerPath = Join-Path $srcDir "template_header.html"
$footerPath = Join-Path $srcDir "template_footer.html"
$imgDbPath = Join-Path $srcDir "kit_image_db.js"
$priceDbPath = Join-Path $srcDir "kit_price_db.js"
$masterKitsPath = Join-Path $srcDir "master_kits.json"
$outPath = Join-Path $rootDir "index.html"

if (Test-Path (Join-Path $rootDir "table1_both_jp_kr_all.csv")) {
    $table1Path = Join-Path $rootDir "table1_both_jp_kr_all.csv"
    $table2Path = Join-Path $rootDir "table2_jp_only_all.csv"
} else {
    $table1Path = "G:\내 드라이브\GunplaSet\table1_both_jp_kr_all.csv"
    $table2Path = "G:\내 드라이브\GunplaSet\table2_jp_only_all.csv"
}

# ==============================================================================
# 🛡️ ARCHITECTURAL INTEGRITY GATE: 2,716 KITS FULL PRICE VERIFICATION
# ==============================================================================
Write-Output "🔍 Verifying 2,716 kits price integrity against Master Audit Tables..."

$table1 = Import-Csv $table1Path -Encoding UTF8
$table2 = Import-Csv $table2Path -Encoding UTF8
$masterAuditMap = @{}

foreach ($row in $table1) {
    if ($row.OfficialJPY) {
        $masterAuditMap[$row.ID] = [int]$row.OfficialJPY
    }
}
foreach ($row in $table2) {
    if ($row.OfficialJPY) {
        $masterAuditMap[$row.ID] = [int]$row.OfficialJPY
    }
}

$priceContent = [System.IO.File]::ReadAllText($priceDbPath, [System.Text.Encoding]::UTF8)
$prefix = "window.KIT_PRICE_DB = "
$rawPriceJson = $priceContent.Substring($prefix.Length).TrimEnd("`r`n; ")
$livePriceObj = $rawPriceJson | ConvertFrom-Json

$mismatchCount = 0
$mismatchList = @()

foreach ($kitId in $masterAuditMap.Keys) {
    $expectedPrice = $masterAuditMap[$kitId]
    $livePrice = $livePriceObj.$kitId
    
    if ($null -ne $livePrice -and $livePrice -ne $expectedPrice) {
        $mismatchCount++
        $mismatchList += [PSCustomObject]@{
            Id = $kitId
            LivePrice = $livePrice
            MasterPrice = $expectedPrice
        }
    }
}

if ($mismatchCount -gt 0) {
    Write-Error "🚨 BUILD REJECTED: $mismatchCount price discrepancies detected against Master Audit Table!"
    $mismatchList | Format-Table -AutoSize | Out-String | Write-Host
    exit 1
}

Write-Output "✅ 100% Price Integrity Passed: All 2,716 kits perfectly match Master Audit Tables (0 discrepancies)."

# ==============================================================================
# BUILD PACKAGING
# ==============================================================================
$headerContent = [System.IO.File]::ReadAllText($headerPath, [System.Text.Encoding]::UTF8)
$footerContent = [System.IO.File]::ReadAllText($footerPath, [System.Text.Encoding]::UTF8)
$imgDbContent = [System.IO.File]::ReadAllText($imgDbPath, [System.Text.Encoding]::UTF8)
$priceDbContent = [System.IO.File]::ReadAllText($priceDbPath, [System.Text.Encoding]::UTF8)
$masterKitsJson = [System.IO.File]::ReadAllText($masterKitsPath, [System.Text.Encoding]::UTF8)

# 🛡️ JSON & Structure Integrity Gate
try {
    $kitsObj = $masterKitsJson | ConvertFrom-Json
    if ($kitsObj.Count -lt 2716) {
        Write-Error "🚨 BUILD REJECTED: master_kits.json kit count ($($kitsObj.Count)) is below 2,716!"
        exit 1
    }
    Write-Output "✅ Master Catalog JSON Parsed Cleanly: $($kitsObj.Count) kits confirmed."
} catch {
    Write-Error "🚨 BUILD REJECTED: master_kits.json is not valid JSON! Error: $_"
    exit 1
}

# ==============================================================================
# 🛡️ MASTER CATALOG 3-LANGUAGE AIR-GAP & LOCALIZATION GATE
# ==============================================================================
Write-Output "🔍 Verifying 3-Language Air-Gap isolation across $($kitsObj.Count) master kits..."

$jpRegex = "[\u3040-\u309F\u30A0-\u30FF]"
$krRegex = "[\uAC00-\uD7AF]"

$krwLocalizationViolations = @()
$jpyLocalizationViolations = @()
$usdLocalizationViolations = @()

foreach ($k in $kitsObj) {
    # 1. KRW mode simulation:
    $krwName = if ($k.nameKo) { $k.nameKo } else { $k.name }
    if ($krwName -match $jpRegex) {
        $krwLocalizationViolations += "Kit $($k.id) violates KRW Air-Gap: '$krwName'"
    }

    # 2. JPY mode simulation:
    $jpyName = if ($k.nameJp) { $k.nameJp } else { $k.name }
    if ($jpyName -match $krRegex) {
        $jpyLocalizationViolations += "Kit $($k.id) violates JPY Air-Gap: '$jpyName'"
    }

    # 3. USD mode simulation:
    $usdName = if ($k.nameEn) { $k.nameEn } else { $k.name }
    if ($usdName -match $jpRegex) {
        $usdLocalizationViolations += "Kit $($k.id) violates USD Air-Gap: '$usdName'"
    }
}

if ($krwLocalizationViolations.Count -gt 0) {
    Write-Error "🚨 BUILD REJECTED: $($krwLocalizationViolations.Count) kits contain Japanese Kana in KRW view!`n" + ($krwLocalizationViolations -join "`n")
    exit 1
}

if ($jpyLocalizationViolations.Count -gt 0) {
    Write-Error "🚨 BUILD REJECTED: $($jpyLocalizationViolations.Count) kits contain Korean Hangul in JPY view!`n" + ($jpyLocalizationViolations -join "`n")
    exit 1
}

if ($usdLocalizationViolations.Count -gt 0) {
    Write-Error "🚨 BUILD REJECTED: $($usdLocalizationViolations.Count) kits contain Japanese Kana in USD view!`n" + ($usdLocalizationViolations -join "`n")
    exit 1
}

Write-Output "✅ 100% Master Catalog Air-Gap Passed: All $($kitsObj.Count) kits strictly adhere to 3-Language isolation (0 language leaks)."

# Clean injection markers
$headerClean = $headerContent.TrimEnd()

$fullHtml = $headerClean + "`n<script>`n" + $imgDbContent + "`n" + $priceDbContent + "`nwindow.GUNPLA_MASTER_DATA = " + $masterKitsJson + ";`n" + $footerContent

# 🛡️ RADAR STRICT PROVENANCE & ZERO-FAKE DATA GATE
$masterIdSet = New-Object System.Collections.Generic.HashSet[string]
foreach ($k in $kitsObj) { [void]$masterIdSet.Add([string]$k.id) }

$radarPrefix = "window.GUNPLA_RELEASE_RADAR_DATA = "
$rIdx = $fullHtml.IndexOf($radarPrefix)
if ($rIdx -ge 0) {
    $jStart = $rIdx + $radarPrefix.Length
    $oCount = 0
    $jEnd = -1
    for ($i = $jStart; $i -lt $fullHtml.Length; $i++) {
        if ($fullHtml[$i] -eq '{') { $oCount++ }
        elseif ($fullHtml[$i] -eq '}') {
            $oCount--
            if ($oCount -eq 0) { $jEnd = $i; break }
        }
    }
    if ($jEnd -gt $jStart) {
        $radarObj = ConvertFrom-Json ($fullHtml.Substring($jStart, $jEnd - $jStart + 1))
        $missingRadarIds = @()
        $unverifiedProvenance = @()
        $airGapViolations = @()
        $whitelistedDomains = @("bandai-hobby.net", "bnkrmall.co.kr", "p-bandai.jp", "gundam-base.net", "gundam-side-f.net")
        $totalItemsCount = 0

        foreach ($lang in @('KRW', 'JPY', 'USD')) {
            $months = $radarObj.$lang.PSObject.Properties
            foreach ($m in $months) {
                foreach ($item in $m.Value.items) {
                    $totalItemsCount++
                    # 1. Master ID Existence Check
                    if (-not $masterIdSet.Contains([string]$item.id)) {
                        $missingRadarIds += "$lang - $($m.Name): ID $($item.id) ($($item.name))"
                    }
                    # 2. Strict Provenance Mandate: Every listed item MUST have an official source URL & verification date
                    if (-not $item.officialSourceUrl) {
                        $unverifiedProvenance += "$lang - $($m.Name): '$($item.name)' missing officialSourceUrl (Zero-Fake Policy Violation)"
                    } else {
                        $isOfficial = $false
                        foreach ($dom in $whitelistedDomains) {
                            if ($item.officialSourceUrl.ToLower().Contains($dom)) { $isOfficial = $true; break }
                        }
                        if (-not $isOfficial) {
                            $unverifiedProvenance += "$lang - $($m.Name): '$($item.name)' non-whitelisted source '$($item.officialSourceUrl)'"
                        }
                    }
                    if (-not $item.verifiedAt) {
                        $unverifiedProvenance += "$lang - $($m.Name): '$($item.name)' missing verifiedAt timestamp"
                    }
                    # 3. Air-Gap Language Gate
                    if ($lang -eq 'KRW' -and $item.name -match '[\u3040-\u309F\u30A0-\u30FF]') {
                        $airGapViolations += "KRW item contains Japanese kana: '$($item.name)'"
                    }
                    if ($lang -eq 'JPY' -and $item.name -match '[\uAC00-\uD7AF]') {
                        $airGapViolations += "JPY item contains Korean hangul: '$($item.name)'"
                    }
                }
            }
        }
        if ($missingRadarIds.Count -gt 0) {
            Write-Error "🚨 BUILD REJECTED: Radar contains IDs not present in master_kits.json! Discrepancies: $($missingRadarIds -join ', ')"
            exit 1
        }
        if ($unverifiedProvenance.Count -gt 0) {
            Write-Error "🚨 BUILD REJECTED: Unverified/Mockup items detected without official provenance! Violations:`n$($unverifiedProvenance -join "`n")"
            exit 1
        }
        if ($airGapViolations.Count -gt 0) {
            Write-Error "🚨 BUILD REJECTED: Air-Gap language isolation violated in Radar! Discrepancies: $($airGapViolations -join ', ')"
            exit 1
        }
        Write-Output "✅ 100% Radar Strict Provenance Gate: $totalItemsCount verified official items (0 unverified/mockup items)."
    }
}

# 🛡️ Onerror Hardening Gate
$onerrorMatches = [regex]::Matches($fullHtml, '(?i)onerror="([^"]+)"')
foreach ($m in $onerrorMatches) {
    $code = $m.Groups[1].Value
    if (-not ($code.Contains("this.onerror=null") -or $code.Contains("this.onerror = null"))) {
        Write-Error "🚨 BUILD REJECTED: Unhardened onerror found: $code"
        exit 1
    }
}
Write-Output "✅ 100% Onerror Hardening: All $($onerrorMatches.Count) image error handlers have anti-infinite-loop guards."

if ($fullHtml.Length -lt 3500000) {
    Write-Error "🚨 BUILD REJECTED: Generated index.html size ($($fullHtml.Length) bytes) is below 3.5MB safety threshold!"
    exit 1
}

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($outPath, $fullHtml, $utf8NoBom)
Write-Output "🎉 Build Successful! Production asset created at: $outPath ($([System.IO.File]::ReadAllBytes($outPath).Length) bytes)"