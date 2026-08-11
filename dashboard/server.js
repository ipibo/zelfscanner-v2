#!/usr/bin/env node
/**
 * Zelfscanner cradle dashboard — pure Node, zero deps.
 *
 *   node dashboard/server.js   →   http://localhost:8765
 *
 * Device apps long-poll POST /api/heartbeat with {serial, model, docked}.
 * The server holds each heartbeat open until it has a command for that device
 * (or ~25 s passes), so a dashboard "unlock" reaches the device near-instantly.
 * The device then fires the unlock broadcast locally — the server never touches adb.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 8765;
const HOLD_MS = 15000; // long-poll hold window (device re-posts at least this often)
const ONLINE_MS = 20000; // online if a heartbeat started within this (> HOLD_MS so mid-hold counts)
const PRUNE_MS = 90000; // forget devices not seen this long (clears stale ghosts)

/** serial -> {serial, model, docked, lastSeen} */
const devices = new Map();
/** serial -> {seconds} queued while no heartbeat is being held */
const pending = new Map();
/** serial -> [{res, timer}] held heartbeats waiting for a command */
const waiters = new Map();

function sendJson(res, obj, code = 200) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(body);
}

function readBody(req) {
  return new Promise(resolve => {
    let data = '';
    req.on('data', c => (data += c));
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        resolve({});
      }
    });
  });
}

/** Deliver an unlock to a device: wake a held heartbeat, else queue it. */
function deliverUnlock(serial, seconds) {
  const queue = waiters.get(serial);
  if (queue && queue.length) {
    const {res, timer} = queue.shift();
    clearTimeout(timer);
    sendJson(res, {cmd: 'unlock', seconds});
  } else {
    pending.set(serial, {seconds});
  }
}

async function handleHeartbeat(req, res) {
  const body = await readBody(req);
  const serial = body.serial || 'unknown';
  devices.set(serial, {
    serial,
    model: body.model || '?',
    docked: !!body.docked,
    lastSeen: Date.now(),
  });

  // Pending command? deliver right away.
  const cmd = pending.get(serial);
  if (cmd) {
    pending.delete(serial);
    sendJson(res, {cmd: 'unlock', seconds: cmd.seconds});
    return;
  }

  // Otherwise hold the response until a command arrives or we time out.
  const queue = waiters.get(serial) || [];
  const entry = {res, timer: null};
  entry.timer = setTimeout(() => {
    const q = waiters.get(serial) || [];
    const i = q.indexOf(entry);
    if (i >= 0) q.splice(i, 1);
    sendJson(res, {});
  }, HOLD_MS);
  queue.push(entry);
  waiters.set(serial, queue);
}

const server = http.createServer(async (req, res) => {
  const url = req.url.split('?')[0];

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    return res.end();
  }

  if (url === '/api/heartbeat' && req.method === 'POST') {
    return handleHeartbeat(req, res);
  }

  if (url === '/api/devices' && req.method === 'GET') {
    const now = Date.now();
    // Forget long-gone devices so stale ghosts drop off the list.
    for (const [serial, d] of devices) {
      if (now - d.lastSeen > PRUNE_MS) devices.delete(serial);
    }
    const list = [...devices.values()].map(d => ({
      ...d,
      online: now - d.lastSeen < ONLINE_MS,
      secondsAgo: Math.round((now - d.lastSeen) / 1000),
    }));
    return sendJson(res, {devices: list});
  }

  if (url === '/api/unlock' && req.method === 'POST') {
    const body = await readBody(req);
    const serial = body.serial;
    const seconds = Math.max(10, Math.min(30, body.seconds || 10));
    if (!serial || !devices.has(serial)) {
      return sendJson(res, {ok: false, error: 'unknown device'}, 404);
    }
    deliverUnlock(serial, seconds);
    return sendJson(res, {ok: true, serial, seconds});
  }

  if (url === '/api/unlock-all' && req.method === 'POST') {
    const body = await readBody(req);
    const seconds = Math.max(10, Math.min(30, body.seconds || 10));
    const now = Date.now();
    const targets = [...devices.values()].filter(d => now - d.lastSeen < ONLINE_MS);
    targets.forEach(d => deliverUnlock(d.serial, seconds));
    return sendJson(res, {
      ok: true,
      seconds,
      count: targets.length,
      serials: targets.map(d => d.serial),
    });
  }

  // Static: dashboard page.
  if (url === '/' || url === '/index.html') {
    const file = path.join(__dirname, 'public', 'index.html');
    return fs.readFile(file, (err, data) => {
      if (err) {
        res.writeHead(500);
        return res.end('index.html missing');
      }
      res.writeHead(200, {'Content-Type': 'text/html'});
      res.end(data);
    });
  }

  res.writeHead(404);
  res.end('not found');
});

server.listen(PORT, () => {
  console.log(`cradle dashboard → http://localhost:${PORT}`);
  console.log('device apps should point DASHBOARD_HOST at this machine.');
});
