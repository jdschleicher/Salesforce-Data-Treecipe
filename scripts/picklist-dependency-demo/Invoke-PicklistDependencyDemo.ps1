<#
.SYNOPSIS
    End-to-end walkthrough of Treecipe picklist dependency testing against a scratch org.

.DESCRIPTION
    Stands up a scratch org containing a deliberately dependent picklist, generates Apex contract
    tests from the LOCAL source metadata, deploys and runs them, then rewires the dependency IN THE
    ORG ONLY so the check fails the way it would when an admin quietly changes a dependency.

    The repository itself is not a Salesforce DX project, so the demo stages a throwaway one under
    scripts/picklist-dependency-demo/demoSalesforceProject/ -- sfdx-project.json generated on the
    fly -- and runs everything against it, the same shape as a real user's workspace.

    That last step is the point of the whole exercise. A check that only ever passes proves nothing;
    this proves the check detects real drift, names it, and exits non-zero.

    Steps run in order and each is idempotent enough to re-run on its own.

.PARAMETER Step
    Which step to run. 'All' runs Preflight through Check. Drift, Restore and Teardown are opt-in
    because they mutate or destroy the org.

      Preflight  verify sf CLI, Dev Hub, node, compiled output
      Scaffold   generate the staging DX project (sfdx-project.json on the fly), copy the
                 framework classes into it, write the scratch definition and the sample
                 dependent-picklist metadata
      CreateOrg  create the scratch org
      Deploy     deploy the sample object and the Apex framework classes
      Generate   generate SDTPLDSpecs.cls, its per-object spec classes and SDTPLDSpecsTest.cls
      Check      deploy the generated classes, run them, write artifacts   -> expect PASS
      Verify     print what the ORG actually believes each dependency is
      Drift      rewire the dependency in the org only, re-run             -> expect FAIL
      Restore    REJECT the drift: put the org back, re-run                -> expect PASS
      Accept     ACCEPT the drift: pull it into local source, regenerate
                 the contract, redeploy and re-run                         -> expect PASS
      Teardown   delete the scratch org
      FullRun    the whole contract lifecycle: stand up, pass, drift, fail,
                 regenerate, pass

.PARAMETER ReuseExistingOrg
    Reuse a live scratch org carrying the same alias instead of replacing it. Off by default: a run
    is a clean-room verification, and an org left over from a previous run carries that run's drift,
    classes and source-tracking history. Useful while iterating on a single step.

.PARAMETER ForceOrgReplacement
    Allow CreateOrg to delete a live scratch org whose alias is NOT this script's own default.
    Without it, an alias the script does not recognise as its own is never deleted -- the alias is
    typed by hand (and surfaced through a VS Code task input), so it can easily name a colleague's
    shared org or a long-lived one of your own.

.PARAMETER Interactive
    Pause at the points where a human should actually look at something -- the generated Apex before
    it is deployed, and each drift report after it fails. Off by default so the same script can run
    unattended in CI.

.PARAMETER ScratchOrgAlias
    Alias for the scratch org. Defaults to treecipe-picklist-demo. A live org carrying this alias is
    replaced unless -ReuseExistingOrg is passed.

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
    [ValidateSet('All', 'Preflight', 'Scaffold', 'CreateOrg', 'Deploy', 'Generate', 'Check', 'Verify', 'Drift', 'Restore', 'Accept', 'Teardown', 'FullRun')]
    [string]$Step = 'All',

    [switch]$Interactive,

    [switch]$ReuseExistingOrg,

    [switch]$ForceOrgReplacement,

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

# This repository is a VS Code extension, not a Salesforce DX project. The demo therefore stages a
# throwaway DX project of its own -- sfdx-project.json generated on the fly, exactly like the
# Trailhead quick-start flow -- and every deploy, retrieve and generation runs against it. This is
# also the more faithful demo: the extension's real consumers run it against their own DX project,
# and this directory plays that role. Gitignored; -Step Scaffold rewrites it deterministically.
$StagingProjectDir = Join-Path $PSScriptRoot 'demoSalesforceProject'
$ConfigDir         = Join-Path $StagingProjectDir 'config'
$ScratchDefPath    = Join-Path $ConfigDir 'project-scratch-def.json'
$PackageDir        = Join-Path $StagingProjectDir 'force-app'
$ObjectsDir        = Join-Path $PackageDir 'main/default/objects'
$ClassesDir        = Join-Path $PackageDir 'main/default/classes'

# Where the framework's Apex source actually lives in this repository -- the same files the
# published .vsix carries and scaffolds into a user's project. Scaffold copies them into the
# staging project so the demo deploys byte-identical framework classes.
$ShippedFrameworkSourceDir = Join-Path $RepoRoot 'apexPicklistDependencyFramework/SDTPicklistDependencyFramework'
# The framework runtime classes live in their own directory. Salesforce resolves ApexClass by the
# enclosing "classes" directory and walks nested folders, so this deploys identically while keeping
# the six files the user did not write separate from the generated contract.
$FrameworkDir      = Join-Path $ClassesDir 'SDTPicklistDependencyFramework'
# The alias this script considers its own. Only an org carrying THIS alias is replaced without
# an explicit opt-in, because any other alias was typed by a human and may name an org they care about.
$OwnScratchOrgAlias = 'treecipe-picklist-demo'
$DemoObjectApiName = 'Treecipe_Demo__c'
$DemoObjectDir     = Join-Path $ObjectsDir $DemoObjectApiName
$DemoFieldsDir     = Join-Path $DemoObjectDir 'fields'
# The global value set backing Planet__c. Its VALUES live here; the DEPENDENCY markup still lives
# in the field file, which is the whole reason a global-value-set-backed picklist can be dependent.
$GlobalValueSetsDir  = Join-Path $PackageDir 'main/default/globalValueSets'
$PlanetsValueSetName = 'Planets'
$PlanetsValueSetPath = Join-Path $GlobalValueSetsDir "$PlanetsValueSetName.globalValueSet-meta.xml"
$HeadlessDriver    = Join-Path $PSScriptRoot 'treecipe-headless.js'
$ApiVersion        = '64.0'

# The framework runtime classes. Deployed by name so unrelated Apex in the package directory is
# never swept into the org alongside them.
$FrameworkClassNames = @(
    'ISDTPicklistDependencySource',
    'SDTPicklistDependencySpec',
    'SDTPicklistDependencySnapshot',
    'SDTPicklistDependencyReport',
    'SDTPicklistDependencyValidator',
    'SDTSchemaPicklistDependencySource'
)

# The aggregator and the test class. The per-object spec classes the aggregator calls into are NOT
# listed: there is one per object with a dependent picklist, so the set depends on the metadata and
# is discovered from disk by Get-GeneratedClassPath rather than hard coded here.
$GeneratedClassNames = @(
    'SDTPLDSpecs',
    'SDTPLDSpecsTest'
)

<#
    Every generated class on disk: the aggregator, the test class, and one spec class per object.

    The aggregator calls into the per-object classes, so a deploy carrying it without them fails to
    compile in the org. Globbing is what keeps this correct when the demo metadata gains or loses an
    object -- the same reason the Run Picklist Dependency Check command discovers them the same way.
#>
function Get-GeneratedClassPath {

    $generatedClassPaths = @(
        $GeneratedClassNames |
            ForEach-Object { Join-Path $ClassesDir "$_.cls" } |
            Where-Object { Test-Path $_ }
    )

    $perObjectClassPaths = @(
        Get-ChildItem -Path $ClassesDir -Filter 'SDTPLDSpecs_*.cls' -File -ErrorAction SilentlyContinue |
            Sort-Object Name |
            ForEach-Object { $_.FullName }
    )

    return @($generatedClassPaths) + $perObjectClassPaths
}

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

    # Project commands (deploy, retrieve) must run from inside a DX project. The staging project is
    # that project, so every sf invocation runs from it once it exists; org- and apex-level commands
    # are indifferent to cwd, so this is safe across the board.
    $runFromStagingProject = Test-Path (Join-Path $StagingProjectDir 'sfdx-project.json')
    if ($runFromStagingProject) { Push-Location $StagingProjectDir }
    try {
        $stdout = & sf @Arguments 2>$null
        $exitCode = $LASTEXITCODE
    }
    finally {
        if ($runFromStagingProject) { Pop-Location }
    }

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

<#
    Stops so a human can look at something the script cannot judge for itself, then continues.

    Only the -Interactive switch enables this. Unattended is the default because the same steps are
    meant to be runnable from CI, where a blocked Read-Host is a hung job rather than a checkpoint.
#>
function Suspend-ForReview {
    param(
        [Parameter(Mandatory)][string]$Prompt,
        [string[]]$LookAt = @()
    )

    if (-not $Interactive) { return }

    Write-Host ''
    Write-Host "  >> PAUSED -- $Prompt" -ForegroundColor Yellow
    foreach ($pathToOpen in $LookAt) {
        Write-Host "     open: $pathToOpen" -ForegroundColor DarkGray
    }
    Read-Host  '     press Enter to continue, Ctrl+C to stop here'
}

function Get-NewestReportPath {

    $resultsRoot = Join-Path $StagingProjectDir 'treecipe/PicklistDependencyResults'
    if (-not (Test-Path $resultsRoot)) { return $null }

    $newestRun = Get-ChildItem -Path $resultsRoot -Directory -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 1

    if (-not $newestRun) { return $null }
    return (Join-Path $newestRun.FullName 'report.md')
}

# --------------------------------------------------------------------------------------------------
# Org introspection
#
# Asks the org what it ACTUALLY believes each dependency is, rather than inferring it from a deploy
# result. A deploy reporting Succeeded says only that the payload was accepted -- it does not say the
# org changed, which is exactly how a drift step can silently do nothing.
# --------------------------------------------------------------------------------------------------

# The whole payload is one JSON object rather than delimited fields: Salesforce HTML-escapes the pipe
# character in debug logs (| becomes &#124;), so any separator-based format has to be un-escaped
# before it parses. A single JSON blob after the marker sidesteps that entirely.
$OrgDependencyMarker      = 'SDT_ORG_DEP='
$OrgDependencyErrorMarker = 'SDT_ORG_DEP_ERROR='

<#
    Returns an ordered map of "Object.Field" -> canonical text of the org's controlling-value map.

    The canonical text is what makes two reads comparable: controlling values sorted, and their
    unlocked values sorted, so a difference in the text is a real difference in the org rather than
    an artefact of Apex map ordering.
#>
function Get-OrgDependencyMap {

    $dumpApexPath = Join-Path ([System.IO.Path]::GetTempPath()) 'sdt-dump-org-dependencies.apex'

    @'
ISDTPicklistDependencySource dependencySource = new SDTSchemaPicklistDependencySource();

for (SDTPicklistDependencySpec spec : SDTPLDSpecs.all()) {
    try {
        SDTPicklistDependencySnapshot snapshot = dependencySource.fetch(spec);
        Map<String, List<String>> liveDependencyMap = new Map<String, List<String>>();

        for (String controllingValue : snapshot.controllingValues()) {
            Set<String> validValues = snapshot.valuesValidFor(controllingValue);
            List<String> sortedValues = validValues == null ? new List<String>() : new List<String>(validValues);
            sortedValues.sort();
            liveDependencyMap.put(controllingValue, sortedValues);
        }

        System.debug(LoggingLevel.ERROR, 'SDT_ORG_DEP=' + JSON.serialize(new Map<String, Object>{
            'key' => spec.objectApiName + '.' + spec.fieldApiName,
            'dependencyMap' => liveDependencyMap
        }));
    }
    catch (Exception dumpError) {
        System.debug(LoggingLevel.ERROR, 'SDT_ORG_DEP_ERROR=' + JSON.serialize(new Map<String, Object>{
            'key' => spec.objectApiName + '.' + spec.fieldApiName,
            'detail' => dumpError.getMessage()
        }));
    }
}
'@ | Set-Content -Path $dumpApexPath -Encoding utf8

    Write-Info "sf apex run --file <dump> --target-org $ScratchOrgAlias"
    $apexOutput = & sf apex run --file $dumpApexPath --target-org $ScratchOrgAlias 2>&1 | Out-String

    $dependencyMap = [ordered]@{}

    # Anchored on USER_DEBUG so the CLI's echo of the Apex source -- which contains the marker as a
    # string literal -- cannot be mistaken for output.
    foreach ($outputLine in ($apexOutput -split "`r?`n")) {

        if ($outputLine -notmatch 'USER_DEBUG') { continue }

        if ($outputLine -match 'USER_DEBUG.*' + [regex]::Escape($OrgDependencyErrorMarker) + '(?<json>\{.*)$') {
            $errorPayload = $Matches.json | ConvertFrom-Json
            Write-Warn "could not read $($errorPayload.key) from the org: $($errorPayload.detail)"
            continue
        }

        if ($outputLine -match 'USER_DEBUG.*' + [regex]::Escape($OrgDependencyMarker) + '(?<json>\{.*)$') {
            $payload = $Matches.json | ConvertFrom-Json
            $dependencyMap[$payload.key] = ConvertTo-CanonicalDependencyText -DependencyObject $payload.dependencyMap
        }
    }

    if ($dependencyMap.Count -eq 0) {
        Stop-WithError 'no dependency state came back from the org. The owned classes are probably not deployed -- run -Step Check first.'
    }

    return $dependencyMap
}

function ConvertTo-CanonicalDependencyText {
    param([Parameter(Mandatory)]$DependencyObject)

    $canonicalLines = @(
        $DependencyObject.PSObject.Properties |
            Sort-Object Name |
            ForEach-Object {
                $unlockedValues = @($_.Value) | Sort-Object
                "$($_.Name) => $($unlockedValues -join ', ')"
            }
    )

    return ($canonicalLines -join "`n")
}

# --------------------------------------------------------------------------------------------------
# Step: Verify
# --------------------------------------------------------------------------------------------------

function Invoke-Verify {

    Write-Step "What the org actually believes ('$ScratchOrgAlias')"

    $dependencyMap = Get-OrgDependencyMap

    foreach ($specKey in $dependencyMap.Keys) {
        Write-Host ''
        Write-Good $specKey
        foreach ($canonicalLine in ($dependencyMap[$specKey] -split "`n")) {
            Write-Info "  $canonicalLine"
        }
    }

    Write-Host ''
    Write-Info 'this is read live through SDTSchemaPicklistDependencySource, the same source the check uses'
    return $dependencyMap
}

<#
    The guard that makes a Drift phase trustworthy.

    A drift step whose deploy is a silent no-op hands back a PASS that looks identical to a healthy
    system. Salesforce MERGES valueSettings, so an omitted entry is accepted and ignored; this
    compares the org before and after and refuses to go on unless it genuinely moved.
#>
function Assert-OrgDependencyChanged {
    param(
        [Parameter(Mandatory)]$BeforeMap,
        [Parameter(Mandatory)]$AfterMap,
        [Parameter(Mandatory)][string]$SpecKey
    )

    if (-not $AfterMap.Contains($SpecKey)) {
        Stop-WithError "$SpecKey is not present in the org after the drift deploy."
    }

    if ($BeforeMap.Contains($SpecKey) -and $BeforeMap[$SpecKey] -eq $AfterMap[$SpecKey]) {
        Write-Bad "the drift deploy reported success but $SpecKey is UNCHANGED in the org."
        Write-Info 'Salesforce merges valueSettings: an entry omitted from the payload is not removed.'
        Write-Info 'Rewire an entry that is still present instead of leaving one out.'
        Stop-WithError 'refusing to run the check against an org that never drifted -- it would report a meaningless PASS.'
    }

    Write-Good "org state for $SpecKey genuinely changed"
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

    if (-not (Test-Path $ShippedFrameworkSourceDir)) {
        Stop-WithError "framework Apex source not found at $ShippedFrameworkSourceDir."
    }
    Write-Good 'framework Apex source present'

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

<#
    Stands up the staging DX project: sfdx-project.json written on the fly, and the framework
    classes copied in from their source of truth under apexPicklistDependencyFramework/.

    The copy is unconditional -- the staging project is disposable output, so the repo copy always
    wins and an edit to the framework source lands in the next run without a manual cleanup.
#>
function Initialize-DemoSalesforceProject {

    New-Item -ItemType Directory -Path $FrameworkDir -Force | Out-Null
    New-Item -ItemType Directory -Path $ConfigDir -Force | Out-Null

    $sfdxProjectPath = Join-Path $StagingProjectDir 'sfdx-project.json'
    @"
{
    "packageDirectories": [
        {
            "path": "force-app",
            "default": true
        }
    ],
    "name": "treecipe-picklist-dependency-demo",
    "namespace": "",
    "sfdcLoginUrl": "https://login.salesforce.com",
    "sourceApiVersion": "$ApiVersion"
}
"@ | Set-Content -Path $sfdxProjectPath -Encoding utf8
    Write-Good "wrote $sfdxProjectPath"

    foreach ($frameworkClassName in $FrameworkClassNames) {
        foreach ($suffix in @('.cls', '.cls-meta.xml')) {
            $sourceFilePath = Join-Path $ShippedFrameworkSourceDir "$frameworkClassName$suffix"
            if (-not (Test-Path $sourceFilePath)) {
                Stop-WithError "framework source file missing: $sourceFilePath"
            }
            Copy-Item -Path $sourceFilePath -Destination (Join-Path $FrameworkDir "$frameworkClassName$suffix") -Force
        }
    }
    Write-Good "copied $($FrameworkClassNames.Count) framework class(es) from $ShippedFrameworkSourceDir"
}

function Invoke-Scaffold {

    Write-Step 'Scaffold the staging DX project, scratch definition and sample dependent-picklist metadata'

    Initialize-DemoSalesforceProject

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
    Write-DependentFieldMetadata -Drifted $false

    # ------------------------------------------------------------------------------------------
    # The third tier. Both fields below are controlled by Neighborhood__c, which is ITSELF
    # dependent -- that is what exercises the generated `dependsOn` link. Dressing__c takes its
    # values from a local valueSetDefinition; Planet__c takes them from a global value set. The
    # two differ only in where the VALUES come from: the dependency markup is valueSettings in
    # the field file either way, which is precisely the case that used to parse as not dependent.
    # ------------------------------------------------------------------------------------------

    Write-GlobalValueSetMetadata

    # Chained, local values. "blue cheese" carries a space on purpose -- generated Apex has to
    # quote it correctly.
    @'
<?xml version="1.0" encoding="UTF-8"?>
<CustomField xmlns="http://soap.sforce.com/2006/04/metadata">
    <fullName>Dressing__c</fullName>
    <externalId>false</externalId>
    <label>Dressing</label>
    <required>false</required>
    <trackTrending>false</trackTrending>
    <type>Picklist</type>
    <valueSet>
        <controllingField>Neighborhood__c</controllingField>
        <restricted>true</restricted>
        <valueSetDefinition>
            <sorted>false</sorted>
            <value><fullName>ranch</fullName><default>false</default><label>ranch</label></value>
            <value><fullName>blue cheese</fullName><default>false</default><label>blue cheese</label></value>
            <value><fullName>french</fullName><default>false</default><label>french</label></value>
        </valueSetDefinition>
        <valueSettings>
            <controllingFieldValue>ohiocity</controllingFieldValue>
            <valueName>ranch</valueName>
        </valueSettings>
        <valueSettings>
            <controllingFieldValue>ohiocity</controllingFieldValue>
            <valueName>french</valueName>
        </valueSettings>
        <valueSettings>
            <controllingFieldValue>tremont</controllingFieldValue>
            <valueName>blue cheese</valueName>
        </valueSettings>
    </valueSet>
</CustomField>
'@ | Set-Content -Path (Join-Path $DemoFieldsDir 'Dressing__c.field-meta.xml') -Encoding utf8

    # Chained, GLOBAL values. This is the field the branch's fix exists for.
    Write-PlanetFieldMetadata -Drifted $false

    Write-Good "sample metadata written to $DemoObjectDir"
    Write-Good "global value set written to $PlanetsValueSetPath"
    Write-Info 'tier 1  City__c (plain)         -> cle, eastlake, akron'
    Write-Info 'tier 2  Neighborhood__c (local) -> cle: ohiocity, tremont | eastlake: willowick | akron: none'
    Write-Info 'tier 3  Dressing__c (local)     -> ohiocity: ranch, french | tremont: blue cheese | willowick: none'
    Write-Info 'tier 3  Planet__c (GLOBAL set)  -> ohiocity: earth, mars | tremont: venus | willowick: saturn'
}

<#
    The Planets global value set. Only the VALUES live here. Every value below is named by a
    valueSettings entry in Planet__c -- a global value set value with no valueSettings entry is
    unlocked by no controlling value and is deliberately not part of the generated contract.
#>
function Write-GlobalValueSetMetadata {

    New-Item -ItemType Directory -Path $GlobalValueSetsDir -Force | Out-Null

    @'
<?xml version="1.0" encoding="UTF-8"?>
<GlobalValueSet xmlns="http://soap.sforce.com/2006/04/metadata">
    <masterLabel>Planets</masterLabel>
    <sorted>false</sorted>
    <customValue><fullName>earth</fullName><default>false</default><label>earth</label></customValue>
    <customValue><fullName>mars</fullName><default>false</default><label>mars</label></customValue>
    <customValue><fullName>venus</fullName><default>false</default><label>venus</label></customValue>
    <customValue><fullName>saturn</fullName><default>false</default><label>saturn</label></customValue>
</GlobalValueSet>
'@ | Set-Content -Path $PlanetsValueSetPath -Encoding utf8
}

<#
    Writes Planet__c, whose values come from the Planets global value set rather than a local
    valueSetDefinition. The Drifted switch rewires "mars" from ohiocity to willowick, mirroring what
    the Neighborhood__c lever does for the local-valueSetDefinition path -- and for the same reason
    it rewires rather than omits.
#>
function Write-PlanetFieldMetadata {
    param([bool]$Drifted)

    $marsControllingValue = if ($Drifted) { 'willowick' } else { 'ohiocity' }

    $marsValueSetting = @"
        <valueSettings>
            <controllingFieldValue>$marsControllingValue</controllingFieldValue>
            <valueName>mars</valueName>
        </valueSettings>
"@

    @"
<?xml version="1.0" encoding="UTF-8"?>
<CustomField xmlns="http://soap.sforce.com/2006/04/metadata">
    <fullName>Planet__c</fullName>
    <externalId>false</externalId>
    <label>Planet</label>
    <required>false</required>
    <trackTrending>false</trackTrending>
    <type>Picklist</type>
    <valueSet>
        <controllingField>Neighborhood__c</controllingField>
        <restricted>true</restricted>
        <valueSetName>$PlanetsValueSetName</valueSetName>
        <valueSettings>
            <controllingFieldValue>ohiocity</controllingFieldValue>
            <valueName>earth</valueName>
        </valueSettings>
$marsValueSetting
        <valueSettings>
            <controllingFieldValue>tremont</controllingFieldValue>
            <valueName>venus</valueName>
        </valueSettings>
        <valueSettings>
            <controllingFieldValue>willowick</controllingFieldValue>
            <valueName>saturn</valueName>
        </valueSettings>
    </valueSet>
</CustomField>
"@ | Set-Content -Path (Join-Path $DemoFieldsDir 'Planet__c.field-meta.xml') -Encoding utf8
}

<#
    Writes Neighborhood__c. The Drifted switch is the lever the Drift step pulls: it REWIRES
    "tremont" from cle to eastlake, which is exactly what an admin does when they edit a dependency
    in Setup.

    Rewiring rather than deleting is not a stylistic choice. Salesforce MERGES valueSettings on a
    CustomField deploy -- an entry simply left out of the payload is not removed from the org, and
    the deploy comes back Succeeded, so a drift-by-omission silently does nothing and the check
    correctly reports PASS. Moving an entry that is still present is applied.

    The rewire is also the stronger assertion: cle loses tremont (MISSING_VALUES) and eastlake gains
    it (FORBIDDEN_VALUES_PRESENT), so it exercises expectAtLeast and the expectNotAllowed complement
    in a single step.
#>
function Write-DependentFieldMetadata {
    param([bool]$Drifted)

    $tremontControllingValue = if ($Drifted) { 'eastlake' } else { 'cle' }

    $tremontValueSetting = @"
        <valueSettings>
            <controllingFieldValue>$tremontControllingValue</controllingFieldValue>
            <valueName>tremont</valueName>
        </valueSettings>
"@

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

<#
    Creates the scratch org, replacing a live one carrying the same alias.

    A fresh org is the default because the run is a clean-room verification and a reused org is not
    one. An org left over from an earlier run holds that run's drift, its deployed classes and its
    source-tracking history, so a green result proves the feature works *there* rather than from
    nothing. Reuse is also what produced this harness's source-conflict failures.

    -ReuseExistingOrg opts back in, which is what you want while iterating on a single step against
    an org you already stood up.
#>
function Invoke-CreateOrg {

    Write-Step "Create scratch org '$ScratchOrgAlias'"

    $existing = Invoke-SalesforceJson -Arguments @('org', 'list', '--json')
    $liveOrgWithSameAlias = @(@($existing.result.scratchOrgs) | Where-Object { $_.alias -eq $ScratchOrgAlias -and -not $_.isExpired })

    if ($liveOrgWithSameAlias.Count -gt 0) {

        if ($ReuseExistingOrg) {
            Write-Info "scratch org '$ScratchOrgAlias' already exists and is not expired, reusing it as requested"
            return
        }

        <#
            Only an org carrying this script's OWN alias is deleted without an explicit opt-in.

            Any other alias reached this point because a human typed it -- the VS Code tasks surface
            it as a free-text input with a remembered history -- so it can just as easily name a
            colleague's shared org, or a long-lived one of your own, as a throwaway. Deleting that
            without asking is not a risk worth taking for a demo harness.

            sf org delete scratch refuses anything that is not a scratch org, so a sandbox or
            production org was never reachable here; this guard is about the orgs that ARE reachable.
        #>
        if ($ScratchOrgAlias -ne $OwnScratchOrgAlias -and -not $ForceOrgReplacement) {
            Write-Bad "a live scratch org '$ScratchOrgAlias' already exists, and that is not this script's own alias ('$OwnScratchOrgAlias')."
            Write-Info 'refusing to delete an org this script did not name. Choose one of:'
            Write-Info '  -ReuseExistingOrg      run against the org that is already there'
            Write-Info '  -ForceOrgReplacement   delete it and create a fresh one'
            Write-Info "  -ScratchOrgAlias $OwnScratchOrgAlias   use the script's own alias"
            Stop-WithError 'no org was created or deleted.'
        }

        Write-Warn "a live scratch org '$ScratchOrgAlias' already exists and will be DELETED so the run starts clean"
        Write-Info 'pass -ReuseExistingOrg to keep it instead'
        Invoke-SalesforceJson -Arguments @('org', 'delete', 'scratch', '--target-org', $ScratchOrgAlias, '--no-prompt', '--json') | Out-Null
        Write-Good "deleted the previous $ScratchOrgAlias"
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

    $frameworkClassPaths = @(
        $FrameworkClassNames |
            ForEach-Object { Join-Path $FrameworkDir "$_.cls" } |
            Where-Object { Test-Path $_ }
    )

    if ($frameworkClassPaths.Count -eq 0) {
        Stop-WithError "no framework classes found in $ClassesDir -- run -Step Scaffold first."
    }

    # --ignore-conflicts because this script AUTHORED every file it deploys. Source tracking flags a
    # conflict whenever the org and local both moved since the last sync, which -Step Accept causes
    # by design: it retrieves the org state, and the next Scaffold rewrites those same files. Local
    # is authoritative by construction here, so a conflict is expected rather than informative.
    # This reasoning is specific to a harness that owns its own metadata -- it is not advice for
    # deploying a real project.
    $deployArguments = @('project', 'deploy', 'start', '--target-org', $ScratchOrgAlias, '--wait', '10', '--ignore-conflicts', '--json')

    # The global value set must be in the SAME deployment as the object. Planet__c references it by
    # name, so an object-only deploy fails against a fresh org with an unknown value set.
    if (Test-Path $PlanetsValueSetPath) { $deployArguments += @('--source-dir', $PlanetsValueSetPath) }

    $deployArguments += @('--source-dir', $DemoObjectDir)
    foreach ($classPath in $frameworkClassPaths) { $deployArguments += @('--source-dir', $classPath) }

    $deployed = Invoke-SalesforceJson -Arguments $deployArguments -AllowNonZeroExit
    Assert-DeploySucceeded -DeployPayload $deployed

    Write-Good "deployed $PlanetsValueSetName, $DemoObjectApiName and $($frameworkClassPaths.Count) framework class(es)"
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

    $specsPath = Join-Path $ClassesDir 'SDTPLDSpecs.cls'
    $testPath  = Join-Path $ClassesDir 'SDTPLDSpecsTest.cls'

    if (-not (Test-Path $specsPath) -or -not (Test-Path $testPath)) {
        Stop-WithError 'generation reported success but the expected classes are not on disk.'
    }

    $perObjectClassPaths = @(@(Get-GeneratedClassPath) | Where-Object { $_ -match 'SDTPLDSpecs_' })

    if ($perObjectClassPaths.Count -eq 0) {
        Stop-WithError 'the aggregator was generated but no per-object spec class was. It would return an empty list.'
    }

    Write-Good "SDTPLDSpecs.cls, SDTPLDSpecsTest.cls and $($perObjectClassPaths.Count) per-object spec class(es) generated"
    Write-Info "review them at $ClassesDir"

    # The generated contract is the one artefact no assertion can grade for you: whether it captured
    # every dependent picklist, and captured them correctly, is a reading job.
    Suspend-ForReview -Prompt 'read the generated contract before it is deployed' -LookAt $perObjectClassPaths
}

# --------------------------------------------------------------------------------------------------
# Step: Check
# --------------------------------------------------------------------------------------------------

<#
    Deploys every owned class in ONE transaction, mirroring what the "Run Picklist Dependency
    Check" command does: the six framework classes, the aggregator, the test class, and one spec
    class per object.

    Deploying only the generated classes would be wrong twice over. It would diverge from the
    shipped behaviour this script exists to demonstrate, and it would invent an ordering dependency
    the product does not have: the generated classes do not compile without the framework, so a
    deploy containing only them fails against a fresh org with "Invalid type: SDTPicklistDependencySpec".
    Salesforce compiles a deployment set as a unit, so sending them all together needs no prior
    framework deploy at all.
#>
function Invoke-DeployOwnedClasses {

    # Framework classes resolve from their own directory; the generated contract stays at the root.
    $frameworkClassPaths = @(
        $FrameworkClassNames |
            ForEach-Object {
                $frameworkCandidate = Join-Path $FrameworkDir "$_.cls"
                if (Test-Path $frameworkCandidate) { $frameworkCandidate } else { Join-Path $ClassesDir "$_.cls" }
            } |
            Where-Object { Test-Path $_ }
    )

    $generatedClassPaths = @(Get-GeneratedClassPath)

    # THE AGGREGATOR, THE TEST CLASS AND AT LEAST ONE PER-OBJECT CLASS
    if ($generatedClassPaths.Count -lt 3) {
        Stop-WithError 'generated classes are missing. Run -Step Generate first.'
    }

    $ownedClassPaths = @($frameworkClassPaths) + $generatedClassPaths

    $deployArguments = @('project', 'deploy', 'start', '--target-org', $ScratchOrgAlias, '--wait', '10', '--ignore-conflicts', '--json')
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
    Push-Location $StagingProjectDir
    try {
        & node $HeadlessDriver check $ScratchOrgAlias $StagingProjectDir
        $checkExitCode = $LASTEXITCODE
    }
    finally {
        Pop-Location
    }

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

    Write-Info "artifacts under $(Join-Path $StagingProjectDir 'treecipe/PicklistDependencyResults')"
    return $actualOutcome
}

# --------------------------------------------------------------------------------------------------
# Step: Drift  --  the step that proves the check is worth running
# --------------------------------------------------------------------------------------------------

function Invoke-Drift {

    Write-Step 'Simulate an admin rewiring dependencies in the org'

    Write-Info 'local source metadata always ends each phase back at the original contract,'
    Write-Info 'so the org and source genuinely disagree and the specs are never regenerated'

    # ----------------------------------------------------------------------------------------------
    # Phase 1 -- drift the GLOBAL VALUE SET field only.
    #
    # Neighborhood__c is left correct on purpose. It is Planet__c's controlling field, and a broken
    # upstream short-circuits every spec below it into a single UPSTREAM_FAILURE. Drifting both at
    # once would mean Planet__c's own expectations never actually get evaluated -- the global value
    # set path would look covered while proving nothing about itself.
    # ----------------------------------------------------------------------------------------------

    Write-Step 'Phase 1 -- rewire "mars" from ohiocity to willowick on Planet__c (global value set)'

    $beforeDriftMap = Get-OrgDependencyMap

    Write-PlanetFieldMetadata -Drifted $true
    Invoke-DriftedFieldDeploy
    Write-PlanetFieldMetadata -Drifted $false

    Assert-OrgDependencyChanged -BeforeMap $beforeDriftMap -AfterMap (Get-OrgDependencyMap) -SpecKey "$DemoObjectApiName.Planet__c"

    Invoke-Check -ExpectedOutcome 'FAIL' | Out-Null
    Write-Good 'drift on a global-value-set-backed dependent picklist detected'
    Write-Info 'expect MISSING_VALUES on Planet__c @ "ohiocity" and FORBIDDEN_VALUES_PRESENT @ "willowick"'

    Suspend-ForReview -Prompt 'confirm the failure names the right field, controlling value and kind' -LookAt @(Get-NewestReportPath)

    # ----------------------------------------------------------------------------------------------
    # Phase 2 -- drift the controlling field too, proving the chain reports once at its source.
    # ----------------------------------------------------------------------------------------------

    Write-Host ''
    Write-Step 'Phase 2 -- also rewire "tremont" from cle to eastlake on Neighborhood__c (controlling field)'

    $beforePhaseTwoMap = Get-OrgDependencyMap

    Write-DependentFieldMetadata -Drifted $true
    Write-PlanetFieldMetadata -Drifted $true
    Invoke-DriftedFieldDeploy
    Write-DependentFieldMetadata -Drifted $false
    Write-PlanetFieldMetadata -Drifted $false

    Assert-OrgDependencyChanged -BeforeMap $beforePhaseTwoMap -AfterMap (Get-OrgDependencyMap) -SpecKey "$DemoObjectApiName.Neighborhood__c"

    Invoke-Check -ExpectedOutcome 'FAIL' | Out-Null
    Write-Good 'drift on the controlling field detected and reported once at its source'
    Write-Info 'expect Neighborhood__c failures plus a single UPSTREAM_FAILURE for Dressing__c and Planet__c'

    Suspend-ForReview -Prompt 'confirm the chain reports the break once at its source, not once per link' -LookAt @(Get-NewestReportPath)

    Write-Host ''
    Write-Good 'both drift paths detected exactly as intended'
    Write-Info 'open the newest report.md under treecipe/PicklistDependencyResults to see the failure detail'
    Write-Info 'run -Step Restore to put the org back'
}

<#
    Deploys just the two fields the Drift and Restore steps rewrite. Field-level source dirs keep
    the blast radius to the dependency being changed -- nothing else in the object moves.
#>
function Invoke-DriftedFieldDeploy {

    $deployArguments = @(
        'project', 'deploy', 'start',
        '--source-dir', (Join-Path $DemoFieldsDir 'Neighborhood__c.field-meta.xml'),
        '--source-dir', (Join-Path $DemoFieldsDir 'Planet__c.field-meta.xml'),
        '--target-org', $ScratchOrgAlias, '--wait', '10', '--ignore-conflicts', '--json'
    )
    $deployed = Invoke-SalesforceJson -Arguments $deployArguments -AllowNonZeroExit
    Assert-DeploySucceeded -DeployPayload $deployed
}

function Invoke-Restore {

    Write-Step 'Restore the org dependency'

    Write-DependentFieldMetadata -Drifted $false
    Write-PlanetFieldMetadata -Drifted $false

    Invoke-DriftedFieldDeploy

    Write-Good 'org dependencies restored'
    Invoke-Check -ExpectedOutcome 'PASS' | Out-Null
}

<#
    A hash of every generated spec class on disk, used to prove a regeneration actually changed the
    contract. Same defensive reasoning as the drift guard: a step that silently produces no change
    must not be allowed to report success.
#>
function Get-GeneratedSpecFingerprint {

    $generatedClassPaths = @(@(Get-GeneratedClassPath) | Sort-Object)
    if ($generatedClassPaths.Count -eq 0) { return '' }

    $combinedContent = ($generatedClassPaths | ForEach-Object { Get-Content -Path $_ -Raw }) -join "`n"
    $contentStream = [System.IO.MemoryStream]::new([System.Text.Encoding]::UTF8.GetBytes($combinedContent))

    try   { return (Get-FileHash -InputStream $contentStream -Algorithm SHA256).Hash }
    finally { $contentStream.Dispose() }
}

# --------------------------------------------------------------------------------------------------
# Step: Accept  --  the other resolution
#
# Drift has two legitimate endings. Restore REJECTS it: the admin changed something they should not
# have, so the org goes back. Accept treats the org as correct and brings the contract up to date --
# the dependency genuinely changed and the spec is what is now stale.
#
# The order matters and is the whole reason this is a step rather than a note. Regenerating on its
# own accomplishes nothing: generation reads LOCAL metadata, and Drift deliberately leaves local
# source asserting the original contract. Local has to learn what the org says BEFORE regenerating,
# or the regenerated contract is byte-identical to the one that just failed.
# --------------------------------------------------------------------------------------------------

function Invoke-Accept {

    Write-Step 'Accept the drift: pull the org state into local source, regenerate, redeploy, re-run'

    $fingerprintBeforeRegeneration = Get-GeneratedSpecFingerprint

    Write-Info "retrieving $DemoObjectApiName from the org into local source metadata"
    $retrieveArguments = @(
        'project', 'retrieve', 'start',
        '--source-dir', $DemoObjectDir,
        '--target-org', $ScratchOrgAlias,
        '--wait', '10', '--json'
    )
    $retrieved = Invoke-SalesforceJson -Arguments $retrieveArguments -AllowNonZeroExit

    if ($retrieved.result.success -ne $true) {
        $retrieveDetail = if ($retrieved.PSObject.Properties.Name -contains 'message') { $retrieved.message } else { 'unknown reason' }
        Stop-WithError "retrieve failed: $retrieveDetail"
    }
    Write-Good 'local source metadata now matches the org'

    Invoke-Generate

    if ((Get-GeneratedSpecFingerprint) -eq $fingerprintBeforeRegeneration) {
        Write-Bad 'regeneration produced a byte-identical contract, so nothing was actually accepted.'
        Write-Info 'the retrieve did not bring the org change into local source -- check that the drifted'
        Write-Info 'fields are inside the retrieved source directory.'
        Stop-WithError 'refusing to re-run: the check would fail again for exactly the same reason.'
    }
    Write-Good 'the regenerated contract differs from the one that failed'

    Invoke-Check -ExpectedOutcome 'PASS' | Out-Null

    Write-Host ''
    Write-Good 'org and contract agree again -- the drift was accepted, not hidden'
    Write-Info 'local source metadata now carries the org values; -Step Scaffold rewrites it back to the sample contract'

    Suspend-ForReview -Prompt 'confirm the contract passes because it was updated, not because the check went blind' -LookAt @(Get-NewestReportPath)
}

# --------------------------------------------------------------------------------------------------
# Step: Teardown
# --------------------------------------------------------------------------------------------------

function Invoke-Teardown {

    Write-Step "Delete scratch org '$ScratchOrgAlias'"

    Invoke-SalesforceJson -Arguments @('org', 'delete', 'scratch', '--target-org', $ScratchOrgAlias, '--no-prompt', '--json') | Out-Null
    Write-Good "deleted $ScratchOrgAlias"
    Write-Info "the staging DX project at $StagingProjectDir was left in place; it is gitignored and safe to delete"
}

# --------------------------------------------------------------------------------------------------
# Dispatch
# --------------------------------------------------------------------------------------------------

Write-Host ''
Write-Host 'Treecipe -- Picklist Dependency Contract Testing Demo' -ForegroundColor White
Write-Host "repository: $RepoRoot" -ForegroundColor DarkGray
Write-Host "scratch org alias: $ScratchOrgAlias" -ForegroundColor DarkGray

if ($Interactive) { Write-Host 'interactive: will pause for review at each checkpoint' -ForegroundColor DarkGray }

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
    'FullRun' {
        # The whole contract lifecycle in one invocation: stand it up, prove source and org agree,
        # move the org and prove the check catches it, then bring the contract up to date and prove
        # it agrees again. Teardown stays opt-in.
        Invoke-Preflight
        Invoke-Scaffold
        Invoke-CreateOrg
        Invoke-Deploy
        Invoke-Generate
        Invoke-Check -ExpectedOutcome 'PASS' | Out-Null
        Invoke-Drift
        Invoke-Accept

        Write-Host ''
        Write-Step 'Done'
        Write-Good 'passing check, both drift paths detected, contract regenerated and passing again'
        Write-Info 'the org ends in its drifted-and-accepted state; -Step Scaffold then -Step Deploy resets the sample'
        Write-Info 'run -Step Teardown to delete the scratch org'
    }
    'Preflight' { Invoke-Preflight }
    'Scaffold'  { Invoke-Scaffold }
    'CreateOrg' { Invoke-CreateOrg }
    'Deploy'    { Invoke-Deploy }
    'Generate'  { Invoke-Generate }
    'Check'     { Invoke-Check -ExpectedOutcome 'PASS' | Out-Null }
    'Verify'    { Invoke-Verify | Out-Null }
    'Drift'     { Invoke-Drift }
    'Restore'   { Invoke-Restore }
    'Accept'    { Invoke-Accept }
    'Teardown'  { Invoke-Teardown }
}

Write-Host ''
