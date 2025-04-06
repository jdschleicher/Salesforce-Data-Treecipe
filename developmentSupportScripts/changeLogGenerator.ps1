# Git Changelog Generator
# Usage: .\changelog-generator.ps1 [optional: branch-name]
# If no branch name is provided, uses the currently checked out branch

param(
    [string]$branchName
)

# Gets the currently checked out branch if none specified
function Get-CurrentBranch {
    $currentBranch = git rev-parse --abbrev-ref HEAD
    return $currentBranch
}

# Determines the main/base branch of the repository
function Get-BaseBranch {

    $baseBranchName = "main"
    return $baseBranchName
}

# Gets the common ancestor commit between two branches
function Get-MergeBaseCommit {
    param (
        [string]$sourceBranch,
        [string]$targetBranch
    )
    
    $mergeBaseCommit = git merge-base $sourceBranch $targetBranch
    return $mergeBaseCommit
}

# Get the repository URL for creating links
function Get-RepositoryUrl {
    $repoUrl = git config --get remote.origin.url
    $cleanedUrl = $repoUrl -replace "\.git$", ""
    $formattedUrl = $cleanedUrl -replace "git@github.com:", "https://github.com/"
    
    return $formattedUrl
}

# Get repository path for building links
function Get-RepositoryPath {
    param (
        [string]$repoUrl
    )
    
    $repoPath = ""
    if ($repoUrl -match "github\.com/(.+)") {
        $repoPath = $matches[1]
    }
    
    return $repoPath
}

# Get the commit count for a specific file between two commits
function Get-FileCommitCount {
    param (
        [string]$baseCommit,
        [string]$branchName,
        [string]$filePath
    )
    
    $commitRange = "$baseCommit..$branchName"
    $commits = git log --pretty=oneline $commitRange -- $filePath
    
    # Check if $commits is null or empty
    if ($null -eq $commits) {
        return 0
    }
    
    # If it's a string (single commit), return 1
    if ($commits -is [string] -and $commits -ne "") {
        return 1
    }
    
    # If it's an array, get the count
    $commitCount = 0
    if ($commits -is [array]) {
        $commitCount = $commits.Count
    }
    
    return $commitCount
}

# Get all changed files with their status between base commit and branch
function Get-ChangedFiles {
    param (
        [string]$baseCommit,
        [string]$branchName,
        [string]$repoUrl
    )
    
    $added = @()
    $modified = @()
    $deleted = @()
    $renamed = @()
    
    $changes = git diff --name-status $baseCommit $branchName
    
    # Check if changes is null or empty
    if ($null -eq $changes -or $changes.Count -eq 0) {
        Write-Host "No changes detected between $baseCommit and $branchName" -ForegroundColor Yellow
        return @{
            Added = $added
            Modified = $modified
            Deleted = $deleted
            Renamed = $renamed
        }
    }
    
    foreach ($change in $changes) {
        $parts = $change -split "`t"
        $status = $parts[0]
        
        # Handle renamed files (they have a special format)
        if ($status -match "R") {
            $oldPath = $parts[1]
            $newPath = $parts[2]
            $commitCount = Get-FileCommitCount -baseCommit $baseCommit -branchName $branchName -filePath $newPath
            $commitUrl = "$repoUrl/commits/$branchName/$newPath"
            $renamed += [PSCustomObject]@{
                OldPath = $oldPath
                NewPath = $newPath
                CommitCount = $commitCount
                CommitUrl = $commitUrl
            }
        }
        else {
            $filePath = $parts[1]
            $commitUrl = "$repoUrl/commits/$branchName/$filePath"
            
            if ($status -eq "A") {
                $commitCount = Get-FileCommitCount -baseCommit $baseCommit -branchName $branchName -filePath $filePath
                $added += [PSCustomObject]@{
                    Path = $filePath
                    CommitCount = $commitCount
                    CommitUrl = $commitUrl
                }
            }
            elseif ($status -eq "M") {
                $commitCount = Get-FileCommitCount -baseCommit $baseCommit -branchName $branchName -filePath $filePath
                $modified += [PSCustomObject]@{
                    Path = $filePath
                    CommitCount = $commitCount
                    CommitUrl = $commitUrl
                }
            }
            elseif ($status -eq "D") {
                $commitCount = Get-FileCommitCount -baseCommit $baseCommit -branchName $branchName -filePath $filePath
                $deleted += [PSCustomObject]@{
                    Path = $filePath
                    CommitCount = $commitCount
                    CommitUrl = $commitUrl
                }
            }
        }
    }
    
    return @{
        Added = $added
        Modified = $modified
        Deleted = $deleted
        Renamed = $renamed
    }
}

# Get total commit count between base commit and branch
function Get-TotalCommitCount {
    param (
        [string]$baseCommit,
        [string]$branchName
    )
    
    $commitRange = "$baseCommit..$branchName"
    $commitList = git rev-list --count $commitRange
    
    # Check if $commitList is null or empty
    if ($null -eq $commitList -or $commitList -eq "") {
        return 0
    }
    
    $totalCount = [int]$commitList
    return $totalCount
}

# Generate the markdown table for a specific file change type
function Format-ChangelogTable {
    param (
        [array]$files,
        [string]$changeType,
        [switch]$isRename = $false
    )
    
    $table = ""
    
    if ($isRename) {
        $table += @"

### Renamed Files
| Old Path | New Path | Commits | History |
|----------|----------|---------|---------|
"@
        foreach ($file in $files) {
            $table += "`n| $($file.OldPath) | $($file.NewPath) | $($file.CommitCount) | [View History]($($file.CommitUrl)) |"
        }
    }
    else {
        $table += @"

### $changeType Files
| File | Commits | History |
|------|---------|---------|
"@
        foreach ($file in $files) {
            $table += "`n| $($file.Path) | $($file.CommitCount) | [View History]($($file.CommitUrl)) |"
        }
    }
    
    return $table
}

# Generate the complete changelog content
function Format-ChangelogContent {
    param (
        [string]$branchName,
        [int]$totalCommits,
        [hashtable]$fileChanges
    )
    
    $currentDate = Get-Date -Format "yyyy-MM-dd"
    
    $content = @"
# Changelog for branch: $branchName

Generated on: $currentDate

## Summary
- Total commits: $totalCommits
- Files added: $($fileChanges.Added.Count)
- Files modified: $($fileChanges.Modified.Count)
- Files deleted: $($fileChanges.Deleted.Count)
- Files renamed: $($fileChanges.Renamed.Count)

## Changes at a glance
"@
    
    $content += Format-ChangelogTable -files $fileChanges.Added -changeType "Added"
    $content += Format-ChangelogTable -files $fileChanges.Modified -changeType "Modified"
    $content += Format-ChangelogTable -files $fileChanges.Deleted -changeType "Deleted"
    $content += Format-ChangelogTable -files $fileChanges.Renamed -changeType "Renamed" -isRename
    
    return $content
}

# Save the changelog to a file
function Save-ChangelogToFile {
    param (
        [string]$content,
        [string]$branchName
    )
    
    $currentDate = Get-Date -Format "yyyy-MM-dd"
    $fileName = "changelog-$branchName-$currentDate.md"
    $content | Out-File -FilePath $fileName -Encoding utf8
    
    Write-Host "Changelog has been generated as $fileName" -ForegroundColor Green
    
    return $fileName
}

# Main function to orchestrate the changelog generation
function New-GitChangelog {
    # If no branch name is provided, use the current branch
    if (-not $branchName) {
        $branchName = Get-CurrentBranch
    }
    
    Write-Host "Generating changelog for branch: $branchName" -ForegroundColor Cyan
    
    # Find the base branch and merge base
    $baseBranch = Get-BaseBranch
    Write-Host "Using base branch: $baseBranch" -ForegroundColor Cyan
    
    $mergeBase = Get-MergeBaseCommit -sourceBranch $branchName -targetBranch $baseBranch
    
    # Check if merge base is valid
    if (-not $mergeBase) {
        Write-Host "Unable to find common ancestor between $branchName and $baseBranch" -ForegroundColor Red
        return $null
    }
    
    # Get repository information for links
    $repoUrl = Get-RepositoryUrl
    $repoPath = Get-RepositoryPath -repoUrl $repoUrl
    
    # Get all file changes
    $fileChanges = Get-ChangedFiles -baseCommit $mergeBase -branchName $branchName -repoUrl $repoUrl
    
    # Get total commit count
    $totalCommits = Get-TotalCommitCount -baseCommit $mergeBase -branchName $branchName
    
    # Generate and save changelog
    $changelogContent = Format-ChangelogContent -branchName $branchName -totalCommits $totalCommits -fileChanges $fileChanges
    $fileName = Save-ChangelogToFile -content $changelogContent -branchName $branchName
    
    return $changelogContent
}

# Execute the main function
try {
    New-GitChangelog
} catch {
    Write-Host "Error generating changelog: $_" -ForegroundColor Red
    Write-Host "Stack trace: $($_.ScriptStackTrace)" -ForegroundColor Red
}