'use strict';
/**
 * "Now playing" from Windows' media controls (Spotify, browser, VLC …) via a
 * single long-running PowerShell process that prints JSON every 2 s.
 * Windows only; started only while the widget wants it.
 */
const { spawn } = require('child_process');

const SCRIPT = String.raw`
$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation` + '`' + String.raw`1' })[0]
function Await($op, $type) { $t = $asTask.MakeGenericMethod($type).Invoke($null, @($op)); $t.Wait(-1) | Out-Null; $t.Result }
[Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime] | Out-Null
$mgr = Await ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])
while ($true) {
  $o = @{}
  $s = $mgr.GetCurrentSession()
  if ($s) {
    $p = Await ($s.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
    $o = @{ title = $p.Title; artist = $p.Artist; status = [string]$s.GetPlaybackInfo().PlaybackStatus; app = $s.SourceAppUserModelId }
  }
  [Console]::Out.WriteLine(($o | ConvertTo-Json -Compress))
  [Console]::Out.Flush()
  Start-Sleep -Seconds 2
}
`;

class NowPlaying {
  constructor({ onChange, log }) {
    this.onChange = onChange;
    this.log = log;
    this.proc = null;
    this.last = '';
  }

  start() {
    if (this.proc || process.platform !== 'win32') return;
    const encoded = Buffer.from(SCRIPT, 'utf16le').toString('base64');
    this.proc = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], { windowsHide: true });
    let buf = '';
    this.proc.stdout.on('data', (d) => {
      buf += d.toString('utf8');
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line || line === this.last) continue;
        this.last = line;
        try {
          const o = JSON.parse(line);
          this.onChange(o && o.title ? { title: o.title, artist: o.artist || '', playing: o.status === 'Playing', app: o.app || '' } : null);
        } catch { /* ignore partial lines */ }
      }
    });
    this.proc.on('exit', (code) => {
      this.log(`now playing: helper exited (${code})`);
      this.proc = null;
    });
    this.log('now playing: started');
  }

  stop() {
    if (!this.proc) return;
    try { this.proc.kill(); } catch { /* ignore */ }
    this.proc = null;
    this.last = '';
    this.onChange(null);
  }
}

module.exports = { NowPlaying };
