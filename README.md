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

### Devices herkennen op serienummer

`devices.txt` heeft per regel `naam ip [story] [sn=serienummer]`:

```
mc1 192.168.1.10 speurtocht sn=17321523020091
ps1 192.168.1.6 sn=22096521400402
```

- zsdeploy herkent een device eerst aan zijn serienummer (`getprop
  ro.serialno`), pas daarna aan zijn IP. IP's verschuiven via DHCP, het
  serienummer niet, dus de story blijft bij het juiste device.
- Krijgt een bekend device een nieuw IP, dan zet `push`, `status` en
  `devices` dat zelf in `devices.txt`, zodat `connect` blijft werken.
- `./zsdeploy adopt` geeft live devices zonder naam een naam en
  serienummer. Oude regels zonder serienummer waarvan het IP niet meer
  bestaat, worden eerst hergebruikt (mc voor MC18N0, ps voor PS20J). Welke
  scanner welke oude naam krijgt is dan willekeurig, maar daarna vast.
- `pair` schrijft het serienummer meteen mee.
- Hangt een device aan USB én wifi, dan pusht zsdeploy er één keer naartoe,
  via wifi. Twee pushes tegelijk naar één device maken het pack kapot.

Zie `./zsdeploy -h` voor alle subcommando's en opties (`--model`, `--parallel`,
`--dry-run`, `--restart`).

**Let op — `adb tcpip` overleeft geen reboot.** Na een herstart van het device
valt de wifi-adb verbinding weg en moet je `pair` opnieuw via USB draaien.
Er is geen bevestigde manier gevonden om dit blijvend te maken op deze
Zebra-builds. Een kandidaat op stock AOSP is `setprop persist.adb.tcp.port
5555` (adbd start dan bij boot al in tcp-mode), maar of de `shell`-user op
deze builds die property mag zetten is niet getest — probeer het zelf, ga er
niet blind van uit dat het werkt.

# Content-pack pipeline (story)

## Verloop

Zo loopt een story, vastgelegd op 2026-09-17 met Sjefs storyboard:

1. **Splash-scherm.** De bezoeker swipet om te starten.
2. **Luisterinstructie.** Een melding staat een paar seconden over het beeld.
3. **Intro-audio** (optioneel, `intro.src`). Speelt op het audiotour-scherm.
   Pas als die klaar is begint de speurtocht.
4. **Hint van stop 1.** Afbeelding, puzzel of video van het product dat
   gescand moet worden.
5. **Juiste scan → beloning.** Een audiotour (eerst weer de luisterinstructie)
   of een video. Is die klaar, dan volgt de hint van de volgende stop.
6. **Eindscherm.** Komt na de beloning van de laatste stop. Het blijft staan
   tot de reset-barcode of tot de scanner terug in de cradle gaat.

Een **stop** koppelt een product-barcode aan een hint en een beloning. De
beloning hangt dus aan de barcode, niet aan de plek in de lijst. Daardoor kan
de volgorde later per bezoeker geschud worden en hoort de audiotour van
bijvoorbeeld de gebakken uitjes nog steeds bij de gebakken uitjes. Schudden is
nog niet gebouwd: `resetOrder()` in `pack/runtime.js` is de plek.

Scans:

- **Tijdens een hint:** alleen de barcode van die stop gaat door. Andere
  codes geven "verkeerd product".
- **Tijdens de intro, een beloning, op het splash-scherm en op het eindscherm:** scans
  doen niets.
- **Altijd:** de reset-barcode en terugzetten in de cradle werken, zie
  hieronder.

## Manifest

```json
{
  "version": "0.3.0",
  "resetScan": "8712345679999",
  "splash": {"image": "…", "sliderColor": "#ffff5c", "sliderText": "Swipe to start"},
  "instruction": {"text": "Keep the scanner next to your ear", "seconds": 5},
  "intro": {"src": "assets/audio/intro.mp3"},
  "audiotour": {"image": "…"},
  "stops": [
    {
      "id": "uitjes",
      "scan": "8712345670012",
      "hint": {"type": "puzzle", "src": "assets/images/uitjes.jpg"},
      "reward": {"type": "audio", "src": "assets/audio/uitjes.mp3"}
    }
  ],
  "end": {"image": "…", "barColor": "#ffff5c", "barText": "Please gather at the\nself-checkout"}
}
```

- `hint.type` is `image`, `puzzle`, `video`, `narrator` (verteller) of `page`
  (HTML-pagina). `hint.animation` (optioneel): `fade`, `slide`, `drop`,
  `zoom`, `bounce` of `none`.
- `reward.type` is `audio` (audiotour), `video` of `page`.
- `stop.help` (optioneel): hulp-knop na een verkeerde scan, zie hieronder.
- Een stop zonder hint-bestand toont zwart. Een stop zonder beloning gaat na
  de scan meteen door naar de volgende stop.
- Het oude formaat met losse `scenes` wordt geweigerd. De editor neemt
  splash, instructie en reset-code wel over.

De validatie staat op één plek, `tools/manifest-schema.js`, en wordt gebruikt
door zowel `pack:build` als de story editor. Hij controleert:

- barcodes: 8-14 cijfers, uniek per stop en niet gelijk aan de reset-code
- of bestanden bestaan en van de juiste soort zijn
- kleuren, de duur van de instructie en dubbele stop-namen

## Routes als tekstbestand

Een route kun je ook als plain-text bestand in `routes/` schrijven in plaats
van in de editor. Bovenin staan de instellingen, daarna volgt per stop een
blok dat begint met `stop:`:

```
version: 0.3.0
reset: 8712345679999
splash: assets/images/start.jpg
splashColor: #ffff5c
splashText: Swipe to start
instruction: Keep the scanner next to your ear
instructionSeconds: 5
intro: assets/audio/intro.mp3
audiotour: assets/images/oor.jpg
endImage: assets/images/the-end.png
endColor: #ffff5c
endText: Please gather at the\nself-checkout

stop: uitjes
scan: 8712345670012
hint: puzzle assets/images/uitjes.jpg
reward: audio assets/audio/uitjes.mp3
```

- `reset` is verplicht, de andere instellingen niet.
- `\n` in een tekst betekent een nieuwe regel.
- `hint:` en `reward:` nemen eerst het type en daarna het bestand.
- `scene:` bestaat niet meer.

Bouwen naar `pack/manifest.json`:

```bash
npm run pack:build -- routes/<naam>.txt
```

Voorbeelden: `routes/audiotour-demo.txt` en `routes/puzzel-demo.txt`.

## Splash-scherm en reset-barcode (`pack/splash.js`)

Elke story begint met een splash-scherm, altijd, vóór de eerste stop. Het is
geen stop maar een vast onderdeel van het manifest (`splash`, `resetScan`).

- `image` vult het scherm boven de slider. Leeg = zwart.
- Onderin staat een slider: een wit blok met een pijl op een baan in
  `sliderColor` (leeg = `#ffff5c`), met `sliderText` (leeg = "Swipe to
  start").
  - Sleep je het blok voorbij 60% naar rechts, dan start de story. Minder ver
    en het veert terug.
  - Slepen mag overal op de slider beginnen.
- Scans op het splash-scherm doen niets (geen "verkeerd product").
- **`resetScan` werkt altijd.** Puzzel, video, audio en voortgang zijn weg en
  de scanner staat weer op het splash-scherm, klaar voor de volgende
  bezoeker.
  - Verplicht, en mag niet gelijk zijn aan de barcode van een stop.
  - Printen via **Barcodes (PDF)** in de editor, daar staat hij als rode
    RESET-kaart vooraan.
- **Terug in de cradle doet hetzelfde.** `App.tsx` luistert naar het
  dock-event van de native Cradle-module en geeft de stand door aan
  `window.onNativeDock(true/false)` in het pack, ook bij het laden.
  - Staat het pack al op het splash-scherm, dan gebeurt er niets.
  - Een USB-kabel insteken telt ook als dock.
- **De swipe opent de cradle.** Staat de scanner in de cradle, dan vraagt de
  swipe `App.tsx` om hem te ontgrendelen (`unlockCradle`, 10 s). Dat
  vervangt de oude knop UNLOCK CRADLE.
  - De story start meteen.
  - Zit de scanner er na 15 s nog in (`UNDOCK_WAIT_MS`), dan gaat het pack
    terug naar splash. Anders staat de volgende bezoeker voor een dichte
    cradle zonder swipe.
  - Buiten de cradle start de swipe alleen de story.
  - Op de PS20 loopt de unlock via de accessibility-service. Staat die uit,
    dan gaat de cradle niet open en opent de app ook geen instellingen
    (anders belandt een bezoeker daarin). Zet de service dus aan bij de
    installatie.
- Het cradle-deel zit in de app, niet in het pack: het werkt pas na een
  nieuwe APK-build.
- Naar de native laag gaan `storyStart` (na de swipe) en `reset` (met `from`
  en `by`: `scan` of `cradle`). Beide zijn zichtbaar in de HUD.

Maten en de 60%-grens staan bovenin `pack/splash.js` (`DONE_AT`, CSS in vw).

## Luisterinstructie (`pack/overlay.js`)

Een donkere laag met witte tekst in het midden. Hij verschijnt op twee
momenten, met dezelfde tekst en duur:

```json
"instruction": {"text": "Keep the scanner next to your ear", "seconds": 5}
```

1. **Na het swipen.** De laag fadet in over het splash-scherm. Met
   intro-audio komt bij het wegfaden het audiotour-scherm eronder en start
   de intro, zoals vóór een audiotour-beloning. Zonder intro wisselt het
   beeld eronder naar de hint van stop 1, en na `seconds` fadet de laag weg.
2. **Na elke juiste scan, vóór een audiotour.** De laag komt over de hint te
   liggen. Als hij wegfadet, komt het audiotour-scherm eronder en daarna
   start de audio. Vóór een video-beloning komt geen instructie.

- `text` leeg = "Keep the scanner next to your ear". Een enter in de tekst
  is een nieuwe regel.
- `seconds` leeg = 5, max 60. Bij `0` verschijnt de instructie nooit.
- Scannen tijdens de melding bij de start werkt gewoon als er geen intro is:
  de juiste scan gaat door. Met intro doen scans niets tot de intro klaar is.
  Reset gaat altijd terug naar splash.
- Aanraken tijdens de melding doet niets.

## Intro-audio

Een audiofragment na de splash, vóór de eerste hint:

```json
"intro": {"src": "assets/audio/intro.mp3"}
```

- Speelt op het audiotour-scherm (zelfde achtergrond en knoppen), na de
  luisterinstructie.
- Klaar, of het bestand laadt niet: door naar de hint van stop 1.
- Scans doen niets tijdens de intro, reset en cradle wel.
- Leeg of weg = geen intro, de story loopt zoals vóór 2026-10-01.
- Alleen het pack verandert: geen nieuwe APK nodig.

## Audiotour (`pack/audiotour.js`)

De beloning `"reward": {"type": "audio", …}`. Storyboard: "3. Audiotour".

- **Achtergrond:** beeldvullend, één voor alle audiotours
  (`audiotour.image`). Die visual komt nog van de vormgever. Leeg = groen.
- **Knoppen onderin:**
  - 10 seconden terug
  - pauze/play: het icoon volgt de audio
  - verticale volumeschuif
- **Voortgang:** een geel vlak schuift van links naar rechts, zoals de rode
  balk onder een YouTube-video.
  - Het kleurt het beeld eronder (`mix-blend-mode: hue`), dus het oor blijft
    zichtbaar.
  - Zonder blend-mode wordt het half doorzichtig geel.
- **Volume:** de schuif regelt het volume van de audio zelf (0-1), niet het
  systeemvolume. Zet dat op de scanners dus voluit.
  - De stand blijft staan tussen stops.
  - Na een reset staat het volume weer vol.
- **Einde:** als de audio klaar is, volgt de volgende stop. Scans doen niets
  zolang de audio loopt, alleen reset werkt.
  - Een bestand dat niet laadt, slaat de runtime over, zodat de bezoeker
    niet vastloopt.

Maten staan als vw in de CSS bovenin het bestand, afgeleid van het storyboard
(320 px breed).

## Video als hint of beloning

- **Als hint:** zonder geluid, in een lus, tot de juiste scan.
- **Als beloning:** met geluid, één keer. Daarna volgt de volgende stop.
- **Geluid bij uploads:** video-uploads via de editor houden hun geluid
  (AAC). Oudere uploads zijn zonder geluid opgeslagen; upload die opnieuw als
  ze als beloning geluid nodig hebben.
- **Desktop-preview:** Chrome blokkeert daar soms autoplay met geluid. De
  preview speelt de video dan stil af.

## Verteller (`pack/narrator.js`)

Hint-type uit de IDFA-speurtocht (2025): een figuurtje met een tekstballon.

```json
"hint": {
  "type": "narrator",
  "text": "The product we're looking for is a 15g herb…",
  "src": "assets/images/speurtocht/figuurtjes-02.png",
  "background": "assets/images/speurtocht/background-01.png",
  "animation": "slide"
}
```

- `text` is verplicht: het raadsel in de ballon. Enter = nieuwe regel.
- `src` = het figuurtje, een beeldvullende PNG met transparantie (480x800).
  Komt binnen met `animation` (leeg = `slide`). Leeg = alleen de ballon.
- `background` vult het scherm erachter. Leeg = lichtblauw.
- De ballon popt open als het figuurtje er bijna is.
- **Verkeerde scan:** de ballon wordt oranje en schudt, met de melding en
  het raadsel eronder.

## Verkeerde scan en hulp-knop (`pack/help.js`)

```json
"wrongScan": {"text": "No, that's not the product…", "buttonText": "I need a hint"},
"stops": [{ "help": {"image": "assets/images/…", "text": "We're looking for this detergent."} }]
```

- `wrongScan.text`: de melding bij een verkeerde scan. Leeg = "VERKEERD
  PRODUCT". Bij een verteller in de ballon, anders 1,5 s een rode laag.
- `help` per stop (optioneel): na de eerste verkeerde scan verschijnt onderin
  de knop (`buttonText`, leeg = "I need a hint"). Die opent een kaart met de
  foto (licht vervaagd) en de tekst. × sluit hem, de knop blijft.
- Bij de volgende stop is de knop weer weg. Scans werken door terwijl de kaart
  open is.

## HTML-pagina als hint of beloning (`pack/page.js`)

```json
"hint":   {"type": "page", "src": "assets/pages/raadsel.html", "animation": "zoom"},
"reward": {"type": "page", "src": "assets/pages/goed-gevonden.html", "seconds": 10}
```

- Een eigen `.html`-bestand, beeldvullend. Upload via de editor (kies
  HTML-pagina bij het type), komt in `pack/assets/pages/`. Opnieuw uploaden met
  dezelfde naam **vervangt** de pagina.
- Als hint: tot de juiste scan. Als beloning: `seconds` lang (leeg = 10),
  of tot de pagina zelf `parent.zsDone()` aanroept.
- **Alles in de pagina zelf.** De runtime haalt de pagina op met XHR en zet
  hem via `srcdoc` in een iframe, want `<script src>` van file:// laadt op de
  MC18N0 niet. Dus inline `<style>` en `<script>`. Afbeeldingen en video naast
  de pagina (`assets/pages/`) werken wel (er staat een `<base>` naar die map).
- Chromium 46: JS in ES5, geen CSS-variabelen (`var(--x)`), geen `inset`.
  `@keyframes`, `transform`, `transition`, flex en vw/vh werken wel.
- Voorbeeld met CSS-animaties en confetti: `examples/pages/goed-gevonden.html`.

## Animaties (`pack/fx.js`)

`hint.animation` bepaalt hoe een afbeelding, video, HTML-pagina of het
figuurtje van de verteller in beeld komt: `fade` (invaden), `slide` (van onder
omhoog), `drop` (van boven), `zoom` (pop), `bounce` (omhoog stuiteren).
Leeg/`none` = meteen. Alleen `transform` en `opacity`, dus soepel op de
MC18N0. Nieuwe animaties: bovenin `pack/fx.js` en in `ANIMATIONS` in
`tools/manifest-schema.js` en `tools/editor.html`.

## Start-barcode en beeldvullend splash/eindscherm

- `splash.startScan` (optioneel): scannen op het splash-scherm start de story,
  net als swipen. Staat als START-kaart in Barcodes (PDF).
- `splash.fullImage: true`: geen slider, de afbeelding vult het scherm (als
  "Scan the test code to start!" al in het beeld staat). Vereist `startScan`.
- `end.fullImage: true`: geen balk onder het eindscherm (tekst zit al in het
  beeld).

## Story "speurtocht"

`stories/speurtocht.json` is de IDFA-speurtocht uit
`2024/zelfscanner-keynote/speurtocht`, overgezet naar dit systeem: zes
verteller-stops met hulp-knop en een video als beloning, start-barcode
`123456789`, eindscherm beeldvullend. Media staat in
`pack/assets/images/speurtocht/` en `pack/assets/speurtocht/`. Op een scanner
zetten: kies "speurtocht" in de dropdown **story per device** en push.

## Eindscherm (`pack/end.js`)

Komt na de beloning van de laatste stop. Storyboard: "the end".

```json
"end": {"image": "…", "barColor": "#ffff5c", "barText": "Please gather at the\nself-checkout"}
```

- `image` vult het scherm boven de balk. Leeg = een groen vlak met "the end"
  als tijdelijk beeld, tot de visual er is.
- De balk heeft dezelfde maten als de slider van het splash-scherm.
  - `barText` leeg = "Please gather at the self-checkout". Enter = nieuwe
    regel.
  - `barColor` leeg = `#ffff5c`.
- Blijft staan tot de reset-barcode of de cradle. Andere scans en aanrakingen
  doen niets.
- Stuurt `storyEnd` naar de native laag.

## Puzzel-minigame (`pack/puzzle.js`)

De hint `"hint": {"type": "puzzle", …}`. De foto verschijnt niet in één keer
maar als 3x3 puzzel.

Gedrag, zoals besloten op 2026-09-17:

- **Aanbod:** de stukjes komen in willekeurige volgorde, vier tegelijk, in
  een balk onderin. Legt de bezoeker er een, dan schuift het volgende aan.
- **Leggen:** een stukje klikt alleen vast op zijn eigen plek. Elders veert
  het terug naar de balk, zonder foutmelding; er valt niets te verliezen.
- **De puzzel is een hint, geen horde.** Doorscannen naar het product kan
  altijd, ook halverwege.
  - Elk goed gelegd stukje maakt de hint een stukje duidelijker.
  - Is de puzzel af, dan verdwijnt het raster en blijft het hele beeld in het
    midden staan tot de scan.
- **Native:** bij een opgeloste puzzel gaat er een `puzzleSolved`-bericht
  naar de native laag (zichtbaar in de HUD). Die doet er verder nog niets
  mee.

Het aantal stukjes in de balk en de rastergrootte staan als `SLOTS` en `GRID`
bovenin `pack/puzzle.js`.

Techniek:

- **Slepen:** geen HTML5 drag-and-drop, want dat doet niets op touch in deze
  WebView. Daarom losse `touchstart`/`touchmove`/`touchend`-handlers, met
  muis-events erbij zodat de desktop-preview werkt.
- **Vormen:** de stukjes zijn echte legpuzzelvormen, met nopjes en gaatjes
  die per puzzel willekeurig zijn.
  - Ze worden op `<canvas>` uit één bestand geknipt, dus er hoeft niets
    voorgesneden te worden.
  - Canvas omdat CSS `clip-path` met curves in Chromium 46 nog niet bestaat.
  - De vorm van een nop staat als `KNOB_*` bovenin `pack/puzzle.js`.
- **Laden:** alle modules (`puzzle.js`, `splash.js`, `overlay.js`,
  `audiotour.js`, `end.js`) worden door `pack/index.html` op dezelfde manier
  ingeladen als `runtime.js`: XHR + `eval`, zie de comment daar.

## ES5-check

```bash
npm run pack:check
```

Parst elk `.js`-bestand in `pack/` alsof je Chromium 46 bent. Een pijlfunctie,
`const`, template literal of trailing comma sloopt het pack op de MC18N0
stilletjes — geen foutmelding, gewoon een zwart scherm — en niets daarvan is
zichtbaar in `tsc`, `eslint` of de build. Draai dit voor je pusht.

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

Een visuele editor voor `pack/manifest.json`. De lijst links volgt het
verloop van de story:

1. **Splash:** achtergrond, slider-kleur en -tekst, en de reset-barcode.
2. **Luisterinstructie:** tekst en duur.
3. **Audiotour-scherm:** de achtergrond voor alle audiotours.
4. **Stops:** toevoegen, verwijderen en herordenen met ↑↓. Een stop die nog
   iets mist, krijgt het label "onvolledig".
5. **Eindscherm:** afbeelding, balk-kleur en balk-tekst.

Een nieuwe stop krijgt meteen een unieke barcode. Per stop stel je in:

- **Naam.** Die staat ook op de barcode-kaart.
- **Product-barcode.** **genereer** vult een willekeurige unieke 13-cijferige
  code in.
- **Hint:** Afbeelding, Puzzel of Video, plus het bestand.
- **Beloning:** Audiotour of Video, plus het bestand.

Wissel je tussen Afbeelding en Puzzel, dan blijft het bestand staan. Andere
wissels maken het bestandsveld leeg. De dropdowns tonen precies wat er nu in
`pack/assets/` staat.

**Live preview.** Rechts staat de preview met een scan-simulator.

- Klik je een onderdeel aan, dan springt de preview ernaartoe, met wat er
  nu in de editor staat, ook als het nog niet is opgeslagen.
- Bij een stop wissel je met **toon** (hint) en **speel** (beloning, zonder
  de instructie ervoor).
- **In cradle** / **Uit cradle** zet de scanner in of uit de cradle, zoals
  op het device. Erin gaat terug naar splash, en een swipe in de cradle gaat
  na 15 s terug naar splash als je hem niet uithaalt.
- Dit loopt via `window.__editorPreview` in `pack/runtime.js`. Die hook is
  alleen voor de editor; de native app gebruikt hem nooit.

**Opslaan** schrijft direct naar `pack/manifest.json`, met dezelfde
validatie als `pack:build`.

**Bestanden uploaden** kan rechtstreeks vanuit het formulier ("Choose
file").

- Uploads landen in `pack/assets/` (video), `pack/assets/images/` of
  `pack/assets/audio/`.
- Upload je hetzelfde bestand nog een keer, dan wordt het bestaande bestand
  op disk hergebruikt in plaats van een kopie gemaakt.

**Video-uploads** gaan automatisch door een normalisatie-stap, als `ffmpeg`
in je PATH staat (`brew install ffmpeg`).

- Wat er gebeurt:
  - HEVC/H.265 wordt H.264.
  - De rotatie-metadata wordt in de pixels gebakken.
  - Geluid wordt AAC.
- Waarom: de MC18N0 (Android 5.1.1 WebView) decodeert geen HEVC en negeert
  de rotatie-vlag van telefoon-video's. Zonder deze stap staat een
  portrait-opname plat en gekanteld op het device, ook al ziet hij er op je
  laptop prima uit.
- Geen `ffmpeg`? Dan wordt het bestand ongewijzigd geüpload en werkt het
  mogelijk niet goed op het device.

Let op: de editor bewerkt `manifest.json` zelf, niet de
`routes/*.txt`-bronnen. Draai je later opnieuw
`npm run pack:build -- routes/<naam>.txt`, dan overschrijft dat je
editor-wijzigingen.

Draait de preview-server al sinds vóór een update van `tools/`? Herstart hem
dan. De server laadt de validatie maar één keer in.

### Bestandsbeheer

**Bestanden** in de editor-topbar opent `tools/library.html`: overzicht van
alles in `pack/assets/` (video/afbeelding/audio) met preview, bestandsgrootte
en waar het gebruikt wordt (splash, audiotour-scherm, eindscherm, of een
stop als hint of beloning), of "ongebruikt". Verwijderen kan per bestand.

Is een bestand nog in gebruik, dan noemt de bevestiging wat het raakt. Dat
onderdeel is daarna kapot tot je er in de editor een ander bestand aan
koppelt; `pack:build` en opslaan in de editor vangen dat af met een
duidelijke foutmelding.

### Naar de scanners pushen

Onderin de editor: vink bij **push naar / story** de scanners aan (of
**alles**/**geen**) en klik **Push naar …**. Dat stuurt de huidige `pack/`
(dus wat er laatst is opgeslagen) alleen naar de aangevinkte devices, via
het bestaande [`zsdeploy`](zsdeploy) script (`zsdeploy push pack --parallel
--only mc1,ps1`). De vinkjes onthoudt de browser. Het pack is tientallen MB:
reken op een paar minuten per push, de editor wacht maximaal 30 minuten.
"Ververs devices" laat zien wat `adb` nu ziet. "herstart app na push" voegt
`--restart` toe (force-stop + relaunch, zodat de nieuwe pack meteen
zichtbaar wordt op het device).

Vereist dat de devices al gekoppeld zijn (`./zsdeploy pair <naam>` één keer
via USB, zie hierboven) en op hetzelfde WiFi zitten. "herstart app na push"
herstart alleen de aangevinkte devices.

### Andere story per device

Niet elk device hoeft dezelfde story te draaien. `pack/manifest.json` is de
story **standaard**; extra stories staan los in `stories/<naam>.json`. De media
blijft gedeeld in `pack/assets/` en gaat naar elk device.

- Linksboven in de editor kies je welke story je bewerkt. **+ nieuw** maakt een
  kopie van de story die open staat; hij bestaat pas na **Opslaan**.
  Barcodes (PDF) toont de barcodes van de open story.
- Onder de pushbalk staat per device een dropdown: welke story dat device
  krijgt. Dat wordt meteen in `devices.txt` gezet, als derde kolom:

  ```
  mc6 192.168.1.31 kids sn=19040523020287
  mc7 192.168.1.5 kids sn=18157523020523
  ```

  Geen story = standaard. `zsdeploy pair` en de editor laten story en
  serienummer staan.
- Bij een push zet `zsdeploy` voor zo'n device `stories/<naam>.json` als
  `manifest.json` in de staging, en vergelijkt daartegen (byte-diff). Bestaat
  de story niet, dan stopt de push vóórdat er een device wordt aangeraakt.
  `./zsdeploy push --dry-run` laat per device de story zien.
- Let op: `zsdeploy status` vergelijkt versies nog met de meerderheid; devices
  met een andere story (en ander versienummer) staan daar als AFWIJKEND.

# Troubleshooting

If you can't get this to work, see the [Troubleshooting](https://reactnative.dev/docs/troubleshooting) page.

# Learn More

To learn more about React Native, take a look at the following resources:

- [React Native Website](https://reactnative.dev) - learn more about React Native.
- [Getting Started](https://reactnative.dev/docs/environment-setup) - an **overview** of React Native and how setup your environment.
- [Learn the Basics](https://reactnative.dev/docs/getting-started) - a **guided tour** of the React Native **basics**.
- [Blog](https://reactnative.dev/blog) - read the latest official React Native **Blog** posts.
- [`@facebook/react-native`](https://github.com/facebook/react-native) - the Open Source; GitHub **repository** for React Native.
