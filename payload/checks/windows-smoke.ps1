$ErrorActionPreference = 'Stop'
$harnessRoot = Split-Path -Parent $PSScriptRoot
& node (Join-Path $harnessRoot '.claude\package-context.js') --selbsttest
exit $LASTEXITCODE
