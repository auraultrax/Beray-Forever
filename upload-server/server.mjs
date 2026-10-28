/**
 * Forever yerel fotoğraf sunucusu
 * Çalıştır: node server.mjs
 * Forever ayarına yaz: http://localhost:8787/upload
 *
 * CORS açık — GitHub Pages'ten localhost'a yükleme için tarayıcı
 * bazen engeller; o zaman aynı makinede veya gerçek bir domain kullan.
 */
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { randomBytes } from 'crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8787);
const UPLOAD_DIR = path.join(__dirname, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

function send(res, code, data, type = 'application/json') {
  res.writeHead(code, {
    'Content-Type': type,
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': '*'
  });
  res.end(typeof data === 'string' ? data : JSON.stringify(data));
}

function parseMultipart(buf, boundary) {
  const parts = [];
  const sep = Buffer.from('--' + boundary);
  let start = buf.indexOf(sep) + sep.length;
  while (start < buf.length) {
    if (buf[start] === 45 && buf[start + 1] === 45) break; // --
    if (buf[start] === 13 && buf[start + 1] === 10) start += 2;
    const next = buf.indexOf(sep, start);
    if (next < 0) break;
    let part = buf.slice(start, next - 2); // trim \r\n
    const headerEnd = part.indexOf('\r\n\r\n');
    if (headerEnd < 0) { start = next + sep.length; continue; }
    const headers = part.slice(0, headerEnd).toString();
    const body = part.slice(headerEnd + 4);
    const nameMatch = /name="([^"]+)"/.exec(headers);
    const fileMatch = /filename="([^"]+)"/.exec(headers);
    parts.push({ name: nameMatch?.[1], filename: fileMatch?.[1], body, headers });
    start = next + sep.length;
  }
  return parts;
}

const server = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') return send(res, 204, '');

  if (req.method === 'GET' && req.url.startsWith('/uploads/')) {
    const filePath = path.join(UPLOAD_DIR, path.basename(req.url));
    if (!fs.existsSync(filePath)) return send(res, 404, { error: 'not found' });
    const ext = path.extname(filePath).toLowerCase();
    const types = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif' };
    res.writeHead(200, {
      'Content-Type': types[ext] || 'application/octet-stream',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=31536000'
    });
    fs.createReadStream(filePath).pipe(res);
    return;
  }

  if (req.method === 'POST' && (req.url === '/upload' || req.url.startsWith('/upload?'))) {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      try {
        const buf = Buffer.concat(chunks);
        const ct = req.headers['content-type'] || '';
        const m = /boundary=(.+)$/i.exec(ct);
        if (!m) return send(res, 400, { error: 'multipart boundary yok' });
        const parts = parseMultipart(buf, m[1].trim());
        const filePart = parts.find((p) => p.filename && p.body?.length);
        if (!filePart) return send(res, 400, { error: 'dosya yok' });
        const ext = path.extname(filePart.filename) || '.jpg';
        const name = Date.now() + '_' + randomBytes(4).toString('hex') + ext.replace(/[^.a-zA-Z0-9]/g, '');
        fs.writeFileSync(path.join(UPLOAD_DIR, name), filePart.body);
        const url = `http://localhost:${PORT}/uploads/${name}`;
        console.log('Yüklendi:', url);
        send(res, 200, { url, path: `/uploads/${name}` });
      } catch (e) {
        console.error(e);
        send(res, 500, { error: String(e.message || e) });
      }
    });
    return;
  }

  if (req.url === '/' || req.url === '/health') {
    return send(res, 200, { ok: true, service: 'forever-upload', port: PORT });
  }

  send(res, 404, { error: 'not found' });
});

server.listen(PORT, () => {
  console.log(`Forever upload server http://localhost:${PORT}`);
  console.log(`Forever ayarına yaz: http://localhost:${PORT}/upload`);
});
