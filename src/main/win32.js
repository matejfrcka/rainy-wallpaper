'use strict';
/**
 * Win32 desktop integration via koffi (pure FFI, prebuilt – no native compilation).
 *
 *  - attachToDesktop(): re-parents an Electron window behind the desktop icons
 *    (the classic "WorkerW" technique, plus the Windows 11 24H2+ layout where
 *    the wallpaper WorkerW lives inside Progman).
 *  - getFullscreenState(): detects fullscreen apps / games / presentations.
 *  - refreshDesktop(): repaints the original wallpaper when we quit.
 *
 * Every function degrades gracefully (returns false/null) off Windows or when
 * koffi cannot be loaded.
 */

let api = null;

function load() {
  if (api !== null) return api;
  api = false;
  if (process.platform !== 'win32') return api;
  try {
    const koffi = require('koffi');
    const user32 = koffi.load('user32.dll');
    const shell32 = koffi.load('shell32.dll');

    const RECT = koffi.struct('RECT', { left: 'int32', top: 'int32', right: 'int32', bottom: 'int32' });
    const MONITORINFO = koffi.struct('MONITORINFO', { cbSize: 'uint32', rcMonitor: RECT, rcWork: RECT, dwFlags: 'uint32' });
    const EnumWindowsProc = koffi.proto('bool __stdcall EnumWindowsProc(intptr_t hwnd, intptr_t lParam)');

    api = {
      koffi,
      FindWindowW: user32.func('intptr_t __stdcall FindWindowW(str16 cls, str16 name)'),
      FindWindowExW: user32.func('intptr_t __stdcall FindWindowExW(intptr_t parent, intptr_t after, str16 cls, str16 name)'),
      SendMessageTimeoutW: user32.func('intptr_t __stdcall SendMessageTimeoutW(intptr_t hwnd, uint32 msg, uintptr_t wParam, intptr_t lParam, uint32 flags, uint32 timeout, void *result)'),
      EnumWindows: user32.func('bool __stdcall EnumWindows(EnumWindowsProc *cb, intptr_t lParam)'),
      SetParent: user32.func('intptr_t __stdcall SetParent(intptr_t child, intptr_t parent)'),
      SetWindowPos: user32.func('bool __stdcall SetWindowPos(intptr_t hwnd, intptr_t after, int x, int y, int cx, int cy, uint32 flags)'),
      GetWindowLongPtrW: user32.func('intptr_t __stdcall GetWindowLongPtrW(intptr_t hwnd, int index)'),
      SetWindowLongPtrW: user32.func('intptr_t __stdcall SetWindowLongPtrW(intptr_t hwnd, int index, intptr_t value)'),
      SetLayeredWindowAttributes: user32.func('bool __stdcall SetLayeredWindowAttributes(intptr_t hwnd, uint32 key, uint8 alpha, uint32 flags)'),
      GetForegroundWindow: user32.func('intptr_t __stdcall GetForegroundWindow()'),
      GetWindowRect: user32.func('bool __stdcall GetWindowRect(intptr_t hwnd, _Out_ RECT *rect)'),
      GetClassNameW: user32.func('int __stdcall GetClassNameW(intptr_t hwnd, _Out_ uint16_t *buf, int max)'),
      IsWindowVisible: user32.func('bool __stdcall IsWindowVisible(intptr_t hwnd)'),
      GetAncestor: user32.func('intptr_t __stdcall GetAncestor(intptr_t hwnd, uint32 flags)'),
      MonitorFromWindow: user32.func('intptr_t __stdcall MonitorFromWindow(intptr_t hwnd, uint32 flags)'),
      GetMonitorInfoW: user32.func('bool __stdcall GetMonitorInfoW(intptr_t monitor, _Inout_ MONITORINFO *info)'),
      SystemParametersInfoW: user32.func('bool __stdcall SystemParametersInfoW(uint32 action, uint32 param, _Inout_ uint16_t *pv, uint32 winIni)'),
      SHQueryUserNotificationState: shell32.func('int32 __stdcall SHQueryUserNotificationState(_Out_ int32 *state)'),
    };
  } catch (e) {
    console.warn('[win32] koffi unavailable, desktop integration disabled:', e.message);
    api = false;
  }
  return api;
}

const SWP_NOSIZE = 0x0001, SWP_NOMOVE = 0x0002, SWP_NOZORDER = 0x0004, SWP_NOACTIVATE = 0x0010, SWP_SHOWWINDOW = 0x0040;
const HWND_BOTTOM = 1;
const GWL_EXSTYLE = -20;
const WS_EX_LAYERED = 0x00080000, WS_EX_NOACTIVATE = 0x08000000, WS_EX_TOOLWINDOW = 0x00000080;
const LWA_ALPHA = 0x2;

function hwndFromBuffer(buf) {
  return buf.length >= 8 ? Number(buf.readBigUInt64LE(0)) : buf.readUInt32LE(0);
}

function className(a, hwnd) {
  const buf = new Uint16Array(256);
  const n = a.GetClassNameW(hwnd, buf, 256);
  return n > 0 ? String.fromCharCode(...buf.subarray(0, n)) : '';
}

/** Locate the window that hosts the wallpaper layer. */
function findWallpaperHost(a) {
  const progman = a.FindWindowW('Progman', null);
  if (!progman) return null;
  // Ask Progman to spawn the WorkerW behind the desktop icons.
  a.SendMessageTimeoutW(progman, 0x052c, 0xd, 0x1, 0, 1000, null);
  a.SendMessageTimeoutW(progman, 0x052c, 0, 0, 0, 1000, null);

  let workerw = 0;
  a.EnumWindows((hwnd) => {
    if (a.FindWindowExW(hwnd, 0, 'SHELLDLL_DefView', null)) {
      const w = a.FindWindowExW(0, hwnd, 'WorkerW', null);
      if (w) workerw = w;
    }
    return true;
  }, 0);
  if (workerw) return { mode: 'classic', parent: workerw };

  // Windows 11 24H2+: Progman hosts SHELLDLL_DefView and a child WorkerW.
  const childWorker = a.FindWindowExW(progman, 0, 'WorkerW', null);
  const defView = a.FindWindowExW(progman, 0, 'SHELLDLL_DefView', null);
  if (defView) return { mode: 'progman', parent: progman, workerw: childWorker, defView };
  return null;
}

/**
 * Attach a BrowserWindow to the desktop.
 * @param {Buffer} handle  win.getNativeWindowHandle()
 * @param {{x,y,width,height}} rect  physical-pixel rect of the target monitor
 * @param {{x,y}} origin  physical top-left of the virtual screen
 */
function attachToDesktop(handle, rect, origin) {
  const a = load();
  if (!a) return false;
  try {
    const hwnd = hwndFromBuffer(handle);
    const host = findWallpaperHost(a);
    if (!host) return false;
    const ex = Number(a.GetWindowLongPtrW(hwnd, GWL_EXSTYLE));
    let newEx = ex | WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW;
    if (host.mode === 'progman') newEx |= WS_EX_LAYERED;
    a.SetWindowLongPtrW(hwnd, GWL_EXSTYLE, newEx);
    if (host.mode === 'progman') a.SetLayeredWindowAttributes(hwnd, 0, 255, LWA_ALPHA);

    a.SetParent(hwnd, host.parent);
    const x = rect.x - origin.x, y = rect.y - origin.y;
    if (host.mode === 'progman') {
      // Directly below the icon layer, above the system wallpaper WorkerW.
      a.SetWindowPos(hwnd, host.defView, x, y, rect.width, rect.height, SWP_NOACTIVATE | SWP_SHOWWINDOW);
      if (host.workerw) a.SetWindowPos(host.workerw, hwnd, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
    } else {
      a.SetWindowPos(hwnd, 0, x, y, rect.width, rect.height, SWP_NOZORDER | SWP_NOACTIVATE | SWP_SHOWWINDOW);
    }
    return true;
  } catch (e) {
    console.warn('[win32] attach failed:', e.message);
    return false;
  }
}

/** Fallback when attaching fails: keep the window at the bottom of the z-order. */
function sendToBottom(handle) {
  const a = load();
  if (!a) return false;
  try {
    a.SetWindowPos(hwndFromBuffer(handle), HWND_BOTTOM, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
    return true;
  } catch {
    return false;
  }
}

const IGNORED_CLASSES = new Set(['Progman', 'WorkerW', 'Shell_TrayWnd', 'Shell_SecondaryTrayWnd', 'Windows.UI.Core.CoreWindow', 'XamlExplorerHostIslandWindow', 'TopLevelWindowForOverflowXamlIsland']);

/**
 * Returns { fullscreen: boolean, monitorRect?: {x,y,width,height} } describing
 * whether a fullscreen application (game, video, presentation) is in front.
 * `ownHandles` – numeric HWNDs of our own windows to ignore.
 */
function getFullscreenState(ownHandles = new Set()) {
  const a = load();
  if (!a) return { fullscreen: false };
  try {
    const st = [0];
    if (a.SHQueryUserNotificationState(st) === 0) {
      // 2 = busy (fullscreen app), 3 = D3D fullscreen, 4 = presentation mode
      if (st[0] === 2 || st[0] === 3 || st[0] === 4) return { fullscreen: true };
    }
    const fg = a.GetForegroundWindow();
    if (!fg || ownHandles.has(Number(fg)) || !a.IsWindowVisible(fg)) return { fullscreen: false };
    const root = a.GetAncestor(fg, 2 /* GA_ROOT */) || fg;
    if (IGNORED_CLASSES.has(className(a, root))) return { fullscreen: false };
    const r = {};
    if (!a.GetWindowRect(root, r)) return { fullscreen: false };
    const mon = a.MonitorFromWindow(root, 2 /* MONITOR_DEFAULTTONEAREST */);
    const info = { cbSize: 40, rcMonitor: {}, rcWork: {}, dwFlags: 0 };
    if (!mon || !a.GetMonitorInfoW(mon, info)) return { fullscreen: false };
    const m = info.rcMonitor;
    const covers = r.left <= m.left && r.top <= m.top && r.right >= m.right && r.bottom >= m.bottom;
    return covers
      ? { fullscreen: true, monitorRect: { x: m.left, y: m.top, width: m.right - m.left, height: m.bottom - m.top } }
      : { fullscreen: false };
  } catch {
    return { fullscreen: false };
  }
}

/** Re-apply the user's normal wallpaper so the desktop repaints after we exit. */
function refreshDesktop() {
  const a = load();
  if (!a) return;
  try {
    const buf = new Uint16Array(520);
    if (a.SystemParametersInfoW(0x0073 /* SPI_GETDESKWALLPAPER */, 520, buf, 0)) {
      a.SystemParametersInfoW(0x0014 /* SPI_SETDESKWALLPAPER */, 0, buf, 0);
    }
  } catch { /* ignore */ }
}

function handleToNumber(handle) {
  try { return hwndFromBuffer(handle); } catch { return 0; }
}

module.exports = { attachToDesktop, sendToBottom, getFullscreenState, refreshDesktop, handleToNumber, isAvailable: () => !!load() };
