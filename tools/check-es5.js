#!/usr/bin/env node
/**
 * ES5-gate voor alles in pack/ dat op het device draait.
 *
 * De WebView op de MC18N0 (Android 5.1.1, Chromium 46) is JS van ~2015. Een
 * pijlfunctie, const, template literal of trailing comma sloopt het pack daar
 * stilletjes -- geen foutmelding, gewoon een zwart scherm. Niets daarvan is
 * zichtbaar in tsc, eslint of de build, alleen op het device. Vandaar deze
 * losse check: parse elk .js-bestand in pack/ alsof je Chromium 46 bent.
 *
 * Draaien: npm run pack:check   (en voor je een pack naar de scanners pusht)
 */
const fs = require('fs');
const path = require('path');
const espree = require('espree');

const PACK_DIR = path.resolve(__dirname, '..', 'pack');
let failed = 0;

function checkFile(full, rel) {
  try {
    espree.parse(fs.readFileSync(full, 'utf8'), {ecmaVersion: 5, loc: true});
    console.log(`  ok    ${rel}`);
  } catch (e) {
    failed++;
    const where = e.lineNumber ? ` (regel ${e.lineNumber}, kolom ${e.column})` : '';
    console.log(`  FOUT  ${rel}${where}: ${e.message}`);
  }
}

function walk(dir) {
  for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'assets') continue; // media, geen code
      walk(full);
    } else if (path.extname(entry.name) === '.js') {
      checkFile(full, path.relative(PACK_DIR, full).split(path.sep).join('/'));
    }
  }
}

console.log('ES5-check op pack/ (doel: Chromium 46 / Android 5.1.1)');
walk(PACK_DIR);

if (failed > 0) {
  console.error(`\n${failed} bestand(en) gebruiken syntax die dit device niet aankan.`);
  process.exit(1);
}
console.log('\nAlles ES5. Veilig om te pushen.');
