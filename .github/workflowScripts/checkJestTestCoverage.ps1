
$expectedTestCoverageSummaryPath = "./coverage/coverage-summary.json"
if ( -not(Test-Path $expectedTestCoverageSummaryPath) ) {
  Write-Error "No Coverage Summary File Generated"
}

$coverageSummary = Get-Content -Raw -Path $expectedTestCoverageSummaryPath | ConvertFrom-Json
$totalCoverage = $coverageSummary.total.lines.pct
Write-Host "Total coverage: $totalCoverage%"

if ($totalCoverage -lt 85) {
  Write-Error "Coverage is below 85%"
  exit 1
}