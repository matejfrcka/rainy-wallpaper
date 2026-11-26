# Rainy Glass Wallpaper Engine

A live desktop wallpaper for Windows 10 and 11. Pick **any image** from your computer and the app draws animated rain-on-glass on top of it: drops refract the image, slide down, merge and leave trails, and condensation forms on the glass.

The app has two separate layers:

| Layer | What it does |
|---|---|
| **1 – Background** | Your current Windows wallpaper (used automatically), or an image you choose (JPG, JPEG, PNG, WEBP, BMP, any resolution or aspect ratio). It is scaled with Fill, Fit or Stretch and you can set the focal point, zoom, brightness and blur. The original file is never modified. |
| **2 – Rain glass** | A separate, transparent water simulation rendered over the background with WebGL2. It works with any background. |

## Features

- **Rain physics**: drops stick and then slip, speed up under gravity up to a top speed, and drift sideways. Drops merge when they touch and keep most of their volume. Trails leave beads and a wiped path. Tiny droplets build up and evaporate, and new drops keep forming.
- **Optics**: each drop acts as a lens that shows an inverted, magnified image (refraction). Also included: chromatic refraction, defocus inside large drops, dark rims, specular highlights, a bright crescent at the bottom of drops, imperfections in the glass surface, condensation that moving water wipes away and that slowly forms again, out-of-focus rain streaks behind the glass, glass reflections, lightning flashes and day/night color grading.
- **Sound**: rain ambience and thunder are generated in code with WebAudio. No audio files are needed.
- **Settings panel**: a dark, glass-style interface with a live preview. Changes apply immediately. You can pause or resume, restart the rain, reset settings, view the preview full screen, use 5 built-in presets, and save, load or delete your own presets. You can drag and drop an image onto the window.
- **Desktop integration**: the wallpaper sits behind the desktop icons (WorkerW technique, including the Windows 11 24H2 layout). It supports multiple monitors with different resolutions and DPI. It rebuilds itself after monitor changes or an Explorer restart. It can start with Windows and has a tray menu.
- **Resource use**: the wallpaper sleeps (no rendering, sound muted) while a fullscreen app or game is running, when the screen is locked, while the PC sleeps, and optionally on battery. You can also set an FPS limit (30, 60 or Max) and a render resolution (50–100 %) for 4K screens.
- **Wallpaper Engine export**: creates a web wallpaper project that has the same engine and options, including a property for choosing the image.
- **Backgrounds**: your current Windows wallpaper is used automatically, and each monitor gets its own wallpaper. A custom image, an animated GIF/WebP or a video (MP4/WEBM, streamed from disk) can override it.
- **GPU rendering**: the water map (drops, droplets, wipes, condensation) is drawn on the GPU with instanced sprites. Only the cheap drop physics runs on the CPU.
- **Covered monitors**: drawing stops on monitors hidden behind maximized windows. The sound keeps playing.
- **Mouse interaction**: moving the cursor over the desktop wipes the condensation and droplets, like a finger on a fogged window.
- **Live weather**: rain intensity, thunder, wind and fog can follow the real weather in your city (Open-Meteo, no API key), updated every 15 minutes.
- **Automatic day/night**: the color grading follows the sun's elevation at your location.
- **Soundscapes**: window, tin roof, leaves or car, plus optional wind.
- **Preset gallery**: every preset shows a preview rendered over your own background. Presets can be exported and imported as `.json` files.
- **Languages**: English and Slovak (automatic from the system or chosen in *System*).
- **Global shortcuts**: Ctrl+Alt+R pauses or resumes the rain, Ctrl+Alt+W turns the wallpaper on or off, Ctrl+Alt+S opens the settings.
- **Automatic updates** from GitHub Releases (installed version). **Live performance** stats (FPS, CPU, RAM, GPU) are shown in *System* and written to the log.

## Architecture

```
src/
  main/                     Electron main process
    main.js                 app lifecycle, tray, IPC, settings window
    wallpaper-manager.js    one wallpaper window per monitor, attach/rebuild
    win32.js                Win32 FFI (koffi): WorkerW attach, fullscreen detection
    system-monitor.js       fullscreen / battery / lock / sleep → suspend
    settings-store.js       settings.json + presets.json (atomic, debounced)
    image-manager.js        file dialog, extension + magic-byte validation
    we-export.js            Wallpaper Engine project builder
  preload/preload.js        contextBridge API (contextIsolation + sandbox)
  shared/defaults.js        settings schema, ranges, built-in presets (UMD)
  engine/                   rendering engine (plain JS, no bundler)
    rain-simulation.js      rain physics → water normal map + condensation mask
    shaders.js              GLSL ES 3.0: compose, gaussian blur, glass
    renderer.js             WebGL2 pipeline
    audio.js                rain sound and thunder generated with WebAudio
    engine.js               frame loop, FPS limit, pause/suspend, lightning
  renderer/
    wallpaper/              desktop wallpaper page
    settings/               settings UI + live preview
wallpaper-engine/           Wallpaper Engine template (index.html, we-main.js)
scripts/                    build-wallpaper-engine.js, test-engine.js
```

### How it renders

1. **Background pass** (runs only when the image, window size or background settings change): the image is fitted into the screen, then blurred if you asked for it. A heavily blurred copy is also made at ⅛ resolution for fog, frosted glass and defocus.
2. **Simulation pass** (CPU, every frame): drops are drawn as normal-map sprites into a water map (R and G hold the surface normal, B holds thickness, A holds coverage) at up to 1600 px. A ¼-resolution mask records where moving water has wiped the condensation.
3. **Glass pass** (one full-screen fragment shader): the shader thresholds the coverage, which turns overlapping drops into merging blobs. It then refracts the background through each drop's normal with chromatic offsets, blends in defocus based on thickness, and adds rims, highlights and the bright crescent, plus fog, streaks, reflections, the lightning flash and color grading.

Per frame the work is one texture upload and one draw. Drops that touch are found with a spatial hash, so merging stays fast with about 1,000 drops.

## Requirements

- Windows 10 (1809 or later) or Windows 11, x64
- A GPU with WebGL2 support (any DirectX 11 GPU from the last 10 years)
- To build: Node.js 18 or later (20 or 22 recommended)

## Install and run (development)

```bash
git clone <this repo>
cd rainy-wallpaper
npm install
npm start
```

The settings window opens and the wallpaper appears behind your desktop icons. Closing the settings window keeps the app running in the system tray. Use **Quit** in the tray menu to restore the normal wallpaper.

## Build the Windows installer

Run this on Windows:

```bash
npm install
npm run build
```

The output goes to `dist/`:

- `Rainy Glass Wallpaper Engine Setup 1.0.0.exe` is the NSIS installer (per user, lets you pick the folder, adds shortcuts).
- `RainyGlass-1.0.0-portable.exe` is a single portable executable.

`npm run build:dir` creates an unpacked build in `dist/win-unpacked/` for quick testing.

## Distribution: making the app run for everyone

Windows Smart App Control and SmartScreen block unsigned apps. There are two ways to avoid that.

### A) Microsoft Store (recommended)

Microsoft signs the package, so Smart App Control trusts it, and users get updates through the Store.

1. Create a developer account at https://partner.microsoft.com/dashboard. Reserve the app name.
2. Open **Product identity** and copy *Package/Identity/Name*, *Publisher* (`CN=…`) and *Publisher display name*.
3. Build the MSIX on Windows:
   ```bash
   npm run build:store -- -c.appx.identityName="<Name>" -c.appx.publisher="CN=<…>" -c.appx.publisherDisplayName="<Display name>"
   ```
   Or set the repository variables `APPX_IDENTITY_NAME`, `APPX_PUBLISHER` and `APPX_PUBLISHER_DISPLAY_NAME`, and the GitHub Actions workflow builds it for you.
4. Upload `dist/*.appx` in Partner Center (Packages), then fill in the listing and submit it for certification.

In the Store build, starting with Windows is controlled by Windows: *Task Manager → Startup apps → Rainy Glass*. Updates come from the Store.

### B) Signed installer (code-signing certificate)

1. Buy a code-signing certificate, for example Certum (an open-source developer certificate is the cheapest option for individuals), Sectigo or SSL.com. Azure Trusted Signing is another option.
2. Local build:
   ```bash
   set CSC_LINK=C:\path\cert.pfx
   set CSC_KEY_PASSWORD=****
   npm run build
   ```
   For CI: add the repository secrets `WIN_CSC_LINK` (base64 of the .pfx) and `WIN_CSC_KEY_PASSWORD`.
3. Certificates stored on a USB token or in a cloud HSM use `win.signtoolOptions` or `win.azureSignOptions` in `package.json`. See the [electron-builder code signing docs](https://www.electron.build/code-signing-win).

SmartScreen can still show a warning until the app builds up reputation (downloads).

### Releases and automatic updates

Push a tag to build and publish a GitHub Release. The installed app downloads updates from it automatically:

```bash
git tag v1.1.0
git push origin v1.1.0
```

Auto-update needs a **public** repository, or a token configured for electron-updater. The portable `.exe` does not auto-update.

## Wallpaper Engine

You have two options:

- In the app, go to **System → Export project…**. This exports your current image and settings.
- Or run `npm run build:we` (optionally followed by `-- path/to/image.jpg`). The project is written to `dist-we/RainyGlass/`.

Then in Wallpaper Engine choose **Open Wallpaper → Open from file**, or use the editor's *Create Wallpaper*, and select `index.html` in that folder. Every option, including **Background image**, can be changed in Wallpaper Engine's property panel.

## Usage tips

- **Background**: by default the rain is applied over your current Windows wallpaper. A slideshow or Spotlight change is picked up within about 10 s. Choosing a custom image overrides it, and *Remove* switches back to the Windows wallpaper. To pick a custom image, click the image card or drop a file onto the window. Fill crops the image to cover the screen and the position sliders choose which part stays visible. Fit shows the whole image with an ambient blurred border.
- **Rain**: *Random droplet generation* turned off lets the glass slowly dry. *Merging* turned off keeps drops separate.
- **Sound** plays from the desktop wallpaper, not from the preview. *Live wallpaper* must be on to hear it.
- **Performance**: on 4K screens or laptops, set *Frame rate* to 30 and/or *Render resolution* to 70 %.
- Double-click a slider to reset it. Press Space to pause or resume.
- Settings are stored in `%APPDATA%\Rainy Glass Wallpaper Engine\` (`settings.json`, `presets.json`).

## Tests

```bash
npm test
```

This checks settings sanitizing, the preset store and the Wallpaper Engine export. If `playwright` is installed, it also renders the engine headlessly with WebGL2.

## Troubleshooting

- **The rain is not visible on the desktop**: the app could not place the wallpaper behind the icons. It never covers the icons; instead the status shows *Desktop attach failed*. Send the log: *System → Open log file*.
- **A black desktop after a crash**: change your wallpaper once in Windows Settings, or start and quit the app again.
- **Low FPS**: lower *Render resolution*, *Droplet density* or *Rain intensity*. Make sure the app runs on your dedicated GPU (Windows Settings → Display → Graphics).

## License

MIT
