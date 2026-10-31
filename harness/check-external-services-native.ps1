$ErrorActionPreference = 'Stop'
$probe = Join-Path $PSScriptRoot 'external-services-native/target/debug/external-services-probe.exe'
$fixture = Join-Path ([System.IO.Path]::GetTempPath()) ('DevDeck external ' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $fixture | Out-Null
$workerPath = Join-Path $fixture 'worker.cjs'
$portPath = Join-Path $fixture 'port.txt'
Set-Content -LiteralPath $workerPath -Value @'
const fs = require('node:fs');
const net = require('node:net');
const server = net.createServer();
server.listen(0, '127.0.0.1', () => fs.writeFileSync('port.txt', String(server.address().port)));
'@
$worker = Start-Process -FilePath (Get-Command node).Source -ArgumentList 'worker.cjs' -WorkingDirectory $fixture -WindowStyle Hidden -PassThru
try {
    for ($attempt = 0; $attempt -lt 100 -and !(Test-Path -LiteralPath $portPath); $attempt++) {
        Start-Sleep -Milliseconds 100
    }
    $port = [int](Get-Content -LiteralPath $portPath)
    $listener = Get-NetTCPConnection -State Listen -LocalPort $port | Where-Object OwningProcess -eq $worker.Id
    if (!$listener) { throw 'Fixture PID does not own the listener' }
    & $probe $worker.Id $fixture 'node worker.cjs' $port
    if ($LASTEXITCODE -ne 0) { throw 'Live process matching failed' }
} finally {
    if (!$worker.HasExited) { $worker.Kill(); $worker.WaitForExit() }
    Remove-Item -LiteralPath $workerPath -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $portPath -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $fixture
}
& $probe $worker.Id absent
if ($LASTEXITCODE -ne 0) { throw 'Exited process remained in snapshot' }
