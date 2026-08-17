$repo='Girishnag18/doodl-game'
$branch='feat/e2e-tests-and-docs'
$seenFile='tools\monitor_ci_seen.txt'
$logDir='tools\monitor_logs'
if (!(Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir | Out-Null }
if (!(Test-Path $seenFile)) { '' | Out-File $seenFile }
Write-Output "[MONITOR] Starting CI monitor for $repo/$branch; logs in $logDir"
while ($true) {
  try {
    $runsJson = gh run list --repo $repo --branch $branch --limit 10 --json id,status,conclusion,name,createdAt
    $runs = $runsJson | ConvertFrom-Json
    foreach ($r in $runs) {
      if ($r.conclusion -eq 'failure') {
        $id = $r.id.ToString()
        if (-not (Select-String -Path $seenFile -Pattern "^$id$" -SimpleMatch -Quiet)) {
          $ts = Get-Date -Format o
          Write-Output "[MONITOR] Detected failed run id=$id name=$($r.name) created=$($r.createdAt)"
          $out = Join-Path $logDir "run_$id.txt"
          gh run view $id --repo $repo --log > $out 2>&1
          Write-Output "[MONITOR] Saved logs to $out"
          Add-Content $seenFile $id
        }
      }
    }
  } catch {
    Write-Output "[MONITOR] Error: $($_.Exception.Message)"
  }
  Start-Sleep -Seconds 30
}
