if ((uname) -eq 'Darwin') {
    Write-Output "macOS"
    Set-Alias start open
}

### CLEAR OUT LATEST BUILD
$compileDirectory = "./out/"
If (Test-Path $compileDirectory ) {
    Remove-Item $compileDirectory -Recurse -Force
}

### CLEAR OUT LATEST CODE COVERAGE ARTIFACTS
$coverageDirectory = "./coverage/"
If (Test-Path $coverageDirectory ) {
    Remove-Item $coverageDirectory -Recurse -Force
}

### RECOMPILE
npm run compile

### RUN CONVERAGE TESTS
npm run jest-test

### OPEN UP COVERAGE REPORT IN BROWSER BASED ON EXPECTED ROOT DIRECTORY CREATION OF COVERAGE FOLDER
start ./coverage/lcov-report/index.html
