This is a new [**React Native**](https://reactnative.dev) project, bootstrapped using [`@react-native-community/cli`](https://github.com/react-native-community/cli).

# Getting Started

>**Note**: Make sure you have completed the [React Native - Environment Setup](https://reactnative.dev/docs/environment-setup) instructions till "Creating a new application" step, before proceeding.

## Step 1: Start the Metro Server

First, you will need to start **Metro**, the JavaScript _bundler_ that ships _with_ React Native.

To start Metro, run the following command from the _root_ of your React Native project:

```bash
# using npm
npm start

# OR using Yarn
yarn start
```

## Step 2: Start your Application

Let Metro Bundler run in its _own_ terminal. Open a _new_ terminal from the _root_ of your React Native project. Run the following command to start your _Android_ or _iOS_ app:

### For Android

```bash
# using npm
npm run android

# OR using Yarn
yarn android
```

### For iOS

```bash
# using npm
npm run ios

# OR using Yarn
yarn ios
```

If everything is set up _correctly_, you should see your new app running in your _Android Emulator_ or _iOS Simulator_ shortly provided you have set up your emulator/simulator correctly.

This is one way to run your app — you can also run it directly from within Android Studio and Xcode respectively.

## Step 3: Modifying your App

Now that you have successfully run the app, let's modify it.

1. Open `App.tsx` in your text editor of choice and edit some lines.
2. For **Android**: Press the <kbd>R</kbd> key twice or select **"Reload"** from the **Developer Menu** (<kbd>Ctrl</kbd> + <kbd>M</kbd> (on Window and Linux) or <kbd>Cmd ⌘</kbd> + <kbd>M</kbd> (on macOS)) to see your changes!

   For **iOS**: Hit <kbd>Cmd ⌘</kbd> + <kbd>R</kbd> in your iOS Simulator to reload the app and see your changes!

## Congratulations! :tada:

You've successfully run and modified your React Native App. :partying_face:

### Now what?

- If you want to add this new React Native code to an existing application, check out the [Integration guide](https://reactnative.dev/docs/integration-with-existing-apps).
- If you're curious to learn more about React Native, check out the [Introduction to React Native](https://reactnative.dev/docs/getting-started).

# zsdeploy — multi-device deploy over adb/wifi

`./zsdeploy` pusht de content-pack (`pack/`) en de app naar meerdere Zebra
scanners (MC18N0, PS20J) tegelijk, en laat zien welke versie elk device echt
draait. Bash + adb, geen server/MDM/StageNow.

```bash
./zsdeploy pair mc1        # eenmalig via USB, per device: tcpip aan + IP opslaan in devices.txt
./zsdeploy connect         # daarna altijd over wifi
./zsdeploy push            # content-pack naar alle devices, atomische swap
./zsdeploy status          # welke versie draait waar — vlagt afwijkingen
```

Zie `./zsdeploy -h` voor alle subcommando's en opties (`--model`, `--parallel`,
`--dry-run`, `--restart`).

**Let op — `adb tcpip` overleeft geen reboot.** Na een herstart van het device
valt de wifi-adb verbinding weg en moet je `pair` opnieuw via USB draaien.
Er is geen bevestigde manier gevonden om dit blijvend te maken op deze
Zebra-builds. Een kandidaat op stock AOSP is `setprop persist.adb.tcp.port
5555` (adbd start dan bij boot al in tcp-mode), maar of de `shell`-user op
deze builds die property mag zetten is niet getest — probeer het zelf, ga er
niet blind van uit dat het werkt.

# Content-pack pipeline (audiotour)

Routes worden geschreven als plain-text bestand in `routes/`, niet direct als
JSON. Formaat: blokken van `key: value` regels, elk blok begint met `scene:`.

```
scene: intro
audio: assets/audio/intro.mp3
text: Welkom. Scan het eerste product.
scan: 8712345678901
next: scene_2
```

Keys: `scene` (id, verplicht), `video`, `image`, `audio`, `text` (caption),
`scan` (verwachte barcode, optioneel voor een eindscene), `next` (expliciete
volgende scene-id).

Een scene is óf een `video`, óf een `image` met `audio`-narratie erbij — nooit
beide. Dus: `video` alleen, of `image` (+ optioneel `audio`), maar niet
`video` samen met `audio` of `image`. `pack:build` en de story editor
weigeren allebei een manifest dat dit schendt.

Bouwen naar `pack/manifest.json`:

```bash
npm run pack:build -- routes/<naam>.txt
```

Valideert: barcode-vorm (8-14 cijfers), of audio/video bestanden echt bestaan
in `pack/assets/`, dubbele scene-ids, en dangling `next`-references.

## Lokale preview (geen device nodig)

```bash
npm run pack:preview
```

Start een static server op `http://localhost:8934/` en opent `preview.html`:
de echte `pack/index.html` in een iframe plus een tekstveld dat scans
simuleert door rechtstreeks `onNativeScan()` aan te roepen — hetzelfde pad
dat de native app via `injectJavaScript` gebruikt. `preview.html` staat
buiten `pack/`, dus dit desktop-only stuk gaat nooit mee naar het device.

(Nodig omdat desktop Chrome/Firefox XHR naar `file://`-buren blokkeert; de
Zebra WebView staat dat wel toe.)

## Story editor (browser)

Zelfde server als hierboven (`npm run pack:preview`), andere pagina:

```
http://localhost:8934/tools/editor.html
```

Visuele editor voor `pack/manifest.json`: scenes toevoegen/verwijderen/
herordenen, per scene een type kiezen — Video (default voor een nieuwe
scene), of Afbeelding + audio (nooit allebei, zie hierboven) —
tekst/verwachte-scan/volgende-scene instellen (dropdowns tonen exact wat er
nu in `pack/assets/` staat), live preview + scan-simulator ernaast, en een
"Opslaan"-knop die direct naar `pack/manifest.json` schrijft (met dezelfde
validatie als `pack:build`).

Scene aanklikken in de linkerlijst springt de live preview rechtstreeks naar
die scene (via een `window.__gotoScene` hook in `pack/runtime.js`, alleen
voor de editor — de native app gebruikt 'm nooit). Bij "verwachte scan"
vult **genereer** een willekeurige unieke 13-cijferige code in.

Bestand uploaden kan ook rechtstreeks vanuit het formulier ("Choose file"
onder video/afbeelding/audio) — landt in `pack/assets/` (video),
`pack/assets/images/` of `pack/assets/audio/`. Zelfde bestand nog een keer
uploaden (bv. dezelfde clip voor twee scenes) hergebruikt het bestaande
bestand op disk in plaats van een kopie te maken.

Video-uploads gaan (als `ffmpeg` in je PATH staat — `brew install ffmpeg`)
automatisch door een normalisatie-stap: HEVC/H.265 → H.264 en
rotatie-metadata gebakken in de pixels. Nodig omdat de MC18N0 (Android 5.1.1
WebView) geen HEVC decodeert en de rotatie-vlag van telefoon-video's negeert
— zonder dit staat een portrait-opname plat en gekanteld op het device, ook
al ziet-ie er op je laptop prima uit. Geen `ffmpeg`? Dan wordt het bestand
ongewijzigd geüpload (werkt mogelijk niet goed op het device).

Let op: dit bewerkt `manifest.json` zelf, niet de `routes/*.txt`-bronnen.
Als je later opnieuw `npm run pack:build -- routes/<naam>.txt` draait,
overschrijft dat je editor-wijzigingen weer.

### Bestandsbeheer

**Bestanden** in de editor-topbar opent `tools/library.html`: overzicht van
alles in `pack/assets/` (video/afbeelding/audio) met preview, bestandsgrootte
en of het "gebruikt door" een scene is of "ongebruikt" staat. Verwijderen kan
per bestand — bij een bestand dat nog in gebruik is, waarschuwt de
bevestiging welke scene(s) het raakt (dat scherpt de scene daarna kapot tot
je er in de editor een ander bestand aan koppelt — `pack:build`/editor-save
vangt dat af met een duidelijke foutmelding).

### Naar de scanners pushen

Onderin de editor: **Push naar scanners** stuurt de huidige `pack/` (dus wat
er laatst is opgeslagen) naar alle devices in `devices.txt`, via het
bestaande [`zsdeploy`](zsdeploy) script (`zsdeploy push pack --parallel`).
"Ververs devices" laat zien wat `adb` nu ziet. "herstart app na push" voegt
`--restart` toe (force-stop + relaunch, zodat de nieuwe pack meteen
zichtbaar wordt op het device).

Vereist dat de devices al gekoppeld zijn (`./zsdeploy pair <naam>` één keer
via USB, zie hierboven) en op hetzelfde WiFi zitten. De editor voert dit
altijd tegen alle devices uit `devices.txt` uit — er is geen knop die maar
naar één device pusht.

# Troubleshooting

If you can't get this to work, see the [Troubleshooting](https://reactnative.dev/docs/troubleshooting) page.

# Learn More

To learn more about React Native, take a look at the following resources:

- [React Native Website](https://reactnative.dev) - learn more about React Native.
- [Getting Started](https://reactnative.dev/docs/environment-setup) - an **overview** of React Native and how setup your environment.
- [Learn the Basics](https://reactnative.dev/docs/getting-started) - a **guided tour** of the React Native **basics**.
- [Blog](https://reactnative.dev/blog) - read the latest official React Native **Blog** posts.
- [`@facebook/react-native`](https://github.com/facebook/react-native) - the Open Source; GitHub **repository** for React Native.
