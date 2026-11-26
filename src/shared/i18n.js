/**
 * Minimal i18n: English strings are the keys, other languages map them.
 * UMD – used by the main process (tray) and the settings window.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RainGlassI18n = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const SK = {
    // navigation & sections
    'Background': 'Pozadie', 'Rain': 'Dážď', 'Glass': 'Sklo', 'Atmosphere': 'Atmosféra', 'Presets': 'Predvoľby', 'System': 'Systém',
    'Choose any image from your computer. The rain layer never modifies it.': 'Vyber si akýkoľvek obrázok alebo video. Vrstva dažďa ho nikdy nemení.',
    'Physics of the water on the glass.': 'Fyzika vody na skle.',
    'Optical properties of the window and the water lenses.': 'Optické vlastnosti okna a vodných šošoviek.',
    'Sound and light. Audio plays from the desktop wallpaper.': 'Zvuk a svetlo. Zvuk hrá z tapety na ploche.',
    'Save and load your favourite looks. Presets never change your image.': 'Ukladaj a načítaj obľúbené vzhľady. Predvoľby nikdy nemenia tvoj obrázok.',
    'Desktop integration and performance.': 'Integrácia s plochou a výkon.',
    // groups
    'Source': 'Zdroj', 'Layout': 'Rozloženie', 'Adjustments': 'Úpravy', 'Amount': 'Množstvo', 'Motion': 'Pohyb', 'Interaction': 'Interakcia',
    'Optics': 'Optika', 'Surface': 'Povrch', 'Sound': 'Zvuk', 'Color': 'Farby', 'Desktop': 'Plocha', 'Performance': 'Výkon',
    'Monitors': 'Monitory', 'Live performance': 'Výkon naživo', 'Wallpaper Engine': 'Wallpaper Engine', 'Diagnostics': 'Diagnostika',
    'Live weather': 'Počasie naživo', 'Library': 'Knižnica', 'Save current look': 'Uložiť aktuálny vzhľad', 'Keyboard shortcuts': 'Klávesové skratky',
    'Updates': 'Aktualizácie', 'Language': 'Jazyk',
    // background
    'Use Windows wallpaper automatically': 'Automaticky použiť tapetu z Windows',
    'When no custom image is selected, the rain is applied over your current Windows desktop wallpaper.': 'Keď nie je vybraný vlastný obrázok, dážď sa zobrazí nad aktuálnou tapetou Windows.',
    'Scaling': 'Prispôsobenie', 'Fill': 'Vyplniť', 'Fit': 'Prispôsobiť', 'Stretch': 'Roztiahnuť',
    'Fill crops to cover the monitor, Fit shows the whole image.': 'Vyplniť oreže obrázok na celý monitor, Prispôsobiť ukáže celý obrázok.',
    'Zoom': 'Priblíženie', 'Horizontal position': 'Vodorovná poloha', 'Vertical position': 'Zvislá poloha',
    'Left ': 'Vľavo ', 'Right ': 'Vpravo ', 'Center ': 'Stred ', 'Top ': 'Hore ', 'Bottom ': 'Dole ',
    'Brightness': 'Jas', 'Blur': 'Rozmazanie',
    'Select image': 'Vybrať obrázok', 'Change image': 'Zmeniť obrázok', 'Remove': 'Odstrániť',
    'Select or drop an image': 'Vyber alebo pretiahni obrázok', 'Click to choose an image': 'Klikni a vyber obrázok',
    'Windows wallpaper (automatic)': 'Tapeta Windows (automaticky)',
    'Windows wallpaper not found – neutral gradient in use': 'Tapeta Windows nenájdená – použitý neutrálny prechod',
    'No image selected – neutral gradient in use': 'Nie je vybraný obrázok – použitý neutrálny prechod',
    'Remove the custom image (falls back to the Windows wallpaper)': 'Odstrániť vlastný obrázok (vráti sa tapeta Windows)',
    'Custom': 'Vlastný', 'Windows': 'Windows',
    'Background updated': 'Pozadie zmenené', 'Background removed': 'Pozadie odstránené',
    'This image could not be decoded: ': 'Tento obrázok sa nedá načítať: ',
    'Drop an image to use it as background': 'Pusti obrázok alebo video a použije sa ako pozadie',
    // rain
    'Rain intensity': 'Intenzita dažďa', 'How often new drops hit the window.': 'Ako často dopadajú nové kvapky na okno.',
    'Droplet density': 'Hustota kvapôčok', 'Tiny static droplets covering the glass.': 'Drobné nehybné kvapôčky na skle.',
    'Droplet size': 'Veľkosť kvapiek', 'Droplet speed': 'Rýchlosť kvapiek', 'Water trail length': 'Dĺžka vodných stôp',
    'Droplet merging': 'Spájanie kvapiek', 'Drops that touch combine into larger, faster drops.': 'Kvapky, ktoré sa dotknú, sa spoja do väčších a rýchlejších.',
    'Random droplet generation': 'Náhodné vytváranie kvapiek', 'New drops keep forming. Off = the glass slowly dries.': 'Stále vznikajú nové kvapky. Vypnuté = sklo pomaly vyschne.',
    'Wipe the glass with the mouse': 'Stieranie skla myšou',
    'Moving the cursor over the desktop wipes condensation and droplets, like a finger.': 'Pohyb kurzora nad plochou stiera zarosenie a kvapky ako prst.',
    // glass
    'Refraction intensity': 'Intenzita lomu svetla', 'Distortion intensity': 'Intenzita skreslenia', 'Chromatic refraction': 'Farebný lom',
    'Blur intensity': 'Intenzita rozmazania', 'Defocus inside large drops.': 'Rozostrenie vo veľkých kvapkách.',
    'Glass transparency': 'Priehľadnosť skla', 'Reflection intensity': 'Intenzita odleskov', 'Condensation / fog': 'Zarosenie / hmla',
    'Condensation intensity': 'Intenzita zarosenia', 'Rain streaks': 'Pruhy dažďa', 'Out-of-focus rain falling outside.': 'Rozostrený dážď padajúci vonku.',
    'Streak intensity': 'Intenzita pruhov',
    // atmosphere
    'Rain sound': 'Zvuk dažďa', 'Rain ambience volume': 'Hlasitosť dažďa', 'Soundscape': 'Prostredie',
    'Window': 'Okno', 'Tin roof': 'Plechová strecha', 'Leaves': 'Lístie', 'Car': 'Auto', 'Wind': 'Vietor', 'Wind volume': 'Hlasitosť vetra',
    'Thunder': 'Hrom', 'Occasional distant or close thunder.': 'Občasný vzdialený alebo blízky hrom.', 'Lightning flashes': 'Blesky',
    'Automatic day / night': 'Automatický deň / noc',
    'Follows the sun at your location (weather city, otherwise your time zone).': 'Riadi sa slnkom vo tvojej polohe (mesto z počasia, inak časové pásmo).',
    'Day / Night': 'Deň / Noc', 'Night ': 'Noc ', 'Day ': 'Deň ', 'Neutral ': 'Neutrálne ',
    'Sync rain with real weather': 'Dážď podľa skutočného počasia',
    'Updates every 15 minutes. Manual changes are overwritten on the next update.': 'Aktualizuje sa každých 15 minút. Ručné zmeny sa pri ďalšej aktualizácii prepíšu.',
    'City, e.g. Bratislava': 'Mesto, napr. Bratislava', 'Set location': 'Nastaviť polohu',
    'Rain intensity and thunder follow the real weather at your location (Open-Meteo).': 'Intenzita dažďa a hrom sa riadia skutočným počasím vo tvojej polohe (Open-Meteo).',
    'Weather location set: ': 'Poloha pre počasie: ', 'updated': 'aktualizované',
    // presets
    'Preset name': 'Názov predvoľby', 'Save': 'Uložiť', 'Load': 'Načítať', 'Delete': 'Zmazať', 'Built-in': 'Vstavaná',
    'Preset saved': 'Predvoľba uložená', 'Preset loaded': 'Predvoľba načítaná', 'Import…': 'Importovať…', 'Export': 'Exportovať',
    'Preset imported': 'Predvoľba importovaná', 'Preset exported': 'Predvoľba exportovaná', 'Generating previews…': 'Generujem náhľady…',
    // system
    'Live wallpaper': 'Živá tapeta', 'Show the rain on your desktop (all monitors).': 'Zobraziť dážď na ploche (všetky monitory).',
    'Start with Windows': 'Spustiť s Windows', 'Pause when a fullscreen app or game runs': 'Pozastaviť pri hre alebo aplikácii na celú obrazovku',
    'Pause on monitors covered by maximized windows': 'Pozastaviť na monitoroch zakrytých maximalizovaným oknom',
    'Saves GPU while you work; sound keeps playing.': 'Šetrí grafickú kartu pri práci; zvuk hrá ďalej.',
    'Pause on battery power': 'Pozastaviť na batérii', 'Frame rate': 'Snímková frekvencia', 'Max': 'Max',
    'Render resolution': 'Rozlíšenie vykresľovania', 'Lower values save GPU on 4K displays.': 'Nižšie hodnoty šetria grafickú kartu na 4K monitoroch.',
    'Global shortcuts': 'Globálne skratky', 'Ctrl+Alt+R pause / resume rain · Ctrl+Alt+W wallpaper on / off · Ctrl+Alt+S open settings': 'Ctrl+Alt+R pauza / pokračovať · Ctrl+Alt+W tapeta zap / vyp · Ctrl+Alt+S otvoriť nastavenia',
    'Install updates automatically': 'Inštalovať aktualizácie automaticky', 'Check for updates': 'Skontrolovať aktualizácie',
    'Export a web wallpaper project (with your image and current settings) that can be imported into Wallpaper Engine.': 'Exportuje web projekt (s tvojím obrázkom a nastaveniami), ktorý sa dá importovať do Wallpaper Engine.',
    'Export project…': 'Exportovať projekt…', 'Exported to ': 'Exportované do ', 'Open log file': 'Otvoriť log',
    'Desktop mode: ': 'Režim plochy: ', 'Behind icons (Windows 11 24H2+)': 'Za ikonami (Windows 11 24H2+)', 'Behind icons (WorkerW)': 'Za ikonami (WorkerW)', 'Failed – see log': 'Zlyhalo – pozri log',
    'Wallpaper FPS ': 'FPS tapety ', 'CPU ': 'CPU ', 'RAM ': 'RAM ', 'GPU ': 'GPU ', ' · Primary': ' · Hlavný', ' · paused (covered)': ' · pozastavený (zakrytý)',
    'Automatic': 'Automaticky', 'English': 'English', 'Slovenčina': 'Slovenčina', 'Version': 'Verzia',
    // toolbar & status
    'Pause rain': 'Pozastaviť dážď', 'Resume rain': 'Pokračovať', 'Restart rain': 'Reštart dažďa', 'Full screen': 'Celá obrazovka',
    'Reset settings': 'Obnoviť nastavenia', 'Settings restored to defaults': 'Nastavenia obnovené na predvolené', 'Live preview': 'Živý náhľad',
    'Clear the glass and start again': 'Vyčistiť sklo a začať odznova', 'Full screen preview': 'Náhľad na celú obrazovku', 'Restore default effect settings': 'Obnoviť predvolené nastavenia efektu',
    'Monitors ': 'Monitory ', 'Preview ': 'Náhľad ', 'Drops ': 'Kvapky ', 'Preview unavailable: ': 'Náhľad nedostupný: ',
    'Live': 'Naživo', 'Paused': 'Pozastavené', 'Wallpaper off': 'Tapeta vypnutá', 'Wallpaper error': 'Chyba tapety', 'Desktop attach failed': 'Vloženie na plochu zlyhalo',
    'Sleeping · ': 'Spí · ', 'fullscreen app': 'aplikácia na celú obrazovku', 'on battery': 'na batérii', 'locked': 'zamknuté', 'system sleep': 'spánok', 'paused': 'pozastavené',
    'Double-click a slider to reset it': 'Dvojklik na posuvník ho vráti na predvolenú hodnotu',
    // tray
    'Restart to update': 'Reštartovať a aktualizovať', 'Automatic updates work in the installed version.': 'Automatické aktualizácie fungujú v nainštalovanej verzii.',
    'Checking for updates…': 'Hľadám aktualizácie…', 'You have the latest version.': 'Máš najnovšiu verziu.', 'Downloading update': 'Sťahujem aktualizáciu',
    'Update ready': 'Aktualizácia pripravená', 'Update failed': 'Aktualizácia zlyhala',
    'Microsoft Store version: turn on "Rainy Glass" in Task Manager → Startup apps.': 'Verzia z Microsoft Store: zapni „Rainy Glass“ v Správcovi úloh → Aplikácie pri spustení.',
    'Depth parallax': 'Hĺbková paralaxa', 'The background moves slightly with the cursor, like looking through a real window.': 'Pozadie sa jemne posúva s kurzorom, ako keď pozeráš cez skutočné okno.',
    'Weather': 'Počasie', 'Snow': 'Sneh', 'Frost': 'Námraza', 'Ice crystals grow from the window frame. Wipe them with the mouse.': 'Ľadové kryštály rastú od rámu okna. Zotrieš ich myšou.',
    'Pause for these apps': 'Pozastaviť pre tieto aplikácie', 'Comma separated program names. The wallpaper pauses while one of them is in front.': 'Názvy programov oddelené čiarkou. Tapeta sa pozastaví, keď je niektorý z nich v popredí.',
    'Screensaver': 'Šetrič obrazovky', 'Rain screensaver': 'Dažďový šetrič obrazovky', 'Start after': 'Spustiť po', 'Show clock': 'Zobraziť hodiny', 'Try screensaver': 'Vyskúšať šetrič',
    'Sleep timer': 'Časovač spánku', 'Turn off sound after': 'Vypnúť zvuk po', 'Off': 'Vyp', 'Sound fades out in': 'Zvuk stíchne o',
    'The rain sound slowly fades out and turns off.': 'Zvuk dažďa postupne stíchne a vypne sa.',
    'Schedule': 'Plánovač', 'Change the look during the day': 'Meniť vzhľad počas dňa',
    'E.g. foggy morning, steady rain in the afternoon, storm at night – with its own image.': 'Napr. hmlisté ráno, popoludní dážď, v noci búrka – aj s vlastným obrázkom.',
    'Keep current look': 'Ponechať aktuálny vzhľad', 'Keep current image': 'Ponechať aktuálny obrázok', 'Image': 'Obrázok', 'Add time': 'Pridať čas',
    'After the Storm': 'Po búrke', 'Snowy Window': 'Zasnežené okno', 'Frosty Morning': 'Mrazivé ráno',
    'Gallery': 'Galéria', 'Animated': 'Animované', 'Match the look': 'Prispôsobiť vzhľad', 'Custom file…': 'Vlastný súbor…',
    'Choosing a scene also applies the rain preset that suits it.': 'Výber scény nastaví aj predvoľbu dažďa, ktorá k nej sedí.',
    'This animated background is not available yet.': 'Toto animované pozadie zatiaľ nie je k dispozícii.',
    'Forest Cabin': 'Chatka v lese', 'Old Town at Night': 'Staré mesto v noci', 'Reading Nook': 'Kútik na čítanie', 'Misty Lake': 'Hmlisté jazero',
    'Autumn Park': 'Jesenný park', 'Snowy Village': 'Zasnežená dedinka', 'Tokyo Alley': 'Tokijská ulička', 'Stormy Lighthouse': 'Maják v búrke',
    'Snow shows its own settings below.': 'Pri snehu sa nižšie zobrazia nastavenia snehu.', 'Snow intensity': 'Intenzita snehu',
    'How much snow sticks to the glass.': 'Koľko snehu sa nalepí na sklo.', 'Flake size': 'Veľkosť vločiek', 'Melting speed': 'Rýchlosť topenia',
    'How fast the snow on the glass melts away.': 'Ako rýchlo sa sneh na skle roztopí.', 'Falling snow outside': 'Padajúci sneh vonku',
    'Snowflakes falling behind the window. 0 = off.': 'Vločky padajúce za oknom. 0 = vypnuté.',
    'Open Settings': 'Otvoriť nastavenia', 'Change background…': 'Zmeniť pozadie…', 'Quit': 'Ukončiť',
  };

  const LANGS = { sk: SK };
  let current = 'en';

  /** 'auto' → language from the OS locale. */
  function resolve(setting, locale) {
    if (setting && setting !== 'auto') return LANGS[setting] ? setting : 'en';
    const l = String(locale || '').toLowerCase();
    return l.startsWith('sk') || l.startsWith('cs') ? 'sk' : 'en';
  }

  function setLanguage(lang) { current = LANGS[lang] ? lang : 'en'; }
  function t(text) { const d = LANGS[current]; return (d && d[text]) || text; }

  return { t, setLanguage, resolve, get language() { return current; } };
});
