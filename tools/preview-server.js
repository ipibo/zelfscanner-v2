#!/usr/bin/env node
/**
 * Tiny static file server for local pack preview. Serves the repo root so
 * both preview.html (root) and pack/ (device content) are reachable.
 * Needed because desktop Chrome/Firefox block XHR reads of file:// siblings
 * -- the Zebra WebView allows this natively, desktop browsers don't.
 */
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const {execFile} = require('child_process');
const {EXT, validateManifest} = require('./manifest-schema');

const ROOT = path.resolve(__dirname, '..');
const PACK_DIR = path.join(ROOT, 'pack');
const MANIFEST_PATH = path.join(PACK_DIR, 'manifest.json');
const PORT = Number(process.argv[2]) || 8934;

// Meerdere stories: pack/manifest.json is "standaard", de rest staat los in
// stories/<naam>.json (buiten pack/, dus niet op elk device). Welke story een
// device krijgt staat als derde kolom in devices.txt; zsdeploy push zet die
// dan als manifest.json op dat device. Media blijft gedeeld in pack/assets.
const STORIES_DIR = path.join(ROOT, 'stories');
const DEVICES_FILE = path.join(ROOT, 'devices.txt');
const DEFAULT_STORY = 'standaard';
const STORY_NAME_RE = /^[a-z0-9][a-z0-9_-]{0,39}$/;

// null = ongeldige naam (ook bescherming tegen ../ in de query).
function storyPath(name) {
  if (!name || name === DEFAULT_STORY) return MANIFEST_PATH;
  if (!STORY_NAME_RE.test(name)) return null;
  return path.join(STORIES_DIR, name + '.json');
}

function listStories() {
  let extra = [];
  try {
    extra = fs
      .readdirSync(STORIES_DIR)
      .filter(f => f.endsWith('.json'))
      .map(f => f.slice(0, -5))
      .filter(n => STORY_NAME_RE.test(n) && n !== DEFAULT_STORY)
      .sort();
  } catch {
    // geen stories/ map = alleen standaard
  }
  return [DEFAULT_STORY].concat(extra);
}

// Kolommen na naam en ip: een story en/of sn=<serienummer> (zsdeploy herkent
// devices daarop, zie zsdeploy load_devices_file).
function parseDeviceCols(cols) {
  const sn = (cols.slice(2).find(c => c.startsWith('sn=')) || '').slice(3);
  const story = cols.slice(2).find(c => !c.startsWith('sn=')) || DEFAULT_STORY;
  return {name: cols[0], ip: cols[1], story, sn};
}

// devices.txt: "naam ip [story] [sn=serienummer]", '#' = comment.
function readDevices() {
  let src = '';
  try {
    src = fs.readFileSync(DEVICES_FILE, 'utf8');
  } catch {
    return [];
  }
  return src
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('#'))
    .map(l => l.split(/\s+/))
    .filter(cols => cols.length >= 2)
    .map(parseDeviceCols);
}

// Herschrijft alleen de regel van dit device; comments, volgorde en het
// serienummer blijven.
function setDeviceStory(deviceName, story) {
  const src = fs.readFileSync(DEVICES_FILE, 'utf8');
  let found = false;
  const out = src.split('\n').map(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return line;
    const cols = trimmed.split(/\s+/);
    if (cols[0] !== deviceName || cols.length < 2) return line;
    found = true;
    const {sn} = parseDeviceCols(cols);
    return [cols[0], cols[1], story === DEFAULT_STORY ? null : story, sn ? 'sn=' + sn : null]
      .filter(Boolean)
      .join(' ');
  });
  if (!found) return false;
  fs.writeFileSync(DEVICES_FILE, out.join('\n'));
  return true;
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
};

const VIDEO_EXT = EXT.video;
const AUDIO_EXT = EXT.audio;
const IMAGE_EXT = EXT.image;
const PAGE_EXT = EXT.page;

// Soort bestand op extensie, of null. Pagina's alleen onder assets/: de
// pack zelf (index.html) is geen asset.
function assetKind(rel) {
  const ext = path.extname(rel).toLowerCase();
  if (VIDEO_EXT.has(ext)) return 'video';
  if (AUDIO_EXT.has(ext)) return 'audio';
  if (IMAGE_EXT.has(ext)) return 'image';
  if (PAGE_EXT.has(ext) && rel.startsWith('assets/')) return 'page';
  return null;
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => (data += chunk));
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

const UPLOAD_MAX_BYTES = 500 * 1024 * 1024;

function readRawBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on('data', chunk => {
      total += chunk.length;
      if (total > maxBytes) {
        req.destroy();
        reject(new Error('bestand te groot (max ' + Math.round(maxBytes / 1024 / 1024) + 'MB)'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function sendJson(res, obj, code = 200) {
  res.writeHead(code, {'Content-Type': 'application/json; charset=utf-8'});
  res.end(JSON.stringify(obj));
}

function listAssets() {
  const out = {video: [], audio: [], image: [], page: []};

  function walk(dir) {
    for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory() || (entry.isSymbolicLink() && fs.statSync(full).isDirectory())) {
        walk(full);
        continue;
      }
      const rel = path.relative(PACK_DIR, full).split(path.sep).join('/');
      const kind = assetKind(rel);
      if (kind) out[kind].push(rel);
    }
  }

  if (fs.existsSync(PACK_DIR)) walk(PACK_DIR);
  Object.keys(out).forEach(k => out[k].sort());
  return out;
}

function listAssetsDetailed() {
  const out = [];

  function walk(dir) {
    for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory() || (entry.isSymbolicLink() && fs.statSync(full).isDirectory())) {
        walk(full);
        continue;
      }
      const rel = path.relative(PACK_DIR, full).split(path.sep).join('/');
      const kind = assetKind(rel);
      if (!kind) continue;
      const stat = fs.statSync(full);
      out.push({path: rel, kind, size: stat.size, mtime: stat.mtimeMs});
    }
  }

  if (fs.existsSync(PACK_DIR)) walk(PACK_DIR);
  out.sort((a, b) => a.path.localeCompare(b.path));
  return out;
}

const UPLOAD_DIR = {
  video: path.join(PACK_DIR, 'assets'),
  audio: path.join(PACK_DIR, 'assets', 'audio'),
  image: path.join(PACK_DIR, 'assets', 'images'),
  page: path.join(PACK_DIR, 'assets', 'pages'),
};
const UPLOAD_EXT = {video: VIDEO_EXT, audio: AUDIO_EXT, image: IMAGE_EXT, page: PAGE_EXT};

// Same source file gets uploaded to more than one scene often (a shared
// background clip, a shared photo) -- reuse the existing asset instead of
// writing a byte-identical copy every time.
function findDuplicate(dir, buffer) {
  if (!fs.existsSync(dir)) return null;
  const hash = crypto.createHash('md5').update(buffer).digest('hex');
  for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
    if (!entry.isFile()) continue;
    const full = path.join(dir, entry.name);
    if (fs.statSync(full).size !== buffer.length) continue;
    const existingHash = crypto.createHash('md5').update(fs.readFileSync(full)).digest('hex');
    if (existingHash === hash) return full;
  }
  return null;
}

// Basename-only, safe charset -- blocks path traversal via ../ or absolute paths.
function safeFilename(name) {
  const base = path.basename(String(name || '')).replace(/[^a-zA-Z0-9._-]/g, '_');
  return base.replace(/^\.+/, '') || 'upload';
}

// Phone-shot clips routinely arrive as HEVC with a rotation flag in the
// container (portrait shot, stored as landscape pixels + "display rotated").
// The MC18N0's Android 5.1.1 WebView ignores that flag (renders tilted) and
// generally can't decode HEVC at all -- so every video upload gets baked
// down to plain upright H.264 here, once, on the laptop, before it ever
// reaches a device. Confirmed against the actual bug on-device 2026-08-19.
let ffmpegAvailable = null;
function checkFfmpeg() {
  if (ffmpegAvailable !== null) return Promise.resolve(ffmpegAvailable);
  return new Promise(resolve => {
    execFile('ffmpeg', ['-version'], err => {
      ffmpegAvailable = !err;
      resolve(ffmpegAvailable);
    });
  });
}

function normalizeVideo(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    execFile(
      'ffmpeg',
      [
        '-y',
        '-i', inputPath,
        '-map_metadata', '-1',
        '-c:v', 'libx264',
        '-profile:v', 'main',
        '-level', '4.0',
        '-pix_fmt', 'yuv420p',
        '-crf', '20',
        '-preset', 'medium',
        // Geluid blijft erin: een video als beloning speelt met geluid, als
        // hint stil (pack/runtime.js). AAC-LC speelt ook op de MC18N0.
        '-c:a', 'aac',
        '-b:a', '128k',
        '-movflags', '+faststart',
        outputPath,
      ],
      {timeout: 180000, maxBuffer: 20 * 1024 * 1024},
      (err, stdout, stderr) => {
        if (err) reject(new Error(String(stderr || err.message).slice(-2000)));
        else resolve();
      },
    );
  });
}

function uniqueTarget(dir, filename) {
  const ext = path.extname(filename);
  const stem = filename.slice(0, filename.length - ext.length);
  let candidate = filename;
  let n = 1;
  while (fs.existsSync(path.join(dir, candidate))) {
    candidate = `${stem}-${n}${ext}`;
    n++;
  }
  return candidate;
}

const ZSDEPLOY = path.join(ROOT, 'zsdeploy');

// Shells out to the existing zsdeploy script (adb push/status/devices) --
// no shell involved (execFile, args array), so nothing from the request
// reaches a shell interpreter. Not a tty, so zsdeploy's own C_RED/etc. ANSI
// codes stay off and stdout prints as plain text, safe to show as-is.
function runZsdeploy(args, timeoutMs) {
  return new Promise(resolve => {
    execFile(
      ZSDEPLOY,
      args,
      {cwd: ROOT, timeout: timeoutMs || 120000, maxBuffer: 20 * 1024 * 1024},
      (err, stdout, stderr) => {
        resolve({ok: !err, output: (stdout || '') + (stderr || '')});
      },
    );
  });
}

http
  .createServer(async (req, res) => {
    const urlPath = decodeURIComponent(req.url.split('?')[0]);

    if (urlPath === '/api/assets' && req.method === 'GET') {
      return sendJson(res, listAssets());
    }

    if (urlPath === '/api/stories' && req.method === 'GET') {
      return sendJson(res, {stories: listStories(), devices: readDevices()});
    }

    if (urlPath === '/api/device-story' && req.method === 'POST') {
      let body;
      try {
        body = await readJsonBody(req);
      } catch (e) {
        return sendJson(res, {ok: false, error: 'ongeldige JSON: ' + e.message}, 400);
      }
      const story = String(body.story || DEFAULT_STORY);
      if (!listStories().includes(story)) {
        return sendJson(res, {ok: false, error: `story "${story}" bestaat niet (eerst opslaan)`}, 400);
      }
      if (!setDeviceStory(String(body.device || ''), story)) {
        return sendJson(res, {ok: false, error: `device "${body.device}" niet gevonden in devices.txt`}, 404);
      }
      return sendJson(res, {ok: true, devices: readDevices()});
    }

    if (urlPath === '/api/manifest' && req.method === 'GET') {
      const storyFile = storyPath(new URL(req.url, 'http://localhost').searchParams.get('story'));
      if (!storyFile) return sendJson(res, {error: 'ongeldige story-naam'}, 400);
      return fs.readFile(storyFile, 'utf8', (err, data) => {
        if (err) return sendJson(res, {error: path.basename(storyFile) + ' niet gevonden'}, 404);
        res.writeHead(200, {'Content-Type': 'application/json; charset=utf-8'});
        res.end(data);
      });
    }

    if (urlPath === '/api/upload' && req.method === 'POST') {
      const q = new URL(req.url, 'http://localhost');
      const kind = q.searchParams.get('kind');
      const dir = UPLOAD_DIR[kind];
      const allowedExt = UPLOAD_EXT[kind];
      if (!dir) {
        return sendJson(res, {ok: false, error: 'ongeldig kind (verwacht video, audio, image of page)'}, 400);
      }

      const filename = safeFilename(q.searchParams.get('name'));
      const ext = path.extname(filename).toLowerCase();
      if (!allowedExt.has(ext)) {
        return sendJson(res, {ok: false, error: `extensie "${ext}" niet toegestaan voor ${kind}`}, 400);
      }

      let buffer;
      try {
        buffer = await readRawBody(req, UPLOAD_MAX_BYTES);
      } catch (e) {
        return sendJson(res, {ok: false, error: e.message}, 413);
      }

      let finalFilename = filename;
      let normalized = false;
      if (kind === 'video' && (await checkFfmpeg())) {
        const tmpIn = path.join(os.tmpdir(), 'zs-upload-' + crypto.randomUUID() + ext);
        const tmpOut = path.join(os.tmpdir(), 'zs-upload-' + crypto.randomUUID() + '.mp4');
        try {
          fs.writeFileSync(tmpIn, buffer);
          await normalizeVideo(tmpIn, tmpOut);
          buffer = fs.readFileSync(tmpOut);
          finalFilename = filename.slice(0, filename.length - ext.length) + '.mp4';
          normalized = true;
        } catch (e) {
          // Fall back to the raw upload -- still usable, just not
          // rotation-fixed / re-encoded. Better than a hard failure.
          console.error('video normalize mislukt, ruwe upload gebruikt:', e.message);
        } finally {
          fs.rmSync(tmpIn, {force: true});
          fs.rmSync(tmpOut, {force: true});
        }
      }

      fs.mkdirSync(dir, {recursive: true});

      // Een HTML-pagina pas je aan en upload je opnieuw: zelfde naam =
      // vervangen, anders hangt de story nog aan de oude versie.
      if (kind === 'page') {
        const replaced = fs.existsSync(path.join(dir, filename));
        fs.writeFileSync(path.join(dir, filename), buffer);
        const rel = path.relative(PACK_DIR, path.join(dir, filename)).split(path.sep).join('/');
        return sendJson(res, {ok: true, path: rel, replaced});
      }

      const dup = findDuplicate(dir, buffer);
      if (dup) {
        const rel = path.relative(PACK_DIR, dup).split(path.sep).join('/');
        return sendJson(res, {ok: true, path: rel, deduped: true, normalized});
      }

      const target = uniqueTarget(dir, finalFilename);
      fs.writeFileSync(path.join(dir, target), buffer);
      const rel = path.relative(PACK_DIR, path.join(dir, target)).split(path.sep).join('/');
      return sendJson(res, {ok: true, path: rel, normalized});
    }

    if (urlPath === '/api/library' && req.method === 'GET') {
      return sendJson(res, {files: listAssetsDetailed()});
    }

    if (urlPath === '/api/asset' && req.method === 'DELETE') {
      const q = new URL(req.url, 'http://localhost');
      const rel = q.searchParams.get('path') || '';
      const assetsRoot = path.join(PACK_DIR, 'assets');
      const full = path.normalize(path.join(PACK_DIR, rel));

      if (!full.startsWith(assetsRoot + path.sep)) {
        return sendJson(res, {ok: false, error: 'ongeldig pad'}, 400);
      }
      if (!assetKind(path.relative(PACK_DIR, full).split(path.sep).join('/'))) {
        return sendJson(res, {ok: false, error: 'alleen media-bestanden kunnen hier verwijderd worden'}, 400);
      }
      if (!fs.existsSync(full)) {
        return sendJson(res, {ok: false, error: 'bestand niet gevonden'}, 404);
      }
      fs.unlinkSync(full);
      return sendJson(res, {ok: true});
    }

    if (urlPath === '/api/devices' && req.method === 'GET') {
      const result = await runZsdeploy(['devices'], 30000);
      return sendJson(res, result);
    }

    if (urlPath === '/api/deploy' && req.method === 'POST') {
      let body = {};
      try {
        body = await readJsonBody(req);
      } catch {
        // ignore -- fall through with defaults
      }
      const args = ['push', 'pack', '--parallel'];
      if (body.restart) args.push('--restart');
      const result = await runZsdeploy(args, 180000);
      return sendJson(res, result);
    }

    if (urlPath === '/api/manifest' && req.method === 'POST') {
      const storyFile = storyPath(new URL(req.url, 'http://localhost').searchParams.get('story'));
      if (!storyFile) {
        return sendJson(res, {ok: false, errors: ['ongeldige story-naam (alleen a-z, 0-9, - en _)']}, 400);
      }
      let manifest;
      try {
        manifest = await readJsonBody(req);
      } catch (e) {
        return sendJson(res, {ok: false, errors: ['ongeldige JSON: ' + e.message]}, 400);
      }
      const errors = validateManifest(manifest, PACK_DIR);
      if (errors.length > 0) {
        return sendJson(res, {ok: false, errors}, 400);
      }
      fs.mkdirSync(path.dirname(storyFile), {recursive: true});
      fs.writeFileSync(storyFile, JSON.stringify(manifest, null, 2) + '\n');
      return sendJson(res, {ok: true});
    }

    const rel = urlPath === '/' ? '/preview.html' : urlPath;
    const full = path.normalize(path.join(ROOT, rel));

    if (!full.startsWith(ROOT)) {
      res.writeHead(403);
      res.end('forbidden');
      return;
    }

    fs.readFile(full, (err, data) => {
      if (err) {
        res.writeHead(404);
        res.end('not found: ' + rel);
        return;
      }
      const ext = path.extname(full);
      res.writeHead(200, {'Content-Type': MIME[ext] || 'application/octet-stream'});
      res.end(data);
    });
  })
  .listen(PORT, () => {
    console.log(`preview server op http://localhost:${PORT}/`);
    console.log(`  scan simulator:  http://localhost:${PORT}/`);
    console.log(`  story editor:    http://localhost:${PORT}/tools/editor.html`);
  });
