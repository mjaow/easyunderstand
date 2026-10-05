# Report what sits under a screen point, using UI Automation.
#
#   powershell.exe -NoProfile -ExecutionPolicy Bypass -File transcript-at-point.ps1 <x> <y>
#
# Prints, one per line:
#   BUTTON:<name>   accessible name of the nearest button up the tree, if any
#   LINE:<text>     the line of text under the point, if the app exposes text there
#   CAPTION:<text>  the caption drawn on a video player the point is inside, if any
#   VIDEO:<x y w h> the on-screen rectangle of a video the point is inside, in
#                   physical pixels — distinguishes player controls from transcript text
#   CHAIN:<...>     one line per ancestor, for diagnostics
#
# Deciding whether that is a transcript line happens in the caller
# (src/core/transcript.ts), where it can be unit-tested. This script only reports.
#
# Exits 0 always; printing nothing is an ordinary outcome. Coordinates are physical
# screen pixels.

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

# Electron supplies physical screen pixels. Windows PowerShell is only system-DPI
# aware, so UIA hit tests can land on a different window on monitors whose scale
# differs from the primary display. Opt this reader thread into per-monitor DPI
# before creating any UIA objects; changing the process default can be refused
# because PowerShell's host has already chosen one.
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class TranscriptDpi {
    [DllImport("user32.dll")]
    public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
}
'@
$previousDpi = [TranscriptDpi]::SetThreadDpiAwarenessContext([IntPtr](-4))
if ($previousDpi -eq [IntPtr]::Zero) { exit 0 }

# WindowsBase carries System.Windows.Point, which UIAutomationClient does not pull in.
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes, WindowsBase

$point = New-Object System.Windows.Point([double]$args[0], [double]$args[1])

function Out-Line([string]$prefix, [string]$text) {
  # Keep each report on one line so the caller can parse it line by line.
  $flat = ($text -replace '[\r\n]+', ' ').Trim()
  if ($flat.Length -gt 0) { [Console]::Out.WriteLine($prefix + $flat) }
}

# An element's own name, or the names of the text nodes inside it. Chromium gives a
# plain container no name of its own; its text lives in the child text nodes.
function Get-TextUnder($element) {
  $own = $element.Current.Name
  if ($own -and $own.Trim().Length -gt 0) { return $own }
  $textType = New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
    [System.Windows.Automation.ControlType]::Text)
  $parts = @()
  foreach ($node in $element.FindAll([System.Windows.Automation.TreeScope]::Descendants, $textType)) {
    if ($node.Current.Name) { $parts += $node.Current.Name }
  }
  return ($parts -join ' ')
}

try {
  $element = [System.Windows.Automation.AutomationElement]::FromPoint($point)
  if ($null -eq $element) { exit 0 }

  $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
  $buttonType = [System.Windows.Automation.ControlType]::Button
  $current = $element
  $textPattern = $null
  $button = $null
  $player = $null
  $video = $null
  $depth = 0

  while ($null -ne $current -and $depth -lt 12) {
    $c = $current.Current
    Out-Line 'CHAIN:' ("{0} {1} id='{2}' class='{3}' name='{4}'" -f $depth, $c.ControlType.ProgrammaticName, $c.AutomationId, $c.ClassName, $c.Name)

    # The nearest button: a transcript line is a button named "<time> <text>".
    if ($null -eq $button -and $c.ControlType -eq $buttonType -and $c.Name) { $button = $c.Name }

    # YouTube's player. The HTML class attribute comes through as the UIA class name.
    if ($null -eq $player -and $c.ClassName -and $c.ClassName.Contains('html5-video-player')) { $player = $current }

    # Any video: X names its player "Embedded video" and its control strip after the
    # captions button; Chromium calls a bare <video> element "video". Mark the
    # player so its controls are ignored when no caption is exposed by the page.
    $looksLikeVideo = ($c.Name -eq 'Embedded video') -or ($c.LocalizedControlType -eq 'video') -or
                      ($c.Name -match 'captions') -or ($c.ClassName -and $c.ClassName -match 'html5-video-player|video-stream')
    if ($null -eq $video -and $looksLikeVideo) { $video = $current }

    # In Chromium the leaf under the pointer is usually a plain container; TextPattern
    # lives on the document above it, so keep walking until something exposes it.
    if ($null -eq $textPattern) {
      try { $textPattern = $current.GetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern) } catch { }
    }

    $current = $walker.GetParent($current)
    $depth++
  }

  if ($null -ne $button) { Out-Line 'BUTTON:' $button }

  if ($null -ne $video) {
    $r = $video.Current.BoundingRectangle
    if ($r.Width -gt 0 -and $r.Height -gt 0) {
      Out-Line 'VIDEO:' ("{0} {1} {2} {3}" -f [int]$r.X, [int]$r.Y, [int]$r.Width, [int]$r.Height)
    }
  }

  # Inside the player: the caption currently on screen. YouTube draws it in a
  # focusable "caption-window" element, and focusable elements are always in the
  # tree, whereas the plain spans inside it may be pruned — so look for the window
  # and gather whatever text sits under it.
  if ($null -ne $player) {
    $everything = [System.Windows.Automation.Condition]::TrueCondition
    $parts = @()
    $shown = 0
    foreach ($node in $player.FindAll([System.Windows.Automation.TreeScope]::Descendants, $everything)) {
      $n = $node.Current
      $isCaption = ($n.ClassName -and $n.ClassName.Contains('caption-window')) -or
                   ($n.AutomationId -and $n.AutomationId.StartsWith('caption-window'))
      if ($isCaption) {
        $text = Get-TextUnder $node
        if ($text) { $parts += $text }
      }
      # A sketch of the player's subtree, for the miss log: text and anything caption-like.
      if ($shown -lt 40 -and ($isCaption -or $n.ControlType -eq [System.Windows.Automation.ControlType]::Text -or ($n.ClassName -and $n.ClassName.Contains('caption')))) {
        Out-Line 'CHAIN:' ("player> {0} id='{1}' class='{2}' name='{3}'" -f $n.ControlType.ProgrammaticName, $n.AutomationId, $n.ClassName, $n.Name)
        $shown++
      }
    }
    if ($parts.Count -gt 0) { Out-Line 'CAPTION:' ($parts -join ' ') }
  }

  if ($null -ne $textPattern) {
    $range = $textPattern.RangeFromPoint($point)
    if ($null -ne $range) {
      # A line is the right unit for a transcript entry: paragraph would pull in
      # neighbouring lines, and word would lose the context the model needs.
      $range.ExpandToEnclosingUnit([System.Windows.Automation.Text.TextUnit]::Line)
      Out-Line 'LINE:' ($range.GetText(600))
    }
  }
}
catch {
  # Not being able to read a point is normal — over a video, or an app that exposes
  # nothing. Stay silent and let the caller move on.
  exit 0
}
