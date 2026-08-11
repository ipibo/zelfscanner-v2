#!/usr/bin/env node
/**
 * Tiny static file server for local pack preview. Serves the repo root so
 * both preview.html (root) and pack/ (device content) are reachable.
 * Needed because desktop Chrome/Firefox block XHR reads of file:// siblings
 * -- the Zebra WebView allows this natively, desktop browsers don't.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.argv[2]) || 8934;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
};

http
  .createServer((req, res) => {
    const urlPath = decodeURIComponent(req.url.split('?')[0]);
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
  });
