param(
  [Parameter(Mandatory = $true)][string]$ReaderPath,
  [Parameter(Mandatory = $true)][int]$InitialContext
)

$ErrorActionPreference = 'Stop'

# Query Windows itself rather than checking for a particular line of source. The
# reader runs in this thread, just as it does in its ordinary PowerShell host.
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class CaptionDpiProbe {
    [DllImport("user32.dll")]
    public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
    [DllImport("user32.dll")]
    public static extern IntPtr GetThreadDpiAwarenessContext();
    [DllImport("user32.dll")]
    public static extern int GetAwarenessFromDpiAwarenessContext(IntPtr context);
}
'@

$previous = [CaptionDpiProbe]::SetThreadDpiAwarenessContext([IntPtr]$InitialContext)
if ($previous -eq [IntPtr]::Zero) { throw 'Cannot set the test DPI context' }

try {
  $before = [CaptionDpiProbe]::GetAwarenessFromDpiAwarenessContext(
    [CaptionDpiProbe]::GetThreadDpiAwarenessContext())

  # An out-of-bounds point exercises startup and the early miss path without
  # reading another application's text, opening windows, or moving the pointer.
  & $ReaderPath ([int]::MinValue) ([int]::MinValue)

  $after = [CaptionDpiProbe]::GetAwarenessFromDpiAwarenessContext(
    [CaptionDpiProbe]::GetThreadDpiAwarenessContext())
  Write-Output ('DPI_RESULT:' + (@{ before = $before; after = $after } | ConvertTo-Json -Compress))
} finally {
  $null = [CaptionDpiProbe]::SetThreadDpiAwarenessContext($previous)
}
