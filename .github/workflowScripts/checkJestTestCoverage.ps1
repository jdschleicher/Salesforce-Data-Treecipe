
$expectedJestTestFailedSummaryPath = "./coverage/jest-results.json"
if ( -not(Test-Path $expectedJestTestFailedSummaryPath) ) {
  Write-Error "No JEST test File Generated"
  exit 1
}

$failedTestResults = $jestTest.testResults | Where-Object { $_.status -eq "failed" } 
if ( $failedTestResults.count -gt 0 ) {
  Write-Error "FAILED JEST TESTS - SEE BELOW:"
  $failedTestResults | Select-Object { $_  } -ExpandProperty message
  exit 1
}

$jestTest = Get-Content -Raw -Path $expectedJestTestFailedSummaryPath | ConvertFrom-Json
if ($jestTest.numFailedTests ) {
  Write-Error "Failed Jest Tests: ${ $jestTest.numFailedTests } "
}

$expectedTestCoverageSummaryPath = "./coverage/coverage-summary.json"
if ( -not(Test-Path $expectedTestCoverageSummaryPath) ) {
  Write-Error "No Coverage Summary File Generated"
  exit 1
}

$coverageSummary = Get-Content -Raw -Path $expectedTestCoverageSummaryPath | ConvertFrom-Json
$totalCoverage = $coverageSummary.total.lines.pct
Write-Host "Total coverage: $totalCoverage%"

if ($totalCoverage -lt 85) {
  Write-Error "Coverage is below 85%"
  exit 1
}