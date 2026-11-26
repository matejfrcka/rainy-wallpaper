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
    const dwmapi = koffi.load('dwmapi.dll');
    const ole32 = koffi.load('ole32.dll');
    const GUID = koffi.struct('GUID', { d1: 'uint32', d2: 'uint16', d3: 'uint16', d4: koffi.array('uint8', 8) });

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
      GetParent: user32.func('intptr_t __stdcall GetParent(intptr_t hwnd)'),
      GetWindow: user32.func('intptr_t __stdcall GetWindow(intptr_t hwnd, uint32 cmd)'),
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
      IsIconic: user32.func('bool __stdcall IsIconic(intptr_t hwnd)'),
      IsZoomed: user32.func('bool __stdcall IsZoomed(intptr_t hwnd)'),
      GetWindowTextLengthW: user32.func('int __stdcall GetWindowTextLengthW(intptr_t hwnd)'),
      DwmGetWindowAttribute: dwmapi.func('int32 __stdcall DwmGetWindowAttribute(intptr_t hwnd, uint32 attr, _Out_ int32 *value, uint32 size)'),
      CoInitializeEx: ole32.func('int32 __stdcall CoInitializeEx(void *reserved, uint32 flags)'),
      CoCreateInstance: ole32.func('int32 __stdcall CoCreateInstance(GUID *clsid, void *outer, uint32 ctx, GUID *iid, _Out_ void **ppv)'),
      CoTaskMemFree: ole32.func('void __stdcall CoTaskMemFree(void *p)'),
      // IDesktopWallpaper vtable entries (called through koffi.call)
      P_Release: koffi.proto('uint32 __stdcall IDW_Release(void *self)'),
      P_GetWallpaper: koffi.proto('int32 __stdcall IDW_GetWallpaper(void *self, str16 monitorId, _Out_ void **path)'),
      P_GetPathAt: koffi.proto('int32 __stdcall IDW_GetMonitorDevicePathAt(void *self, uint32 index, _Out_ void **id)'),
      P_GetPathCount: koffi.proto('int32 __stdcall IDW_GetMonitorDevicePathCount(void *self, _Out_ uint32 *count)'),
      P_GetRect: koffi.proto('int32 __stdcall IDW_GetMonitorRECT(void *self, str16 monitorId, _Out_ RECT *rect)'),
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
const GWL_EXSTYLE = -20, GWL_STYLE = -16;
const WS_CHILD = 0x40000000, WS_POPUP = 0x80000000, WS_CAPTION = 0x00c00000, WS_THICKFRAME = 0x00040000;
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hex = (h) => (h ? '0x' + Number(h).toString(16) : '0');

/**
 * Locate the window that hosts the wallpaper layer.
 *  - Windows 11 24H2+:  Progman > [SHELLDLL_DefView (icons), WorkerW (wallpaper)]
 *  - Older Windows:     WorkerW(icons, contains SHELLDLL_DefView) followed by a
 *                       separate top-level WorkerW behind it (wallpaper layer).
 */
function findWallpaperHost(a) {
  const progman = a.FindWindowW('Progman', null);
  if (!progman) return null;
  // Ask Progman to spawn the WorkerW behind the desktop icons.
  a.SendMessageTimeoutW(progman, 0x052c, 0xd, 0x1, 0, 1000, null);
  a.SendMessageTimeoutW(progman, 0x052c, 0, 0, 0, 1000, null);

  const defViewInProgman = a.FindWindowExW(progman, 0, 'SHELLDLL_DefView', null);
  const childWorker = a.FindWindowExW(progman, 0, 'WorkerW', null);
  if (defViewInProgman && childWorker) {
    return { mode: 'progman', progman, defView: defViewInProgman, workerw: childWorker };
  }

  let iconHost = 0;
  a.EnumWindows((hwnd) => {
    if (a.FindWindowExW(hwnd, 0, 'SHELLDLL_DefView', null)) { iconHost = hwnd; return false; }
    return true;
  }, 0);
  if (iconHost) {
    const w = a.FindWindowExW(0, iconHost, 'WorkerW', null);
    if (w && w !== iconHost) return { mode: 'classic', parent: w, iconHost };
  }
  return null; // WorkerW not created yet → caller retries
}

/**
 * Attach a BrowserWindow behind the desktop icons.
 * @param {Buffer} handle  win.getNativeWindowHandle()
 * @param {{x,y,width,height}} rect  physical-pixel rect of the target monitor
 * @param {{x,y}} origin  physical top-left of the virtual screen
 * @param {(msg:string)=>void} log
 * @returns {Promise<object|null>} host description, or null on failure
 */
async function attachToDesktop(handle, rect, origin, log = () => {}) {
  const a = load();
  if (!a) { log('attach: koffi/user32 not available'); return null; }
  const hwnd = hwndFromBuffer(handle);
  let host = null;
  for (let i = 0; i < 25 && !host; i++) {
    try { host = findWallpaperHost(a); } catch (e) { log('attach: find error ' + e.message); }
    if (!host) await sleep(200);
  }
  if (!host) { log('attach: wallpaper WorkerW not found'); return null; }
  try {
    const parent = host.mode === 'progman' ? host.progman : host.parent;
    log(`attach: mode=${host.mode} hwnd=${hex(hwnd)} parent=${hex(parent)} defView=${hex(host.defView || host.iconHost)} workerw=${hex(host.workerw)}`);
    // A real child window (WS_CHILD instead of WS_POPUP) is required for
    // SetParent + z-ordering below the icon layer to work.
    const style = Number(a.GetWindowLongPtrW(hwnd, GWL_STYLE)) >>> 0;
    const newStyle = ((style & ~(WS_POPUP | WS_CAPTION | WS_THICKFRAME)) | WS_CHILD) >>> 0;
    a.SetWindowLongPtrW(hwnd, GWL_STYLE, newStyle);
    const ex = Number(a.GetWindowLongPtrW(hwnd, GWL_EXSTYLE)) >>> 0;
    let newEx = (ex | WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW) >>> 0;
    if (host.mode === 'progman') newEx = (newEx | WS_EX_LAYERED) >>> 0;
    a.SetWindowLongPtrW(hwnd, GWL_EXSTYLE, newEx);
    if (host.mode === 'progman') a.SetLayeredWindowAttributes(hwnd, 0, 255, LWA_ALPHA);
    a.SetParent(hwnd, parent);
    const actual = Number(a.GetAncestor(hwnd, 1 /* GA_PARENT */));
    log(`attach: style 0x${style.toString(16)} -> 0x${newStyle.toString(16)}, parent now ${hex(actual)}`);
    if (actual !== Number(parent)) { log('attach: SetParent failed'); return null; }
    host.hwnd = hwnd;
    host.rect = { x: rect.x - origin.x, y: rect.y - origin.y, width: rect.width, height: rect.height };
    restack(host, log);
    return host;
  } catch (e) {
    log('attach: error ' + e.message);
    return null;
  }
}

/** (Re)apply position and z-order: our window must stay below the icon layer. */
function restack(host, log) {
  const a = load();
  if (!a || !host) return;
  try {
    const { hwnd, rect } = host;
    if (host.mode === 'progman') {
      // hWndInsertAfter = DefView → placed directly *below* the icons.
      a.SetWindowPos(hwnd, host.defView, rect.x, rect.y, rect.width, rect.height, SWP_NOACTIVATE | SWP_SHOWWINDOW);
      if (host.workerw) a.SetWindowPos(host.workerw, hwnd, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
      if (log) {
        const order = [];
        for (let w = a.GetWindow(host.defView, 0 /* GW_HWNDFIRST */), n = 0; w && n < 12; w = a.GetWindow(w, 2 /* GW_HWNDNEXT */), n++) {
          order.push(Number(w) === Number(hwnd) ? 'RAINY' : className(a, w));
        }
        log('z-order in Progman (top→bottom): ' + order.join(' > '));
      }
    } else {
      a.SetWindowPos(hwnd, 0, rect.x, rect.y, rect.width, rect.height, SWP_NOZORDER | SWP_NOACTIVATE | SWP_SHOWWINDOW);
    }
  } catch { /* ignore */ }
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

/**
 * Monitors (physical rects) whose desktop is hidden behind a maximized or
 * monitor-sized window. Cloaked (suspended UWP / other virtual desktop) and
 * minimized windows are ignored.
 */
function getCoveredMonitors(ownHandles = new Set()) {
  const a = load();
  if (!a) return [];
  const covered = new Map();
  try {
    a.EnumWindows((hwnd) => {
      if (ownHandles.has(Number(hwnd)) || !a.IsWindowVisible(hwnd) || a.IsIconic(hwnd)) return true;
      if (Number(a.GetWindowLongPtrW(hwnd, GWL_EXSTYLE)) & WS_EX_TOOLWINDOW) return true;
      if (!a.GetWindowTextLengthW(hwnd)) return true;
      const cloaked = [0];
      if (a.DwmGetWindowAttribute(hwnd, 14 /* DWMWA_CLOAKED */, cloaked, 4) === 0 && cloaked[0]) return true;
      if (IGNORED_CLASSES.has(className(a, hwnd))) return true;
      const mon = a.MonitorFromWindow(hwnd, 2);
      if (!mon) return true;
      const info = { cbSize: 40, rcMonitor: {}, rcWork: {}, dwFlags: 0 };
      if (!a.GetMonitorInfoW(mon, info)) return true;
      const r = {};
      if (!a.GetWindowRect(hwnd, r)) return true;
      const w = info.rcWork;
      const fills = r.left <= w.left + 8 && r.top <= w.top + 8 && r.right >= w.right - 8 && r.bottom >= w.bottom - 8;
      if (a.IsZoomed(hwnd) || fills) {
        const m = info.rcMonitor;
        covered.set(`${m.left},${m.top}`, { x: m.left, y: m.top, width: m.right - m.left, height: m.bottom - m.top });
      }
      return true;
    }, 0);
  } catch { /* ignore */ }
  return [...covered.values()];
}

/* ---------------- per-monitor wallpapers (IDesktopWallpaper COM) ---------------- */

const guid = (d1, d2, d3, d4) => ({ d1, d2, d3, d4 });
const CLSID_DesktopWallpaper = guid(0xc2cf3110, 0x460e, 0x4fc1, [0xb9, 0xd0, 0x8a, 0x1c, 0x0c, 0x9c, 0xc4, 0xbd]);
const IID_IDesktopWallpaper = guid(0xb92b56a9, 0x8b55, 0x4e14, [0x9a, 0x89, 0x01, 0x99, 0xbb, 0xb6, 0xf9, 0x3b]);
let desktopWallpaper = null;

function wallpaperCom(a) {
  if (desktopWallpaper) return desktopWallpaper;
  a.CoInitializeEx(null, 0x2 /* COINIT_APARTMENTTHREADED */); // S_FALSE / RPC_E_CHANGED_MODE are fine
  const out = [null];
  const hr = a.CoCreateInstance(CLSID_DesktopWallpaper, null, 0x1 | 0x4 /* INPROC | LOCAL */, IID_IDesktopWallpaper, out);
  if (hr < 0 || !out[0]) throw new Error('CoCreateInstance(DesktopWallpaper) failed: 0x' + (hr >>> 0).toString(16));
  const vtbl = a.koffi.decode(out[0], 'void *');
  desktopWallpaper = { self: out[0], fn: a.koffi.decode(vtbl, 'void *', 18) };
  return desktopWallpaper;
}

function takeString(a, ptr) {
  if (!ptr) return '';
  const str = a.koffi.decode(ptr, 'char16_t', -1);
  a.CoTaskMemFree(ptr);
  return str;
}

/**
 * Wallpaper image for every monitor: [{ rect: {x,y,width,height} (physical), path }].
 * Returns null when not available (older Windows, COM failure).
 */
function getMonitorWallpapers() {
  const a = load();
  if (!a) return null;
  try {
    const { self, fn } = wallpaperCom(a);
    const k = a.koffi;
    const count = [0];
    if (k.call(fn[6], a.P_GetPathCount, self, count) < 0) return null;
    const result = [];
    for (let i = 0; i < count[0]; i++) {
      const idPtr = [null];
      if (k.call(fn[5], a.P_GetPathAt, self, i, idPtr) < 0) continue;
      const id = takeString(a, idPtr[0]);
      const r = {};
      if (k.call(fn[7], a.P_GetRect, self, id, r) < 0) continue; // inactive monitor
      const pPtr = [null];
      const path = k.call(fn[4], a.P_GetWallpaper, self, id, pPtr) >= 0 ? takeString(a, pPtr[0]) : '';
      result.push({ rect: { x: r.left, y: r.top, width: r.right - r.left, height: r.bottom - r.top }, path });
    }
    return result;
  } catch (e) {
    desktopWallpaper = null;
    return null;
  }
}

/** Path of the current Windows desktop wallpaper (may have no extension), or null. */
function getSystemWallpaperPath() {
  const a = load();
  if (!a) return null;
  try {
    const buf = new Uint16Array(520);
    if (!a.SystemParametersInfoW(0x0073 /* SPI_GETDESKWALLPAPER */, 520, buf, 0)) return null;
    const end = buf.indexOf(0);
    const p = String.fromCharCode(...buf.subarray(0, end < 0 ? buf.length : end));
    return p || null;
  } catch {
    return null;
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

module.exports = { attachToDesktop, restack, getSystemWallpaperPath, getMonitorWallpapers, getCoveredMonitors, sendToBottom, getFullscreenState, refreshDesktop, handleToNumber, isAvailable: () => !!load() };
