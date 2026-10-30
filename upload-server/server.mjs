/**
 * Forever — Güvenli Yerel Fotoğraf/Video Yükleme Sunucusu
 * ========================================================
 * Çalıştır:  node server.mjs
 * Forever ayarına yaz:  http://localhost:8787/upload
 *
 * Güvenlik iyileştirmeleri:
 * - Dosya boyutu sınırı (varsayılan 8 MB)
 * - Sadece izin verilen MIME türleri (image/*, video/mp4, webm)
 * - Rastgele dosya adı (path traversal yok)
 * - Basit rate-limit (IP başına)
 * - Opsiyonel UPLOAD_TOKEN (ortam değişkeni)
 * - CORS kontrollü (varsayılan * — üretimde domain kısıtla)
 */

import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { randomBytes, timingSafeEqual } from 'crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8787);
const MAX_BYTES = Number(process.env.MAX_UPLOAD_BYTES || 8 * 1024 * 1024); // 8 MB
const UPLOAD_TOKEN = (process.env.UPLOAD_TOKEN || '').trim(); // boşsa token zorunlu değil
const UPLOAD_DIR = path.join(__dirname, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const ALLOWED_MIME = new Set([
  'image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif',
  'video/mp4', 'video/webm', 'video/quicktime'
]);

const ALLOWED_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.mp4', '.webm', '.mov']);

// Basit in-memory rate limit: IP → { count, reset }
const rateMap = new Map();
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 30; // dakikada 30 yükleme

function getClientIp(req) {
  return (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
         req.socket.remoteAddress || 'unknown';
}

function checkRate(ip) {
  const now = Date.now();
  let entry = rateMap.get(ip);
  if (!entry || now > entry.reset) {
    entry = { count: 0, reset: now + RATE_WINDOW_MS };
    rateMap.set(ip, entry);
  }
  entry.count += 1;
  return entry.count <= RATE_MAX;
}

function send(res, code, data, type = 'application/json') {
  const body = typeof data === 'string' ? data : JSON.stringify(data);
  res.writeHead(code, {
    'Content-Type': type,
    'Access-Control-Allow-Origin': process.env.CORS_ORIGIN || '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Upload-Token',
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': code === 200 && type.startsWith('image') ? 'public, max-age=31536000' : 'no-store'
  });
  res.end(body);
}

function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

function parseMultipart(buf, boundary) {
  const parts = [];
  const sep = Buffer.from('--' + boundary);
  let start = buf.indexOf(sep) + sep.length;
  while (start < buf.length) {
    if (buf[start] === 45 && buf[start + 1] === 45) break;
    if (buf[start] === 13 && buf[start + 1] === 10) start += 2;
    const next = buf.indexOf(sep, start);
    if (next < 0) break;
    let part = buf.slice(start, next - 2);
    const headerEnd = part.indexOf('\r\n\r\n');
    if (headerEnd < 0) { start = next + sep.length; continue; }
    const headers = part.slice(0, headerEnd).toString();
    const body = part.slice(headerEnd + 4);
    const nameMatch = /name="([^"]+)"/.exec(headers);
    const fileMatch = /filename="([^"]+)"/.exec(headers);
    const typeMatch = /Content-Type:\s*([^\r\n]+)/i.exec(headers);
    parts.push({
      name: nameMatch?.[1],
      filename: fileMatch?.[1],
      contentType: typeMatch?.[1]?.trim(),
      body,
      headers
    });
    start = next + sep.length;
  }
  return parts;
}

function sanitizeFilename(name) {
  const base = path.basename(name || 'file');
  return base.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80);
}

const server = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') return send(res, 204, '');

  // Health
  if (req.url === '/' || req.url === '/health') {
    return send(res, 200, { ok: true, service: 'forever-upload', port: PORT, maxBytes: MAX_BYTES });
  }

  // Servis et: /uploads/...
  if (req.method === 'GET' && req.url.startsWith('/uploads/')) {
    const rawName = path.basename(req.url.split('?')[0]);
    const filePath = path.join(UPLOAD_DIR, rawName);
    // Path traversal koruması
    if (!filePath.startsWith(UPLOAD_DIR) || !fs.existsSync(filePath)) {
      return send(res, 404, { error: 'not found' });
    }
    const ext = path.extname(filePath).toLowerCase();
    const types = {
      '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
      '.webp': 'image/webp', '.gif': 'image/gif',
      '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime'
    };
    res.writeHead(200, {
      'Content-Type': types[ext] || 'application/octet-stream',
      'Access-Control-Allow-Origin': process.env.CORS_ORIGIN || '*',
      'Cache-Control': 'public, max-age=31536000',
      'X-Content-Type-Options': 'nosniff'
    });
    fs.createReadStream(filePath).pipe(res);
    return;
  }

  // Upload
  if (req.method === 'POST' && (req.url === '/upload' || req.url.startsWith('/upload?'))) {
    const ip = getClientIp(req);
    if (!checkRate(ip)) {
      return send(res, 429, { error: 'Çok fazla yükleme. Bir dakika bekleyin.' });
    }

    // Token kontrolü (varsa)
    if (UPLOAD_TOKEN) {
      const provided = (req.headers['x-upload-token'] || '').trim();
      if (!safeEqual(provided, UPLOAD_TOKEN)) {
        return send(res, 401, { error: 'Geçersiz veya eksik yükleme anahtarı' });
      }
    }

    const chunks = [];
    let total = 0;
    let aborted = false;

    req.on('data', (c) => {
      total += c.length;
      if (total > MAX_BYTES) {
        aborted = true;
        req.destroy();
        return send(res, 413, { error: `Dosya çok büyük (max ${Math.round(MAX_BYTES / 1024 / 1024)} MB)` });
      }
      chunks.push(c);
    });

    req.on('end', () => {
      if (aborted) return;
      try {
        const buf = Buffer.concat(chunks);
        const ct = req.headers['content-type'] || '';
        const m = /boundary=(.+)$/i.exec(ct);
        if (!m) return send(res, 400, { error: 'multipart boundary yok' });

        const parts = parseMultipart(buf, m[1].trim());
        const filePart = parts.find((p) => p.filename && p.body?.length);
        if (!filePart) return send(res, 400, { error: 'dosya yok' });

        // MIME & uzantı kontrolü
        const mime = (filePart.contentType || '').toLowerCase();
        const origExt = path.extname(filePart.filename || '').toLowerCase();
        if (mime && !ALLOWED_MIME.has(mime) && !mime.startsWith('image/') && !mime.startsWith('video/')) {
          return send(res, 415, { error: 'Desteklenmeyen dosya türü' });
        }
        if (origExt && !ALLOWED_EXT.has(origExt)) {
          return send(res, 415, { error: 'Desteklenmeyen dosya uzantısı' });
        }

        const safeExt = ALLOWED_EXT.has(origExt) ? origExt : (mime.includes('png') ? '.png' : mime.includes('webp') ? '.webp' : mime.includes('gif') ? '.gif' : mime.includes('mp4') ? '.mp4' : mime.includes('webm') ? '.webm' : '.jpg');
        const name = Date.now() + '_' + randomBytes(6).toString('hex') + safeExt;
        const dest = path.join(UPLOAD_DIR, name);

        // Son bir kez path kontrolü
        if (!dest.startsWith(UPLOAD_DIR)) {
          return send(res, 400, { error: 'geçersiz dosya yolu' });
        }

        fs.writeFileSync(dest, filePart.body);
        const baseUrl = process.env.PUBLIC_BASE_URL || `http://localhost:${PORT}`;
        const url = `${baseUrl}/uploads/${name}`;
        console.log(`[upload] ${ip} → ${name} (${filePart.body.length} bytes)`);
        send(res, 200, { url, path: `/uploads/${name}`, size: filePart.body.length });
      } catch (e) {
        console.error(e);
        send(res, 500, { error: 'Yükleme başarısız' });
      }
    });

    req.on('error', () => {
      if (!aborted) send(res, 500, { error: 'Bağlantı hatası' });
    });
    return;
  }

  send(res, 404, { error: 'not found' });
});

server.listen(PORT, () => {
  console.log(`Forever güvenli upload sunucusu → http://localhost:${PORT}`);
  console.log(`Max boyut: ${Math.round(MAX_BYTES / 1024 / 1024)} MB`);
  if (UPLOAD_TOKEN) console.log('UPLOAD_TOKEN aktif (X-Upload-Token gerekli)');
  else console.log('UPLOAD_TOKEN yok — herkese açık (sadece yerel kullanım için)');
  console.log(`Forever ayarına yaz: http://localhost:${PORT}/upload`);
});
