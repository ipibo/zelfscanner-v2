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

function parseRoute(src) {
  const lines = src.split(/\r?\n/);
  let version = '0.1.0';
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

    if (key === 'version') {
      if (current) {
        throw new Error(`route:${lineNo}: "version" moet vóór de eerste scene staan`);
      }
      version = value;
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

  return {version: version, scenes: scenes};
}

function validate(route, assetsBaseDir) {
  const errors = [];
  const ids = new Set();

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
  return {
    version: route.version,
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
