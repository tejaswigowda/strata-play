// ── server.js ────────────────────────────────────────────────────────────────
// Minimal static dev server (no build step, matches strata-editor's server.js
// shape). Sends `Access-Control-Allow-Origin: *` on every response as a
// defensive default, but strata-play no longer actually depends on it: the
// sandbox iframe's opaque origin (sandbox="allow-scripts", no
// allow-same-origin) treats even a same-host fetch as cross-origin, so an
// earlier version of this app needed its OWN server to send that header —
// sandbox.html now inlines everything it needs instead of fetching any of
// this repo's own files, so ANY static host works (verified against a plain
// `python -m http.server`, which sends no CORS headers at all). All that's
// served here is public, static game-player code and assets (never a token or
// any other secret) either way, so the header stays as a harmless default.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = parseInt(process.argv[2] || '5510', 10);
// Served tree is docs/ (GitHub Pages' own "serve from /docs" convention) —
// everything the browser actually loads (index.html, play.js, sandbox.html,
// lib/) lives there; examples/, scripts/, test/ etc. stay dev-only at the repo root.
const ROOT = path.join(__dirname, 'docs');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js'  : 'application/javascript; charset=utf-8',
  '.mjs' : 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.glb' : 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.png' : 'image/png',
  '.jpg' : 'image/jpeg',
  '.svg' : 'image/svg+xml',
};

function mime(file) {
  return MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
}

const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent(req.url.split('?')[0]);
  let filePath = path.join(ROOT, urlPath === '/' ? '/index.html' : urlPath);

  // Prevent path traversal outside ROOT.
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    res.end('403 Forbidden');
    return;
  }

  fs.stat(filePath, (err, stat) => {
    if (!err && stat.isDirectory()) filePath = path.join(filePath, 'index.html');

    fs.stat(filePath, (err2, stat2) => {
      if (err2 || !stat2.isFile()) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('404 Not Found');
        return;
      }

      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Content-Type', mime(filePath));
      res.setHeader('Content-Length', stat2.size);
      res.writeHead(200);
      fs.createReadStream(filePath).pipe(res);
    });
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`strata-play serving at http://127.0.0.1:${PORT}`);
  console.log('Press Ctrl+C to stop.');
});
