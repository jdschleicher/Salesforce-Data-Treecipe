<#
.SYNOPSIS
    End-to-end walkthrough of Treecipe picklist dependency testing against a scratch org.

.DESCRIPTION
    Stands up a scratch org containing a deliberately dependent picklist, generates Apex contract
    tests from the LOCAL source metadata, deploys and runs them, then rewires the dependency IN THE
    ORG ONLY so the check fails the way it would when an admin quietly changes a dependency.

    That last step is the point of the whole exercise. A check that only ever passes proves nothing;
    this proves the check detects real drift, names it, and exits non-zero.

    Steps run in order and each is idempotent enough to re-run on its own.

.PARAMETER Step
    Which step to run. 'All' runs Preflight through Check. Drift, Restore and Teardown are opt-in
    because they mutate or destroy the org.

      Preflight  verify sf CLI, Dev Hub, node, compiled output
      Scaffold   write the scratch definition and the sample dependent-picklist metadata
      CreateOrg  create the scratch org
      Deploy     deploy the sample object and the Apex framework classes
      Generate   generate PicklistDependencySpecs.cls and PicklistDependencySpecsTest.cls
      Check      deploy the generated classes, run them, write artifacts   -> expect PASS
      Drift      rewire the dependency in the org only, re-run             -> expect FAIL
      Restore    put the org dependency back, re-run                       -> expect PASS
      Teardown   delete the scratch org

.PARAMETER ScratchOrgAlias
    Alias for the scratch org. Defaults to treecipe-picklist-demo.

.PARAMETER DevHubAlias
    Dev Hub to create the scratch org against. Defaults to the CLI's configured Dev Hub.

.PARAMETER DurationDays
    Scratch org lifetime, 1 to 30. Defaults to 7.

.EXAMPLE
    ./Invoke-PicklistDependencyDemo.ps1
    Runs Preflight through Check and leaves a passing org in place.

.EXAMPLE
    ./Invoke-PicklistDependencyDemo.ps1 -Step Drift
    Rewires the dependency in the org and shows the check failing.

.NOTES
    The scratch org is NOT deleted automatically. Run -Step Teardown when finished.
#>

[CmdletBinding()]
param(
    [ValidateSet('All', 'Preflight', 'Scaffold', 'CreateOrg', 'Deploy', 'Generate', 'Check', 'Drift', 'Restore', 'Teardown')]
    [string]$Step = 'All',

    [string]$ScratchOrgAlias = 'treecipe-picklist-demo',

    [string]$DevHubAlias,

    [ValidateRange(1, 30)]
    [int]$DurationDays = 7
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# --------------------------------------------------------------------------------------------------
# Paths and constants
# --------------------------------------------------------------------------------------------------

$RepoRoot          = (Resolve-Path (Join-Path $PSScriptRoot '..' '..')).Path
$ConfigDir         = Join-Path $RepoRoot 'config'
$ScratchDefPath    = Join-Path $ConfigDir 'project-scratch-def.json'
$PackageDir        = Join-Path $RepoRoot 'force-app'
$ObjectsDir        = Join-Path $PackageDir 'main/default/objects'
$ClassesDir        = Join-Path $PackageDir 'main/default/classes'
$DemoObjectApiName = 'Treecipe_Demo__c'
$DemoObjectDir     = Join-Path $ObjectsDir $DemoObjectApiName
$DemoFieldsDir     = Join-Path $DemoObjectDir 'fields'
$HeadlessDriver    = Join-Path $PSScriptRoot 'treecipe-headless.js'
$ApiVersion        = '64.0'

# The eight classes the check owns. Deployed by name so unrelated Apex in the package directory is
# never swept into the org alongside them.
$OwnedClassNames = @(
    'IPicklistDependencySource',
    'PicklistDependencySpec',
    'PicklistDependencySnapshot',
    'PicklistDependencyReport',
    'PicklistDependencyValidator',
    'SchemaPicklistDependencySource',
    'PicklistDependencySpecs',
    'PicklistDependencySpecsTest'
)

# --------------------------------------------------------------------------------------------------
# Output helpers
# --------------------------------------------------------------------------------------------------

function Write-Step   { param([string]$Message) Write-Host "`n=== $Message ===" -ForegroundColor Cyan }
function Write-Info   { param([string]$Message) Write-Host "    $Message" -ForegroundColor Gray }
function Write-Good   { param([string]$Message) Write-Host "  + $Message" -ForegroundColor Green }
function Write-Warn   { param([string]$Message) Write-Host "  ! $Message" -ForegroundColor Yellow }
function Write-Bad    { param([string]$Message) Write-Host "  x $Message" -ForegroundColor Red }

function Stop-WithError {
    param([string]$Message)
    Write-Bad $Message
    exit 1
}

# The CLI is a .cmd shim on Windows. PowerShell resolves and invokes it correctly, so unlike the
# Node callers in this repo there is no CVE-2024-27980 EINVAL problem to work around here.
function Get-SalesforceCliName {
    if (Get-Command 'sf' -ErrorAction SilentlyContinue) { return 'sf' }
    return $null
}

<#
    Runs an sf command with --json and returns the parsed payload.

    A non-zero exit is NOT treated as failure by itself: a failing Apex test run and a deploy with
    component errors both exit non-zero while still writing the payload that explains why, and that
    payload is exactly what the caller needs. Only unparseable output is fatal.
#>
function Invoke-SalesforceJson {
    param(
        [Parameter(Mandatory)][string[]]$Arguments,
        [switch]$AllowNonZeroExit
    )

    Write-Info "sf $($Arguments -join ' ')"

    $stdout = & sf @Arguments 2>$null
    $exitCode = $LASTEXITCODE

    if (-not $stdout) {
        Stop-WithError "the Salesforce CLI returned no output for: sf $($Arguments -join ' ')"
    }

    try {
        $payload = $stdout | ConvertFrom-Json
    }
    catch {
        Stop-WithError "could not parse Salesforce CLI JSON output for: sf $($Arguments -join ' ')"
    }

    if ($exitCode -ne 0 -and -not $AllowNonZeroExit) {
        $detail = if ($payload.PSObject.Properties.Name -contains 'message') { $payload.message } else { "exit code $exitCode" }
        Stop-WithError "sf $($Arguments -join ' ') failed: $detail"
    }

    return $payload
}

# --------------------------------------------------------------------------------------------------
# Step: Preflight
# --------------------------------------------------------------------------------------------------

function Invoke-Preflight {

    Write-Step 'Preflight'

    if (-not (Get-SalesforceCliName)) {
        Stop-WithError 'the Salesforce CLI ("sf") is not installed or not on PATH. See https://developer.salesforce.com/tools/salesforcecli'
    }
    Write-Good 'Salesforce CLI found'

    if (-not (Get-Command 'node' -ErrorAction SilentlyContinue)) {
        Stop-WithError 'node is not installed or not on PATH.'
    }
    Write-Good "node found ($(node --version))"

    if (-not (Test-Path (Join-Path $RepoRoot 'package.json'))) {
        Stop-WithError "expected the repository root at $RepoRoot but found no package.json there."
    }

    # The headless driver calls the COMPILED services, so out/ must exist and be current.
    $compiledCheckService = Join-Path $RepoRoot 'out/treecipe/src/PicklistDependencyCheckService/PicklistDependencyCheckService.js'
    if (-not (Test-Path $compiledCheckService)) {
        Write-Warn 'compiled output missing — running npm run compile'
        Push-Location $RepoRoot
        try { npm run compile | Out-Null } finally { Pop-Location }
    }
    if (-not (Test-Path $compiledCheckService)) {
        Stop-WithError 'npm run compile did not produce the expected output under out/.'
    }
    Write-Good 'compiled services present'

    $devHubArguments = @('org', 'list', '--json')
    $orgList = Invoke-SalesforceJson -Arguments $devHubArguments

    $devHubs = @($orgList.result.devHubs)
    if ($devHubs.Count -eq 0) {
        Stop-WithError 'no Dev Hub is authorized. Run: sf org login web --set-default-dev-hub'
    }

    if ($DevHubAlias) {
        Write-Good "Dev Hub requested: $DevHubAlias"
    }
    else {
        $defaultDevHub = $devHubs | Select-Object -First 1
        Write-Good "Dev Hub available: $($defaultDevHub.alias ?? $defaultDevHub.username)"
    }
}

# --------------------------------------------------------------------------------------------------
# Step: Scaffold
# --------------------------------------------------------------------------------------------------

function Invoke-Scaffold {

    Write-Step 'Scaffold scratch definition and sample dependent-picklist metadata'

    if (-not (Test-Path $ConfigDir)) { New-Item -ItemType Directory -Path $ConfigDir -Force | Out-Null }

    if (Test-Path $ScratchDefPath) {
        Write-Info 'scratch definition already present, leaving it alone'
    }
    else {
        @'
{
    "orgName": "Treecipe Picklist Dependency Demo",
    "edition": "Developer",
    "features": [],
    "settings": {
        "lightningExperienceSettings": {
            "enableS1DesktopEnabled": true
        }
    }
}
'@ | Set-Content -Path $ScratchDefPath -Encoding utf8
        Write-Good "wrote $ScratchDefPath"
    }

    New-Item -ItemType Directory -Path $DemoFieldsDir -Force | Out-Null

    # The object itself. Nothing here is picklist specific -- it exists to hang the fields on.
    @"
<?xml version="1.0" encoding="UTF-8"?>
<CustomObject xmlns="http://soap.sforce.com/2006/04/metadata">
    <deploymentStatus>Deployed</deploymentStatus>
    <label>Treecipe Demo</label>
    <pluralLabel>Treecipe Demos</pluralLabel>
    <nameField>
        <label>Treecipe Demo Name</label>
        <type>Text</type>
    </nameField>
    <sharingModel>ReadWrite</sharingModel>
</CustomObject>
"@ | Set-Content -Path (Join-Path $DemoObjectDir "$DemoObjectApiName.object-meta.xml") -Encoding utf8

    # The CONTROLLING picklist.
    @'
<?xml version="1.0" encoding="UTF-8"?>
<CustomField xmlns="http://soap.sforce.com/2006/04/metadata">
    <fullName>City__c</fullName>
    <externalId>false</externalId>
    <label>City</label>
    <required>false</required>
    <trackTrending>false</trackTrending>
    <type>Picklist</type>
    <valueSet>
        <restricted>true</restricted>
        <valueSetDefinition>
            <sorted>false</sorted>
            <value><fullName>cle</fullName><default>false</default><label>cle</label></value>
            <value><fullName>eastlake</fullName><default>false</default><label>eastlake</label></value>
            <value><fullName>akron</fullName><default>false</default><label>akron</label></value>
        </valueSetDefinition>
    </valueSet>
</CustomField>
'@ | Set-Content -Path (Join-Path $DemoFieldsDir 'City__c.field-meta.xml') -Encoding utf8

    # The DEPENDENT picklist. valueSettings is what Treecipe reads to build the contract:
    #   cle      unlocks ohiocity and tremont
    #   eastlake unlocks willowick
    #   akron    unlocks nothing  -> emitted as expectNone
    Write-DependentFieldMetadata -IncludeTremont $true

    Write-Good "sample metadata written to $DemoObjectDir"
    Write-Info 'City__c (controlling) -> Neighborhood__c (dependent)'
    Write-Info 'cle: ohiocity, tremont | eastlake: willowick | akron: none'
}

<#
    Writes Neighborhood__c. The IncludeTremont switch is the lever the Drift step pulls: dropping
    that one valueSettings entry from the ORG copy, while local source still claims it, is exactly
    the drift an admin introduces by editing a dependency in Setup.
#>
function Write-DependentFieldMetadata {
    param([bool]$IncludeTremont)

    $tremontValueSetting = if ($IncludeTremont) {
@'
        <valueSettings>
            <controllingFieldValue>cle</controllingFieldValue>
            <valueName>tremont</valueName>
        </valueSettings>
'@
    } else { '' }

    @"
<?xml version="1.0" encoding="UTF-8"?>
<CustomField xmlns="http://soap.sforce.com/2006/04/metadata">
    <fullName>Neighborhood__c</fullName>
    <externalId>false</externalId>
    <label>Neighborhood</label>
    <required>false</required>
    <trackTrending>false</trackTrending>
    <type>Picklist</type>
    <valueSet>
        <controllingField>City__c</controllingField>
        <restricted>true</restricted>
        <valueSetDefinition>
            <sorted>false</sorted>
            <value><fullName>ohiocity</fullName><default>false</default><label>ohiocity</label></value>
            <value><fullName>tremont</fullName><default>false</default><label>tremont</label></value>
            <value><fullName>willowick</fullName><default>false</default><label>willowick</label></value>
        </valueSetDefinition>
        <valueSettings>
            <controllingFieldValue>cle</controllingFieldValue>
            <valueName>ohiocity</valueName>
        </valueSettings>
$tremontValueSetting
        <valueSettings>
            <controllingFieldValue>eastlake</controllingFieldValue>
            <valueName>willowick</valueName>
        </valueSettings>
    </valueSet>
</CustomField>
"@ | Set-Content -Path (Join-Path $DemoFieldsDir 'Neighborhood__c.field-meta.xml') -Encoding utf8
}

# --------------------------------------------------------------------------------------------------
# Step: CreateOrg
# --------------------------------------------------------------------------------------------------

function Invoke-CreateOrg {

    Write-Step "Create scratch org '$ScratchOrgAlias'"

    $existing = Invoke-SalesforceJson -Arguments @('org', 'list', '--json')
    $alreadyExists = @($existing.result.scratchOrgs) | Where-Object { $_.alias -eq $ScratchOrgAlias -and -not $_.isExpired }

    if ($alreadyExists) {
        Write-Info "scratch org '$ScratchOrgAlias' already exists and is not expired, reusing it"
        return
    }

    $createArguments = @(
        'org', 'create', 'scratch',
        '--definition-file', $ScratchDefPath,
        '--alias', $ScratchOrgAlias,
        '--duration-days', "$DurationDays",
        '--wait', '10',
        '--json'
    )
    if ($DevHubAlias) { $createArguments += @('--target-dev-hub', $DevHubAlias) }

    Write-Info 'this usually takes a minute or two...'
    $created = Invoke-SalesforceJson -Arguments $createArguments

    Write-Good "created $ScratchOrgAlias ($($created.result.username))"
}

# --------------------------------------------------------------------------------------------------
# Step: Deploy sample metadata and framework classes
# --------------------------------------------------------------------------------------------------

function Invoke-Deploy {

    Write-Step 'Deploy sample object and Apex framework classes'

    $frameworkClassPaths = $OwnedClassNames |
        Where-Object { $_ -notin @('PicklistDependencySpecs', 'PicklistDependencySpecsTest') } |
        ForEach-Object { Join-Path $ClassesDir "$_.cls" } |
        Where-Object { Test-Path $_ }

    if ($frameworkClassPaths.Count -eq 0) {
        Stop-WithError "no framework classes found in $ClassesDir"
    }

    $deployArguments = @('project', 'deploy', 'start', '--target-org', $ScratchOrgAlias, '--wait', '10', '--json')
    $deployArguments += @('--source-dir', $DemoObjectDir)
    foreach ($classPath in $frameworkClassPaths) { $deployArguments += @('--source-dir', $classPath) }

    $deployed = Invoke-SalesforceJson -Arguments $deployArguments -AllowNonZeroExit
    Assert-DeploySucceeded -DeployPayload $deployed

    Write-Good "deployed $DemoObjectApiName and $($frameworkClassPaths.Count) framework class(es)"
}

function Assert-DeploySucceeded {
    param([Parameter(Mandatory)]$DeployPayload)

    if ($DeployPayload.PSObject.Properties.Name -contains 'result' -and $DeployPayload.result.success -eq $true) {
        return
    }

    if ($DeployPayload.PSObject.Properties.Name -contains 'name' -and $DeployPayload.name -eq 'SourceConflictError') {
        Stop-WithError 'the org reports source conflicts. Resolve them, or re-run with a fresh scratch org.'
    }

    $failures = @()
    if ($DeployPayload.result -and $DeployPayload.result.details -and $DeployPayload.result.details.componentFailures) {
        $failures = @($DeployPayload.result.details.componentFailures)
    }

    if ($failures.Count -gt 0) {
        Write-Bad 'deploy failed:'
        foreach ($failure in $failures) { Write-Bad "    $($failure.fullName): $($failure.problem)" }
        exit 1
    }

    $detail = if ($DeployPayload.PSObject.Properties.Name -contains 'message') { $DeployPayload.message } else { 'unknown reason' }
    Stop-WithError "deploy failed: $detail"
}

# --------------------------------------------------------------------------------------------------
# Step: Generate the Apex contract tests from LOCAL source metadata
# --------------------------------------------------------------------------------------------------

function Invoke-Generate {

    Write-Step 'Generate Apex contract tests from local source metadata'

    Write-Info 'this mirrors the "Salesforce Treecipe: Generate Picklist Dependency Tests" command'
    Write-Info 'and calls the same compiled services the command calls'

    & node $HeadlessDriver generate $ObjectsDir $ClassesDir $ApiVersion
    if ($LASTEXITCODE -ne 0) { Stop-WithError 'spec generation failed.' }

    $specsPath = Join-Path $ClassesDir 'PicklistDependencySpecs.cls'
    $testPath  = Join-Path $ClassesDir 'PicklistDependencySpecsTest.cls'

    if (-not (Test-Path $specsPath) -or -not (Test-Path $testPath)) {
        Stop-WithError 'generation reported success but the expected classes are not on disk.'
    }

    Write-Good 'PicklistDependencySpecs.cls and PicklistDependencySpecsTest.cls generated'
    Write-Info "review them at $ClassesDir"
}

# --------------------------------------------------------------------------------------------------
# Step: Check
# --------------------------------------------------------------------------------------------------

<#
    Deploys all eight owned classes in ONE transaction, mirroring what the "Run Picklist Dependency
    Check" command does.

    Deploying only the two generated classes would be wrong twice over. It would diverge from the
    shipped behaviour this script exists to demonstrate, and it would invent an ordering dependency
    the product does not have: the generated classes do not compile without the framework, so a
    deploy containing only them fails against a fresh org with "Invalid type: PicklistDependencySpec".
    Salesforce compiles a deployment set as a unit, so sending all eight together needs no prior
    framework deploy at all.
#>
function Invoke-DeployOwnedClasses {

    $ownedClassPaths = $OwnedClassNames |
        ForEach-Object { Join-Path $ClassesDir "$_.cls" } |
        Where-Object { Test-Path $_ }

    $generatedClassPaths = $ownedClassPaths | Where-Object { $_ -match 'PicklistDependencySpecs(Test)?\.cls$' }

    if ($generatedClassPaths.Count -lt 2) {
        Stop-WithError 'generated classes are missing. Run -Step Generate first.'
    }

    $deployArguments = @('project', 'deploy', 'start', '--target-org', $ScratchOrgAlias, '--wait', '10', '--json')
    foreach ($ownedClassPath in $ownedClassPaths) { $deployArguments += @('--source-dir', $ownedClassPath) }

    $deployed = Invoke-SalesforceJson -Arguments $deployArguments -AllowNonZeroExit
    Assert-DeploySucceeded -DeployPayload $deployed
    Write-Good "deployed $($ownedClassPaths.Count) owned class(es) in one transaction"
}

function Invoke-Check {
    param([string]$ExpectedOutcome = 'PASS')

    Write-Step "Run the picklist dependency check (expecting $ExpectedOutcome)"

    Invoke-DeployOwnedClasses

    Write-Info 'this mirrors the "Salesforce Treecipe: Run Picklist Dependency Check" command'
    & node $HeadlessDriver check $ScratchOrgAlias $RepoRoot
    $checkExitCode = $LASTEXITCODE

    if ($checkExitCode -eq 2) {
        Stop-WithError 'the check could not run.'
    }

    $actualOutcome = if ($checkExitCode -eq 0) { 'PASS' } else { 'FAIL' }

    if ($actualOutcome -eq $ExpectedOutcome) {
        Write-Good "check reported $actualOutcome, as expected"
    }
    else {
        Write-Bad "check reported $actualOutcome but $ExpectedOutcome was expected"
        exit 1
    }

    Write-Info "artifacts under $(Join-Path $RepoRoot 'treecipe/PicklistDependencyResults')"
    return $actualOutcome
}

# --------------------------------------------------------------------------------------------------
# Step: Drift  --  the step that proves the check is worth running
# --------------------------------------------------------------------------------------------------

function Invoke-Drift {

    Write-Step 'Simulate an admin rewiring the dependency in the org'

    Write-Info 'removing "cle -> tremont" from the ORG copy of Neighborhood__c'
    Write-Info 'local source metadata is left untouched, so it still claims that combination exists'
    Write-Info 'this is exactly the drift the contract test exists to catch'

    # Write the reduced field, deploy ONLY that field, then restore the local file immediately so
    # source keeps asserting the original contract. The org and source now genuinely disagree.
    Write-DependentFieldMetadata -IncludeTremont $false

    $deployArguments = @(
        'project', 'deploy', 'start',
        '--source-dir', (Join-Path $DemoFieldsDir 'Neighborhood__c.field-meta.xml'),
        '--target-org', $ScratchOrgAlias, '--wait', '10', '--json'
    )
    $deployed = Invoke-SalesforceJson -Arguments $deployArguments -AllowNonZeroExit
    Assert-DeploySucceeded -DeployPayload $deployed

    Write-DependentFieldMetadata -IncludeTremont $true
    Write-Good 'org dependency reduced; local source restored to the original contract'

    # Regeneration is deliberately skipped: the existing specs are the contract, and they must now
    # fail. Regenerating here would rewrite the contract to match the drift and hide the problem.
    Invoke-Check -ExpectedOutcome 'FAIL' | Out-Null

    Write-Host ''
    Write-Good 'drift detected exactly as intended'
    Write-Info 'open the newest report.md under treecipe/PicklistDependencyResults to see the failure detail'
    Write-Info 'run -Step Restore to put the org back'
}

function Invoke-Restore {

    Write-Step 'Restore the org dependency'

    Write-DependentFieldMetadata -IncludeTremont $true

    $deployArguments = @(
        'project', 'deploy', 'start',
        '--source-dir', (Join-Path $DemoFieldsDir 'Neighborhood__c.field-meta.xml'),
        '--target-org', $ScratchOrgAlias, '--wait', '10', '--json'
    )
    $deployed = Invoke-SalesforceJson -Arguments $deployArguments -AllowNonZeroExit
    Assert-DeploySucceeded -DeployPayload $deployed

    Write-Good 'org dependency restored'
    Invoke-Check -ExpectedOutcome 'PASS' | Out-Null
}

# --------------------------------------------------------------------------------------------------
# Step: Teardown
# --------------------------------------------------------------------------------------------------

function Invoke-Teardown {

    Write-Step "Delete scratch org '$ScratchOrgAlias'"

    Invoke-SalesforceJson -Arguments @('org', 'delete', 'scratch', '--target-org', $ScratchOrgAlias, '--no-prompt', '--json') | Out-Null
    Write-Good "deleted $ScratchOrgAlias"
    Write-Info "sample metadata under $DemoObjectDir was left in place; remove it by hand if you no longer want it"
}

# --------------------------------------------------------------------------------------------------
# Dispatch
# --------------------------------------------------------------------------------------------------

Write-Host ''
Write-Host 'Treecipe -- Picklist Dependency Contract Testing Demo' -ForegroundColor White
Write-Host "repository: $RepoRoot" -ForegroundColor DarkGray
Write-Host "scratch org alias: $ScratchOrgAlias" -ForegroundColor DarkGray

switch ($Step) {
    'All' {
        Invoke-Preflight
        Invoke-Scaffold
        Invoke-CreateOrg
        Invoke-Deploy
        Invoke-Generate
        Invoke-Check -ExpectedOutcome 'PASS' | Out-Null

        Write-Host ''
        Write-Step 'Done'
        Write-Good 'source metadata and org agree'
        Write-Info 'next: ./Invoke-PicklistDependencyDemo.ps1 -Step Drift   (prove the check catches a rewired dependency)'
        Write-Info 'then: ./Invoke-PicklistDependencyDemo.ps1 -Step Teardown (delete the scratch org)'
    }
    'Preflight' { Invoke-Preflight }
    'Scaffold'  { Invoke-Scaffold }
    'CreateOrg' { Invoke-CreateOrg }
    'Deploy'    { Invoke-Deploy }
    'Generate'  { Invoke-Generate }
    'Check'     { Invoke-Check -ExpectedOutcome 'PASS' | Out-Null }
    'Drift'     { Invoke-Drift }
    'Restore'   { Invoke-Restore }
    'Teardown'  { Invoke-Teardown }
}

Write-Host ''
