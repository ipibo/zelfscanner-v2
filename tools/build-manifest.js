#!/usr/bin/env node
/**
 * Route source (.txt, key:value blocks) -> pack/manifest.json.
 * Build-time only -- runs on the laptop with Node, never on the device.
 * Usage: node tools/build-manifest.js routes/<name>.txt [out/manifest.json]
 *
 * Formaat: zie README ("Content-pack pipeline"). Instellingen bovenin, daarna
 * blokken die elk beginnen met "stop: <naam>".
 */
const fs = require('fs');
const path = require('path');
const {HINT_TYPES, REWARD_TYPES, validateManifest} = require('./manifest-schema');

const ROOT = path.resolve(__dirname, '..');

// key in de route (kleine letters) -> [sectie in het manifest, veld]
const TOP_LEVEL = {
  splash: ['splash', 'image'],
  splashcolor: ['splash', 'sliderColor'],
  splashtext: ['splash', 'sliderText'],
  instruction: ['instruction', 'text'],
  instructionseconds: ['instruction', 'seconds'],
  intro: ['intro', 'src'],
  audiotour: ['audiotour', 'image'],
  endimage: ['end', 'image'],
  endcolor: ['end', 'barColor'],
  endtext: ['end', 'barText'],
};

// "\n" in een tekstwaarde = nieuwe regel.
function unescape(value) {
  return value.replace(/\\n/g, '\n');
}

// "hint: puzzle assets/images/x.jpg" -> {type: 'puzzle', src: '...'}
function typed(key, value, types, lineNo) {
  const m = value.match(/^(\S+)\s+(\S.*)$/);
  if (!m || !Object.prototype.hasOwnProperty.call(types, m[1])) {
    throw new Error(
      `route:${lineNo}: verwacht "${key}: <${Object.keys(types).join('|')}> <bestand>", kreeg "${value}"`,
    );
  }
  return {type: m[1], src: m[2]};
}

function parseRoute(src) {
  const manifest = {version: '0.1.0', resetScan: null, splash: {}, instruction: {}, intro: {}, audiotour: {}, stops: [], end: {}};
  let current = null;

  src.split(/\r?\n/).forEach((rawLine, i) => {
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

    if (key === 'version' || key === 'reset' || TOP_LEVEL[key]) {
      if (current) {
        throw new Error(`route:${lineNo}: "${m[1]}" moet vóór de eerste stop staan`);
      }
      if (key === 'version') {
        manifest.version = value;
      } else if (key === 'reset') {
        manifest.resetScan = value;
      } else {
        const [sectionKey, field] = TOP_LEVEL[key];
        manifest[sectionKey][field] = field === 'seconds' ? Number(value) : unescape(value);
      }
      return;
    }
    if (key === 'scene') {
      throw new Error(`route:${lineNo}: "scene:" bestaat niet meer, gebruik "stop:" (zie README)`);
    }
    if (key === 'stop') {
      current = {id: value};
      manifest.stops.push(current);
      return;
    }
    if (!current) {
      throw new Error(`route:${lineNo}: "${m[1]}" buiten een stop-blok (mist "stop:" ervoor?)`);
    }
    if (key === 'scan') {
      current.scan = value;
    } else if (key === 'hint') {
      current.hint = typed('hint', value, HINT_TYPES, lineNo);
    } else if (key === 'reward') {
      current.reward = typed('reward', value, REWARD_TYPES, lineNo);
    } else {
      throw new Error(`route:${lineNo}: onbekende key "${m[1]}"`);
    }
  });

  return manifest;
}

function main() {
  const [routeArg, outArg] = process.argv.slice(2);
  if (!routeArg) {
    console.error('gebruik: node tools/build-manifest.js routes/<name>.txt [out/manifest.json]');
    process.exit(1);
  }

  const routePath = path.resolve(ROOT, routeArg);
  const outPath = path.resolve(ROOT, outArg || 'pack/manifest.json');
  const packDir = path.dirname(outPath); // paths in the route are relative to the pack dir, same as in manifest.json

  let manifest;
  try {
    manifest = parseRoute(fs.readFileSync(routePath, 'utf8'));
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }

  const errors = validateManifest(manifest, packDir);
  if (errors.length > 0) {
    console.error(`${errors.length} fout(en) in ${routeArg}:\n`);
    errors.forEach(e => console.error('  - ' + e));
    process.exit(1);
  }

  fs.writeFileSync(outPath, JSON.stringify(manifest, null, 2) + '\n');
  console.log(`${outPath} geschreven — ${manifest.stops.length} stops, versie ${manifest.version}`);
}

main();
