$repo = "jdschleicher/Salesforce-Data-Treecipes"  # Replace with your GitHub repo
$changelogPath = "CHANGELOG.md"

# Fetch closed and merged PRs
$prs = gh pr list --repo $repo --state closed --json number,title,mergedAt,headRefName --jq '.[] | select(.mergedAt != null) | {number, title, mergedAt, headRefName}'

if (-not $prs) {
    Write-Host "No merged PRs found."
    exit
}

# Read the existing changelog
$changelog = Get-Content $changelogPath -Raw
$prEntries = ""

# Process each PR
$prs | ConvertFrom-Json | Sort-Object mergedAt | ForEach-Object {
   
    $prNumber = $_.number
    $mergedAt = $_.mergedAt.Substring(0,10)
    $title = $_.title


    # Append the PR entry to the changelog format
    $entry = "## [$version] - $mergedAt`n- $title ([#$prNumber](https://github.com/$repo/pull/$prNumber))`n"
    $prEntries += "`n" + $entry

}

# Insert into changelog after "## [Unreleased]"
$updatedChangelog = $changelog -replace "(## \[Unreleased\].*?)(\r?\n\r?\n)", "`$1$prEntries`$2"

# Write back to file
$updatedChangelog | Set-Content $changelogPath

Write-Host "Changelog updated successfully!"
