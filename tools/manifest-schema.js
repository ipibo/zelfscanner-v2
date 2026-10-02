/**
 * Validatie van pack/manifest.json -- één plek, gebruikt door
 * tools/build-manifest.js (route -> manifest) en tools/preview-server.js
 * (story editor slaat direct op). Laptop-only, draait nooit op het device.
 *
 * Vorm (zie README, "Content-pack pipeline"):
 *   {
 *     version, resetScan,
 *     splash:      {image, sliderColor, sliderText, startScan, fullImage},
 *     instruction: {text, seconds},
 *     intro:       {src},
 *     audiotour:   {image},
 *     wrongScan:   {text, buttonText},
 *     stops: [{id, scan,
 *              hint:   {type, src, animation, text, background},
 *              reward: {type, src, seconds},
 *              help:   {image, text}}],
 *     end:         {image, barColor, barText, fullImage}
 *   }
 */
const fs = require('fs');
const path = require('path');

const BARCODE_RE = /^\d{8,14}$/;
const COLOR_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const MAX_INSTRUCTION_SECONDS = 60;
const MAX_PAGE_SECONDS = 600;
// zelfde namen als pack/fx.js; 'none' = geen animatie
const ANIMATIONS = ['none', 'fade', 'slide', 'drop', 'zoom', 'bounce'];

// Soort bestand -> extensies. Ook gebruikt door preview-server.js (uploads,
// bestandslijst).
const EXT = {
  video: new Set(['.mp4', '.mov', '.webm']),
  audio: new Set(['.mp3', '.wav', '.m4a']),
  image: new Set(['.png', '.jpg', '.jpeg', '.webp']),
  page: new Set(['.html', '.htm']),
};

// type -> soort bestand. Bij narrator (verteller) is src het figuurtje,
// optioneel; de tekst is de hint.
const HINT_TYPES = {image: 'image', puzzle: 'image', video: 'video', page: 'page', narrator: 'image'};
const REWARD_TYPES = {audio: 'audio', video: 'video', page: 'page'};

function isObject(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function validateManifest(manifest, packDir) {
  const errors = [];
  if (!isObject(manifest)) return ['manifest is geen object'];
  if (manifest.scenes) {
    return ['manifest heeft nog "scenes" (oud formaat) — gebruik "stops", zie README'];
  }
  if (!Array.isArray(manifest.stops) || manifest.stops.length === 0) {
    return ['manifest heeft geen stops'];
  }

  function checkFile(label, rel, kind) {
    if (rel === undefined || rel === null || rel === '') return;
    if (typeof rel !== 'string' || !fs.existsSync(path.join(packDir, rel))) {
      errors.push(`${label}: bestand niet gevonden: ${rel}`);
    } else if (!EXT[kind].has(path.extname(rel).toLowerCase())) {
      errors.push(`${label}: ${rel} is geen ${kind}-bestand`);
    }
  }
  function checkColor(label, color) {
    if (color && !COLOR_RE.test(color)) {
      errors.push(`${label} "${color}" is geen hex-kleur (bv. #ffff5c)`);
    }
  }
  function checkText(label, text) {
    if (text !== undefined && typeof text !== 'string') {
      errors.push(`${label} is geen tekst`);
    }
  }
  function section(key, label) {
    const v = manifest[key];
    if (v === undefined) return {};
    if (!isObject(v)) {
      errors.push(`${label}: geen object`);
      return {};
    }
    return v;
  }

  // Zonder reset-barcode kan een scanner na het eindscherm alleen via de cradle
  // terug naar het splash-scherm, dus verplicht.
  if (!manifest.resetScan) {
    errors.push('splash: reset-barcode ontbreekt (terug naar het splash-scherm)');
  } else if (!BARCODE_RE.test(manifest.resetScan)) {
    errors.push(`splash: reset-barcode "${manifest.resetScan}" ziet er niet uit als een barcode (8-14 cijfers)`);
  }

  const splash = section('splash', 'splash');
  checkColor('splash: slider-kleur', splash.sliderColor);
  checkText('splash: slider-tekst', splash.sliderText);
  checkFile('splash: afbeelding', splash.image, 'image');
  if (splash.startScan !== undefined && splash.startScan !== null && splash.startScan !== '') {
    if (!BARCODE_RE.test(splash.startScan)) {
      errors.push(`splash: start-barcode "${splash.startScan}" ziet er niet uit als een barcode (8-14 cijfers)`);
    } else if (splash.startScan === manifest.resetScan) {
      errors.push('splash: start-barcode is gelijk aan de reset-barcode — kies een andere');
    }
  }
  if (splash.fullImage && !splash.startScan) {
    errors.push('splash: zonder slider kan alleen de start-barcode de story starten — vul die in');
  }

  const instruction = section('instruction', 'luisterinstructie');
  const secs = instruction.seconds;
  if (secs !== undefined && !(typeof secs === 'number' && secs >= 0 && secs <= MAX_INSTRUCTION_SECONDS)) {
    errors.push(`luisterinstructie: duur moet 0 t/m ${MAX_INSTRUCTION_SECONDS} seconden zijn (0 = overslaan)`);
  }
  checkText('luisterinstructie: tekst', instruction.text);

  const intro = section('intro', 'intro-audio');
  checkFile('intro-audio', intro.src, 'audio');

  const audiotour = section('audiotour', 'audiotour-scherm');
  checkFile('audiotour-scherm: achtergrond', audiotour.image, 'image');

  const wrongScan = section('wrongScan', 'verkeerde scan');
  checkText('verkeerde scan: tekst', wrongScan.text);
  checkText('verkeerde scan: knoptekst', wrongScan.buttonText);

  const end = section('end', 'eindscherm');
  checkColor('eindscherm: balk-kleur', end.barColor);
  checkText('eindscherm: balk-tekst', end.barText);
  checkFile('eindscherm: afbeelding', end.image, 'image');

  const ids = new Set();
  const scans = new Map(); // barcode -> stop id
  manifest.stops.forEach((stop, i) => {
    if (!isObject(stop) || !stop.id) {
      errors.push(`stop #${i + 1}: mist een naam (id)`);
      return;
    }
    const name = `stop "${stop.id}"`;
    if (ids.has(stop.id)) errors.push(`dubbele stop-naam: "${stop.id}"`);
    ids.add(stop.id);

    // De beloning hangt aan de barcode, dus elke stop een eigen code.
    if (!stop.scan) {
      errors.push(`${name}: product-barcode ontbreekt`);
    } else if (!BARCODE_RE.test(stop.scan)) {
      errors.push(`${name}: barcode "${stop.scan}" ziet er niet uit als een barcode (8-14 cijfers)`);
    } else if (stop.scan === manifest.resetScan) {
      errors.push(`${name}: barcode is gelijk aan de reset-barcode — kies een andere`);
    } else if (stop.scan === splash.startScan) {
      errors.push(`${name}: barcode is gelijk aan de start-barcode — kies een andere`);
    } else if (scans.has(stop.scan)) {
      errors.push(`${name}: barcode "${stop.scan}" wordt ook al gebruikt door stop "${scans.get(stop.scan)}"`);
    } else {
      scans.set(stop.scan, stop.id);
    }

    [
      ['hint', HINT_TYPES, 'image, puzzle, video, page of narrator'],
      ['reward', REWARD_TYPES, 'audio, video of page'],
    ].forEach(([key, types, allowed]) => {
      const label = `${name}: ${key === 'hint' ? 'hint' : 'beloning'}`;
      const part = stop[key];
      if (part === undefined) return;
      if (!isObject(part)) {
        errors.push(`${label} is geen object`);
        return;
      }
      if (!Object.prototype.hasOwnProperty.call(types, part.type)) {
        errors.push(`${label}: type "${part.type}" bestaat niet (${allowed})`);
        return;
      }
      checkFile(label, part.src, types[part.type]);
      if (part.animation !== undefined && !ANIMATIONS.includes(part.animation)) {
        errors.push(`${label}: animatie "${part.animation}" bestaat niet (${ANIMATIONS.join(', ')})`);
      }
      if (part.type === 'narrator') {
        if (typeof part.text !== 'string' || !part.text.trim()) {
          errors.push(`${label}: verteller heeft geen tekst voor de ballon`);
        }
        checkFile(`${label}: achtergrond`, part.background, 'image');
      }
      if (part.type === 'page' && part.seconds !== undefined) {
        const s = part.seconds;
        if (!(typeof s === 'number' && s > 0 && s <= MAX_PAGE_SECONDS)) {
          errors.push(`${label}: duur moet 1 t/m ${MAX_PAGE_SECONDS} seconden zijn`);
        }
      }
    });

    if (stop.help !== undefined) {
      if (!isObject(stop.help)) {
        errors.push(`${name}: hulp is geen object`);
      } else {
        checkFile(`${name}: hulp-afbeelding`, stop.help.image, 'image');
        checkText(`${name}: hulp-tekst`, stop.help.text);
      }
    }
  });

  return errors;
}

module.exports = {
  BARCODE_RE,
  COLOR_RE,
  MAX_INSTRUCTION_SECONDS,
  MAX_PAGE_SECONDS,
  ANIMATIONS,
  EXT,
  HINT_TYPES,
  REWARD_TYPES,
  validateManifest,
};
