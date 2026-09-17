#!/usr/bin/env node
/**
 * Route source (.txt, indented key:value blocks) -> pack/manifest.json.
 * Build-time only -- runs on the laptop with Node, never on the device.
 * Usage: node tools/build-manifest.js routes/<name>.txt [out/manifest.json]
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const BARCODE_RE = /^\d{8,14}$/;
const COLOR_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const MAX_INSTRUCTION_SECONDS = 60;

// Splash-, instructie- en reset-instellingen staan bovenin de route, net als
// "version".
const TOP_LEVEL = {
  reset: 'resetScan',
  splash: 'image',
  splashcolor: 'sliderColor',
  splashtext: 'sliderText',
  instruction: 'text',
  instructionseconds: 'seconds',
};

function parseRoute(src) {
  const lines = src.split(/\r?\n/);
  let version = '0.1.0';
  let resetScan = null;
  const splash = {};
  const instruction = {};
  const scenes = [];
  let current = null;

  lines.forEach((rawLine, i) => {
    const lineNo = i + 1;
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      return;
    }
    const m = line.match(/^([a-zA-Z]+)\s*:\s*(.*)$/);
    if (!m) {
      throw new Error(`route:${lineNo}: kan regel niet parsen: "${rawLine}"`);
    }
    const key = m[1].toLowerCase();
    const value = m[2].trim();

    if (key === 'version' || TOP_LEVEL[key]) {
      if (current) {
        throw new Error(`route:${lineNo}: "${key}" moet vóór de eerste scene staan`);
      }
      if (key === 'version') version = value;
      else if (key === 'reset') resetScan = value;
      else if (key === 'instruction') instruction.text = value;
      else if (key === 'instructionseconds') instruction.seconds = Number(value);
      else splash[TOP_LEVEL[key]] = value;
      return;
    }
    if (key === 'scene') {
      current = {id: value, _line: lineNo};
      scenes.push(current);
      return;
    }
    if (!current) {
      throw new Error(`route:${lineNo}: "${key}" buiten een scene-blok (mist "scene:" ervoor?)`);
    }
    if (
      key === 'audio' ||
      key === 'video' ||
      key === 'image' ||
      key === 'puzzle' ||
      key === 'text' ||
      key === 'next'
    ) {
      current[key] = value;
    } else if (key === 'scan') {
      current.expectScan = value;
    } else {
      throw new Error(`route:${lineNo}: onbekende key "${key}"`);
    }
  });

  return {version: version, resetScan: resetScan, splash: splash, instruction: instruction, scenes: scenes};
}

function validate(route, assetsBaseDir) {
  const errors = [];
  const ids = new Set();

  // Zonder reset-barcode kan een scanner na de laatste scene nooit meer terug
  // naar het splash-scherm, dus verplicht.
  if (!route.resetScan) {
    errors.push('"reset: <barcode>" ontbreekt bovenin de route (terug naar het splash-scherm)');
  } else if (!BARCODE_RE.test(route.resetScan)) {
    errors.push(`reset "${route.resetScan}" ziet er niet uit als een barcode (8-14 cijfers)`);
  } else {
    route.scenes.forEach(scene => {
      if (scene.expectScan === route.resetScan) {
        errors.push(`reset "${route.resetScan}" is ook de scan van scene "${scene.id}" — kies een andere`);
      }
    });
  }
  if (route.splash.sliderColor && !COLOR_RE.test(route.splash.sliderColor)) {
    errors.push(`splashColor "${route.splash.sliderColor}" is geen hex-kleur (bv. #ffff5c)`);
  }
  if (route.splash.image && !fs.existsSync(path.join(assetsBaseDir, route.splash.image))) {
    errors.push(`splash bestand niet gevonden: ${route.splash.image}`);
  }
  const secs = route.instruction.seconds;
  if (secs !== undefined && !(secs >= 0 && secs <= MAX_INSTRUCTION_SECONDS)) {
    errors.push(`instructionSeconds moet een getal van 0 t/m ${MAX_INSTRUCTION_SECONDS} zijn (0 = geen instructie)`);
  }

  route.scenes.forEach(scene => {
    if (!scene.id) {
      errors.push(`scene zonder id (regel ${scene._line})`);
      return;
    }
    if (ids.has(scene.id)) {
      errors.push(`dubbele scene id: "${scene.id}" (regel ${scene._line})`);
    }
    ids.add(scene.id);

    if (scene.expectScan && !BARCODE_RE.test(scene.expectScan)) {
      errors.push(`scene "${scene.id}": scan "${scene.expectScan}" ziet er niet uit als een barcode (8-14 cijfers)`);
    }

    // Een scene is óf een video, óf een foto met audio-narratie, óf een
    // puzzel met audio-narratie -- nooit twee beelddragers tegelijk.
    const visuals = ['video', 'image', 'puzzle'].filter(f => scene[f]);
    if (visuals.length > 1) {
      errors.push(`scene "${scene.id}": ${visuals.join(' en ')} kunnen niet allebei tegelijk (kies één)`);
    }
    if (scene.video && scene.audio) {
      errors.push(`scene "${scene.id}": video en audio kunnen niet allebei tegelijk (video staat op zichzelf, narratie hoort bij image of puzzle)`);
    }

    ['audio', 'video', 'image', 'puzzle'].forEach(field => {
      if (scene[field]) {
        const full = path.join(assetsBaseDir, scene[field]);
        if (!fs.existsSync(full)) {
          errors.push(`scene "${scene.id}": ${field} bestand niet gevonden: ${scene[field]} (verwacht op ${full})`);
        }
      }
    });
  });

  route.scenes.forEach(scene => {
    if (scene.next && !ids.has(scene.next)) {
      errors.push(`scene "${scene.id}": next "${scene.next}" verwijst naar een scene die niet bestaat`);
    }
  });

  return errors;
}

function toManifest(route) {
  const splash = {};
  ['image', 'sliderColor', 'sliderText'].forEach(field => {
    if (route.splash[field]) splash[field] = route.splash[field];
  });
  const instruction = {};
  if (route.instruction.text) instruction.text = route.instruction.text;
  if (route.instruction.seconds !== undefined) instruction.seconds = route.instruction.seconds;
  return {
    version: route.version,
    resetScan: route.resetScan,
    splash: splash,
    instruction: instruction,
    scenes: route.scenes.map(scene => {
      const out = {id: scene.id};
      if (scene.audio) out.audio = scene.audio;
      if (scene.video) out.video = scene.video;
      if (scene.image) out.image = scene.image;
      if (scene.puzzle) out.puzzle = scene.puzzle;
      if (scene.text) out.text = scene.text;
      out.expectScan = scene.expectScan || null;
      if (scene.next) out.next = scene.next;
      return out;
    }),
  };
}

function main() {
  const [routeArg, outArg] = process.argv.slice(2);
  if (!routeArg) {
    console.error('gebruik: node tools/build-manifest.js routes/<name>.txt [out/manifest.json]');
    process.exit(1);
  }

  const routePath = path.resolve(ROOT, routeArg);
  const outPath = path.resolve(ROOT, outArg || 'pack/manifest.json');
  const assetsBaseDir = path.dirname(outPath); // paths in the route are relative to the pack dir, same as in manifest.json

  const src = fs.readFileSync(routePath, 'utf8');
  const route = parseRoute(src);

  if (route.scenes.length === 0) {
    console.error('geen scenes gevonden in route bestand');
    process.exit(1);
  }

  const errors = validate(route, assetsBaseDir);
  if (errors.length > 0) {
    console.error(`${errors.length} fout(en) in ${routeArg}:\n`);
    errors.forEach(e => console.error('  - ' + e));
    process.exit(1);
  }

  const manifest = toManifest(route);
  fs.writeFileSync(outPath, JSON.stringify(manifest, null, 2) + '\n');
  console.log(`${outPath} geschreven — ${manifest.scenes.length} scenes, versie ${manifest.version}`);
}

main();
