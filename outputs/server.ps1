$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$port = if ($env:PORT) { [int]$env:PORT } else { 4173 }
$listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $port)
$contentTypes = @{
  ".html" = "text/html; charset=utf-8"
  ".css" = "text/css; charset=utf-8"
  ".js" = "text/javascript; charset=utf-8"
}

function Send-Response {
  param (
    [System.Net.Sockets.NetworkStream]$Stream,
    [int]$Status,
    [string]$StatusText,
    [byte[]]$Body,
    [string]$ContentType
  )

  $headers = "HTTP/1.1 $Status $StatusText`r`nContent-Length: $($Body.Length)`r`nContent-Type: $ContentType`r`nConnection: close`r`n`r`n"
  $headerBytes = [System.Text.Encoding]::ASCII.GetBytes($headers)
  $Stream.Write($headerBytes, 0, $headerBytes.Length)
  if ($Body.Length -gt 0) {
    $Stream.Write($Body, 0, $Body.Length)
  }
}

$listener.Start()
Write-Host "Pose coach running at http://localhost:$port"
Write-Host "Press Ctrl+C to stop."

try {
  while ($true) {
    $client = $listener.AcceptTcpClient()
    try {
      $stream = $client.GetStream()
      $reader = [System.IO.StreamReader]::new($stream, [System.Text.Encoding]::ASCII, $false, 1024, $true)
      $requestLine = $reader.ReadLine()

      if (-not $requestLine) {
        continue
      }

      while ($reader.Peek() -gt -1) {
        $line = $reader.ReadLine()
        if ([string]::IsNullOrEmpty($line)) {
          break
        }
      }

      $parts = $requestLine.Split(" ")
      $urlPath = if ($parts.Length -gt 1) { [Uri]::UnescapeDataString($parts[1].Split("?")[0]) } else { "/" }
      if ($urlPath -eq "/") {
        $urlPath = "/index.html"
      }

      $relativePath = $urlPath.TrimStart("/") -replace "/", [System.IO.Path]::DirectorySeparatorChar
      $filePath = [System.IO.Path]::GetFullPath([System.IO.Path]::Combine($root, $relativePath))

      if (-not $filePath.StartsWith($root, [System.StringComparison]::OrdinalIgnoreCase)) {
        $body = [System.Text.Encoding]::UTF8.GetBytes("Forbidden")
        Send-Response $stream 403 "Forbidden" $body "text/plain; charset=utf-8"
        continue
      }

      if (-not [System.IO.File]::Exists($filePath)) {
        $body = [System.Text.Encoding]::UTF8.GetBytes("Not found")
        Send-Response $stream 404 "Not Found" $body "text/plain; charset=utf-8"
        continue
      }

      $extension = [System.IO.Path]::GetExtension($filePath)
      $contentType = if ($contentTypes.ContainsKey($extension)) { $contentTypes[$extension] } else { "application/octet-stream" }
      $body = [System.IO.File]::ReadAllBytes($filePath)
      Send-Response $stream 200 "OK" $body $contentType
    } finally {
      $client.Close()
    }
  }
} finally {
  $listener.Stop()
}
