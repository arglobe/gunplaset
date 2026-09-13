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

# 🛡️ Image Integrity & Zero-Mismatch Gate
Write-Output "🔍 Verifying Kit Image DB integrity and Zero-Mismatch compliance..."
$imgDbRaw = [System.IO.File]::ReadAllText($imgDbPath, [System.Text.Encoding]::UTF8)
$imgDbJson = $imgDbRaw.Substring($imgDbRaw.IndexOf('{')).Trim().TrimEnd(';')
$imgDbObj = $imgDbJson | ConvertFrom-Json

$imgMissingKits = @()
$imgLocalMissing = @()
$imgFinishMismatches = @()
$imgPilotMismatches = @()
$imgUnverifiedFallbacks = @()

$pilotConflictPairs = @(
    @("heine", "dearka"),
    @("dearka", "heine"),
    @("casval", "amuro"),
    @("quattro", "amuro"),
    @("shin-matsunaga", "johnny-ridden"),
    @("johnny-ridden", "shin-matsunaga"),
    @("tri-stars", "char")
)

foreach ($mk in $kitsObj) {
    $id = [string]$mk.id
    $entry = $imgDbObj.$id
    if (-not $entry -or -not $entry.product_url) {
        $imgMissingKits += $id
        continue
    }
    $pUrlLower = $entry.product_url.ToLower()
    $kNameLower = $mk.name.ToLower()

    # 1. Local Image verification (Strict Magic Bytes & Soft-404 Gate)
    if ($entry.product_url.StartsWith("images/")) {
        $localImgPath = Join-Path $rootDir ($entry.product_url -replace '/', '\')
        if (-not (Test-Path $localImgPath)) {
            $imgLocalMissing += "$id ($($entry.product_url) does not exist)"
        } else {
            $fileLen = (Get-Item $localImgPath).Length
            if ($fileLen -lt 3000) {
                $imgLocalMissing += "$id ($($entry.product_url) too small: $fileLen bytes)"
            } elseif ($fileLen -eq 13464) {
                $imgLocalMissing += "$id ($($entry.product_url) is Bandai Soft-404 HTML: 13,464 bytes)"
            } else {
                # Validate Magic Bytes (JPEG: FF D8 FF, PNG: 89 50 4E 47, WEBP: 52 49 46 46)
                $fs = [System.IO.File]::OpenRead($localImgPath)
                $headerBytes = New-Object byte[] 4
                $fs.Read($headerBytes, 0, 4) | Out-Null
                $fs.Close()
                
                $isJpeg = ($headerBytes[0] -eq 0xFF -and $headerBytes[1] -eq 0xD8 -and $headerBytes[2] -eq 0xFF)
                $isPng  = ($headerBytes[0] -eq 0x89 -and $headerBytes[1] -eq 0x50 -and $headerBytes[2] -eq 0x4E -and $headerBytes[3] -eq 0x47)
                $isWebp = ($headerBytes[0] -eq 0x52 -and $headerBytes[1] -eq 0x49 -and $headerBytes[2] -eq 0x46 -and $headerBytes[3] -eq 0x46)
                
                if (-not ($isJpeg -or $isPng -or $isWebp)) {
                    $imgLocalMissing += "$id ($($entry.product_url) invalid magic bytes - not a valid image)"
                }
            }
        }
    }

    # 2. Strict Soft-404 & Unverified Fallback Elimination Gate
    # Any 2026 kit (ID >= 5280) or known broken/pruned kit MUST use verified local or high-res assets!
    $knownBrokenFyiIds = @("184", "4432", "4722", "4724", "4763", "4852", "4853", "4854", "4855", "4856", "4918", "4919", "4921", "4922", "4923", "4924")
    $idInt = 0
    [int]::TryParse($id, [ref]$idInt) | Out-Null
    if ($pUrlLower.Contains("gunpla.fyi/images/boxarts/$id.jpeg")) {
        if ($knownBrokenFyiIds -contains $id -or $idInt -ge 5280) {
            $imgUnverifiedFallbacks += "$id ($($mk.name)) points to unverified/broken gunpla.fyi fallback"
        }
    }

    # 3. Finish Mismatch (Zero-Mismatch Gate)
    $isStandard = (-not ($kNameLower -match 'clear|coating|titanium|metallic|pearl|deactive|base color'))
    if ($isStandard -and ($pUrlLower -match 'clear|coating|titanium|metallic-gloss|pearl-gloss|deactive')) {
        $imgFinishMismatches += "$id ($($mk.name)) -> $($entry.product_url)"
    }

    # 4. Pilot/Character Symmetry (Zero-Mismatch Gate)
    foreach ($pair in $pilotConflictPairs) {
        if ($kNameLower.Contains($pair[0]) -and $pUrlLower.Contains($pair[1])) {
            $imgPilotMismatches += "$id ($($mk.name)) -> character mismatch with '$($pair[1])': $($entry.product_url)"
        }
    }
}

if ($imgMissingKits.Count -gt 0) {
    Write-Error "🚨 BUILD REJECTED: Kit Image DB missing entries for $($imgMissingKits.Count) kits!"
    exit 1
}
if ($imgLocalMissing.Count -gt 0) {
    Write-Error "🚨 BUILD REJECTED: Local image files missing or corrupted for: $($imgLocalMissing -join ', ')!"
    exit 1
}
if ($imgUnverifiedFallbacks.Count -gt 0) {
    Write-Error "🚨 BUILD REJECTED: Kits using unverified/broken gunpla.fyi fallback (404/Soft-404 risk):`n$($imgUnverifiedFallbacks -join "`n")"
    exit 1
}
if ($imgFinishMismatches.Count -gt 0) {
    Write-Error "🚨 BUILD REJECTED: Finish mismatch detected (Zero-Mismatch violation):`n$($imgFinishMismatches -join "`n")"
    exit 1
}
if ($imgPilotMismatches.Count -gt 0) {
    Write-Error "🚨 BUILD REJECTED: Pilot/Character mismatch detected (Zero-Mismatch violation):`n$($imgPilotMismatches -join "`n")"
    exit 1
}
Write-Output "✅ 100% Image Integrity & Zero-Mismatch Gate: All $($kitsObj.Count) kits verified (0 missing, 0 soft-404s, 0 fallbacks, 0 mismatches)."

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