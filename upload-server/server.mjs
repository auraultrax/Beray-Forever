/**
 * Forever Plus — authenticated media gateway, storage failover and security audit.
 * Node.js 22+ required. All privileged secrets stay in the server environment.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  randomBytes, createCipheriv, createDecipheriv, createHmac, timingSafeEqual
} from 'node:crypto';
import { initializeApp, applicationDefault, cert, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8787);
const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'project-c443f992-d19d-4d35-a16';
const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || path.join(__dirname, 'uploads'));
const SECURITY_DIR = path.resolve(process.env.SECURITY_DIR || path.join(__dirname, 'private-data'));
const SECURITY_LOG = path.join(SECURITY_DIR, 'security-events.jsonl');
const SECURITY_RETENTION_DAYS = 30;
const MAX_UPLOAD_BYTES = Number(process.env.MAX_UPLOAD_BYTES || 50 * 1024 * 1024);
const LOCAL_STORAGE_MAX_BYTES = Number(process.env.LOCAL_STORAGE_MAX_BYTES || 2 * 1024 * 1024 * 1024);
const MIN_FREE_BYTES = Number(process.env.MIN_FREE_BYTES || 150 * 1024 * 1024);
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || '').replace(/\/+$/, '');
const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const SUPABASE_SERVICE_ROLE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
const SUPABASE_BUCKET = process.env.SUPABASE_STORAGE_BUCKET || 'forever-media';
const SUPABASE_BUCKET_PUBLIC = process.env.SUPABASE_BUCKET_PUBLIC !== 'false';
const TRUST_PROXY = process.env.TRUST_PROXY === 'true';
const CORS_ORIGINS = new Set((process.env.CORS_ORIGINS || process.env.CORS_ORIGIN || '')
  .split(',').map(x => x.trim()).filter(Boolean));

fs.mkdirSync(UPLOAD_DIR, { recursive: true });
fs.mkdirSync(SECURITY_DIR, { recursive: true });
try { fs.chmodSync(SECURITY_DIR, 0o700); } catch {}

const encryptionKeyHex = (process.env.IP_LOG_ENCRYPTION_KEY || '').trim();
const ipEncryptionKey = /^[a-f0-9]{64}$/i.test(encryptionKeyHex) ? Buffer.from(encryptionKeyHex, 'hex') : null;

let firebaseAuth = null;
let firestore = null;
try {
  const serviceAccountText = (process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '').trim();
  let credential = applicationDefault();
  if (serviceAccountText) {
    const serviceAccount = JSON.parse(serviceAccountText);
    if (serviceAccount.private_key) serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
    credential = cert(serviceAccount);
  }
  const app = getApps()[0] || initializeApp({ credential, projectId: PROJECT_ID });
  firebaseAuth = getAuth(app);
  firestore = getFirestore(app);
} catch (error) {
  console.error('[startup] Firebase Admin yapılandırılamadı:', error.message);
}

const MIME_BY_EXT = new Map([
  ['.jpg','image/jpeg'], ['.jpeg','image/jpeg'], ['.png','image/png'],
  ['.webp','image/webp'], ['.gif','image/gif'], ['.mp4','video/mp4']
]);
const FOLDER_ALLOWLIST = new Set(['posts','stories','rooms','stickers','avatars']);
const rateBuckets = new Map();
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 30;

function send(res, code, data, extraHeaders = {}) {
  const body = typeof data === 'string' ? data : JSON.stringify(data);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'no-store',
    'Referrer-Policy': 'no-referrer',
    'X-Frame-Options': 'DENY',
    ...extraHeaders
  });
  res.end(body);
}

function corsHeaders(req) {
  const origin = req.headers.origin;
  if (!origin) return {};
  if (CORS_ORIGINS.has(origin)) {
    return {
      'Access-Control-Allow-Origin': origin,
      'Vary': 'Origin',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      'Access-Control-Max-Age': '600'
    };
  }
  return {};
}

function clientIp(req) {
  if (TRUST_PROXY) {
    const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    if (forwarded) return forwarded.replace(/^::ffff:/, '');
  }
  return String(req.socket.remoteAddress || 'unknown').replace(/^::ffff:/, '');
}

function ipRateKey(ip) {
  return createHmac('sha256', ipEncryptionKey || Buffer.from('forever-rate-limit-only'))
    .update(ip).digest('hex');
}

function checkRate(ip) {
  const now = Date.now();
  const key = ipRateKey(ip);
  let entry = rateBuckets.get(key);
  if (!entry || now > entry.reset) {
    entry = { count: 0, reset: now + RATE_WINDOW_MS };
    rateBuckets.set(key, entry);
  }
  entry.count += 1;
  if (rateBuckets.size > 5000) {
    for (const [k, v] of rateBuckets) if (now > v.reset) rateBuckets.delete(k);
  }
  return entry.count <= RATE_MAX;
}

function encryptIp(ip) {
  if (!ipEncryptionKey) return null;
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', ipEncryptionKey, iv);
  const encrypted = Buffer.concat([cipher.update(ip, 'utf8'), cipher.final()]);
  return {
    ip: encrypted.toString('base64'),
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64')
  };
}

function decryptIp(record) {
  if (!ipEncryptionKey || !record?.ip || !record?.iv || !record?.tag) return '[şifre çözme anahtarı yok]';
  try {
    const decipher = createDecipheriv('aes-256-gcm', ipEncryptionKey, Buffer.from(record.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(record.tag, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(record.ip, 'base64')),
      decipher.final()
    ]).toString('utf8');
  } catch {
    return '[kayıt doğrulanamadı]';
  }
}

async function logSecurityEvent(uid, event, ip) {
  const encrypted = encryptIp(ip);
  if (!encrypted) return false;
  const row = {
    at: new Date().toISOString(),
    uid: String(uid).slice(0, 128),
    event: String(event).slice(0, 40),
    ip: encrypted.ip,
    iv: encrypted.iv,
    tag: encrypted.tag
  };
  fs.appendFileSync(SECURITY_LOG, JSON.stringify(row) + '\n', { mode: 0o600 });
  try { fs.chmodSync(SECURITY_LOG, 0o600); } catch {}
  return true;
}

function pruneSecurityLogs() {
  if (!fs.existsSync(SECURITY_LOG)) return;
  const cutoff = Date.now() - SECURITY_RETENTION_DAYS * 86400000;
  const rows = fs.readFileSync(SECURITY_LOG, 'utf8').split('\n').filter(Boolean);
  const keep = [];
  for (const line of rows) {
    try {
      const row = JSON.parse(line);
      if (Date.parse(row.at) >= cutoff) keep.push(JSON.stringify(row));
    } catch {}
  }
  const temp = SECURITY_LOG + '.tmp';
  fs.writeFileSync(temp, keep.join('\n') + (keep.length ? '\n' : ''), { mode: 0o600 });
  fs.renameSync(temp, SECURITY_LOG);
}

async function requireUser(req) {
  if (!firebaseAuth || !firestore) throw new Error('Firebase Admin sunucu anahtarı yapılandırılmamış.');
  const header = String(req.headers.authorization || '');
  const match = /^Bearer (.+)$/i.exec(header);
  if (!match) {
    const error = new Error('Giriş anahtarı gerekli.');
    error.status = 401;
    throw error;
  }
  let decoded;
  try { decoded = await firebaseAuth.verifyIdToken(match[1], true); }
  catch {
    const error = new Error('Oturum geçersiz veya süresi dolmuş. Yeniden giriş yap.');
    error.status = 401;
    throw error;
  }
  const userSnap = await firestore.collection('users').doc(decoded.uid).get();
  const profile = userSnap.exists ? userSnap.data() : {};
  if (profile.suspended === true || profile.banned === true ||
      Number(profile.restrictedUntil || 0) > Date.now()) {
    const error = new Error('Bu hesap şu anda medya yükleyemez.');
    error.status = 403;
    throw error;
  }
  return { uid: decoded.uid, email: decoded.email || '', plus: profile.plusMember === true, profile };
}

async function requireAdmin(req) {
  const user = await requireUser(req);
  const adminDoc = await firestore.collection('admins').doc(user.uid).get();
  if (!adminDoc.exists) {
    const error = new Error('Bu işlem yalnızca yönetici hesabına açık.');
    error.status = 403;
    throw error;
  }
  return user;
}

async function readRequest(req, limitBytes) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limitBytes) {
      const error = new Error('İstek çok büyük.');
      error.status = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function parseMultipart(buffer, boundary) {
  const parts = [];
  const sep = Buffer.from('--' + boundary);
  let start = buffer.indexOf(sep);
  if (start < 0) return parts;
  start += sep.length;
  while (start < buffer.length) {
    if (buffer[start] === 45 && buffer[start + 1] === 45) break;
    if (buffer[start] === 13 && buffer[start + 1] === 10) start += 2;
    const next = buffer.indexOf(sep, start);
    if (next < 0) break;
    const part = buffer.slice(start, next - 2);
    const headerEnd = part.indexOf(Buffer.from('\r\n\r\n'));
    if (headerEnd >= 0) {
      const headers = part.slice(0, headerEnd).toString('utf8');
      const body = part.slice(headerEnd + 4);
      const name = /name="([^"]+)"/.exec(headers)?.[1];
      const filename = /filename="([^"]+)"/.exec(headers)?.[1];
      const contentType = /Content-Type:\s*([^\r\n]+)/i.exec(headers)?.[1]?.trim().toLowerCase();
      parts.push({ name, filename, contentType, body });
    }
    start = next + sep.length;
  }
  return parts;
}

function sniffMime(buffer) {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer.length >= 8 && buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return 'image/png';
  if (buffer.length >= 6 && ['GIF87a','GIF89a'].includes(buffer.subarray(0,6).toString('ascii'))) return 'image/gif';
  if (buffer.length >= 12 && buffer.subarray(0,4).toString('ascii') === 'RIFF' &&
      buffer.subarray(8,12).toString('ascii') === 'WEBP') return 'image/webp';
  if (buffer.length >= 12 && buffer.subarray(4,8).toString('ascii') === 'ftyp') return 'video/mp4';
  return null;
}

function readMp4DurationSeconds(buffer) {
  const marker = Buffer.from('mvhd');
  const i = buffer.indexOf(marker);
  if (i < 0 || i + 20 >= buffer.length) return null;
  const version = buffer[i + 4];
  const timescale = buffer.readUInt32BE(i + 8);
  if (!timescale) return null;
  let duration;
  if (version === 1) {
    if (i + 20 >= buffer.length) return null;
    duration = Number(buffer.readBigUInt64BE(i + 12));
  } else {
    duration = buffer.readUInt32BE(i + 12);
  }
  if (!Number.isFinite(duration)) return null;
  return duration / timescale;
}

function safeExtension(originalName, mime) {
  const ext = path.extname(originalName || '').toLowerCase();
  const allowed = new Map([
    ['image/jpeg','.jpg'], ['image/png','.png'], ['image/webp','.webp'],
    ['image/gif','.gif'], ['video/mp4','.mp4']
  ]);
  if (!allowed.has(mime)) return null;
  if (ext && MIME_BY_EXT.has(ext) && MIME_BY_EXT.get(ext) !== mime) return null;
  return allowed.get(mime);
}

function walkBytes(dir) {
  let total = 0;
  if (!fs.existsSync(dir)) return 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const target = path.join(dir, entry.name);
    try {
      if (entry.isDirectory()) total += walkBytes(target);
      else if (entry.isFile()) total += fs.statSync(target).size;
    } catch {}
  }
  return total;
}

function localSpaceAvailable(fileSize) {
  const used = walkBytes(UPLOAD_DIR);
  if (used + fileSize > LOCAL_STORAGE_MAX_BYTES) return false;
  try {
    if (typeof fs.statfsSync === 'function') {
      const stats = fs.statfsSync(UPLOAD_DIR);
      const free = Number(stats.bavail) * Number(stats.bsize);
      if (free < fileSize + MIN_FREE_BYTES) return false;
    }
  } catch {}
  return true;
}

function encodeObjectPath(value) {
  return String(value).split('/').map(encodeURIComponent).join('/');
}

async function saveToSupabase(buffer, objectPath, mime) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    const error = new Error('Yerel depolama doldu; Supabase yedek deposu yapılandırılmamış.');
    error.status = 507;
    throw error;
  }
  const url = SUPABASE_URL + '/storage/v1/object/' + encodeURIComponent(SUPABASE_BUCKET) + '/' + encodeObjectPath(objectPath);
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + SUPABASE_SERVICE_ROLE_KEY,
      'apikey': SUPABASE_SERVICE_ROLE_KEY,
      'Content-Type': mime,
      'x-upsert': 'false'
    },
    body: buffer
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    const error = new Error(response.status === 413 || response.status === 507
      ? 'Supabase yedek deposu dosyayı kabul etmedi; kota veya dosya sınırını kontrol et.'
      : 'Supabase depolama hatası (' + response.status + '): ' + detail.slice(0, 240));
    error.status = response.status === 413 || response.status === 507 ? 507 : 502;
    throw error;
  }
  const encodedPath = encodeObjectPath(objectPath);
  const publicUrl = SUPABASE_BUCKET_PUBLIC
    ? SUPABASE_URL + '/storage/v1/object/public/' + encodeURIComponent(SUPABASE_BUCKET) + '/' + encodedPath
    : SUPABASE_URL + '/storage/v1/object/' + encodeURIComponent(SUPABASE_BUCKET) + '/' + encodedPath;
  return { url: publicUrl, path: objectPath, storedOn: 'supabase' };
}

async function persistMedia(buffer, uid, folder, mime, extension) {
  const day = new Date().toISOString().slice(0,10);
  const name = Date.now() + '_' + randomBytes(12).toString('hex') + extension;
  const objectPath = uid + '/' + day + '/' + folder + '/' + name;
  if (localSpaceAvailable(buffer.length)) {
    const target = path.resolve(UPLOAD_DIR, objectPath);
    if (!target.startsWith(UPLOAD_DIR + path.sep)) {
      const error = new Error('Dosya yolu geçersiz.');
      error.status = 400;
      throw error;
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    try {
      fs.writeFileSync(target, buffer, { flag: 'wx', mode: 0o640 });
      if (!PUBLIC_BASE_URL) {
        fs.unlinkSync(target);
        const error = new Error('Yerel medya sunucusu için PUBLIC_BASE_URL (HTTPS adresi) ayarlanmalı.');
        error.status = 503;
        throw error;
      }
      return {
        url: PUBLIC_BASE_URL + '/uploads/' + encodeObjectPath(objectPath),
        path: objectPath,
        storedOn: 'local'
      };
    } catch (error) {
      try { if (fs.existsSync(target)) fs.unlinkSync(target); } catch {}
      if (!['ENOSPC','EDQUOT'].includes(error.code)) throw error;
    }
  }
  return await saveToSupabase(buffer, objectPath, mime);
}

async function reserveDailyUsage(uid, isPlus, mime, videoSeconds) {
  const day = new Date().toISOString().slice(0,10);
  const ref = firestore.collection('mediaUsage').doc(uid + '_' + day);
  return await firestore.runTransaction(async tx => {
    const snap = await tx.get(ref);
    const old = snap.exists ? snap.data() : {};
    const images = Number(old.imageCount || 0);
    const videos = Number(old.videoSeconds || 0);
    if (mime.startsWith('image/')) {
      if (!isPlus && images >= 5) {
        const error = new Error('Normal üyelikte günlük 5 görsel yükleme hakkın var. Plus ile bu sınır kalkar.');
        error.status = 429;
        throw error;
      }
      tx.set(ref, {
        uid, day, imageCount: images + 1,
        videoSeconds: videos,
        updatedAt: FieldValue.serverTimestamp()
      }, { merge: true });
      return { ref, kind: 'image', previous: images };
    }
    if (mime === 'video/mp4') {
      if (!isPlus) {
        const error = new Error('Video yükleme Plus üyelerine açıktır.');
        error.status = 403;
        throw error;
      }
      if (videoSeconds == null || videoSeconds <= 0 || videoSeconds > 180) {
        const error = new Error('Video süresi doğrulanamadı veya 3 dakikayı aşıyor.');
        error.status = 400;
        throw error;
      }
      if (videos + videoSeconds > 180) {
        const error = new Error('Plus üyelerinin günlük toplam video süresi 3 dakikadır.');
        error.status = 429;
        throw error;
      }
      tx.set(ref, {
        uid, day, imageCount: images,
        videoSeconds: videos + Math.ceil(videoSeconds),
        updatedAt: FieldValue.serverTimestamp()
      }, { merge: true });
      return { ref, kind: 'video', previous: videos };
    }
    const error = new Error('Desteklenmeyen medya türü.');
    error.status = 415;
    throw error;
  });
}

async function rollbackUsage(reservation) {
  if (!reservation) return;
  try {
    await firestore.runTransaction(async tx => {
      const snap = await tx.get(reservation.ref);
      if (!snap.exists) return;
      const data = snap.data();
      const patch = reservation.kind === 'image'
        ? { imageCount: Math.max(0, Number(data.imageCount || 0) - 1), updatedAt: FieldValue.serverTimestamp() }
        : { videoSeconds: Math.max(0, Number(data.videoSeconds || 0) - Math.ceil(Number(data.videoSeconds || 0) - reservation.previous)), updatedAt: FieldValue.serverTimestamp() };
      tx.set(reservation.ref, patch, { merge: true });
    });
  } catch (error) {
    console.error('[quota] Geri alma işlemi başarısız:', error.message);
  }
}

function parseMultipartField(parts, name) {
  const part = parts.find(x => x.name === name && !x.filename);
  return part ? part.body.toString('utf8').trim() : '';
}

async function handleUpload(req, res) {
  const ip = clientIp(req);
  if (!checkRate(ip)) return send(res, 429, { error: 'Çok fazla işlem. Bir dakika bekle.' });
  const user = await requireUser(req);
  const requestBuffer = await readRequest(req, MAX_UPLOAD_BYTES + 256 * 1024);
  const contentType = String(req.headers['content-type'] || '');
  const boundary = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  if (!boundary) return send(res, 400, { error: 'multipart boundary bulunamadı.' });
  const parts = parseMultipart(requestBuffer, (boundary[1] || boundary[2]).trim());
  const filePart = parts.find(p => p.filename && p.body?.length);
  if (!filePart) return send(res, 400, { error: 'Dosya seçilmedi.' });
  if (filePart.body.length > MAX_UPLOAD_BYTES) return send(res, 413, { error: 'Dosya boyutu üst sınırı aşıyor.' });

  const mime = sniffMime(filePart.body);
  if (!mime || filePart.contentType !== mime) return send(res, 415, { error: 'Dosyanın gerçek türü doğrulanamadı.' });
  const extension = safeExtension(filePart.filename, mime);
  if (!extension) return send(res, 415, { error: 'Dosya uzantısı ve türü uyumlu değil.' });
  const folder = parseMultipartField(parts, 'folder') || 'posts';
  if (!FOLDER_ALLOWLIST.has(folder)) return send(res, 400, { error: 'Geçersiz medya alanı.' });
  if (folder === 'rooms' && mime.startsWith('video/') && !user.plus) {
    return send(res, 403, { error: 'Odalara video yüklemek Plus üyelerine açıktır.' });
  }

  let videoSeconds = null;
  if (mime === 'video/mp4') {
    if (!user.plus) return send(res, 403, { error: 'Video yüklemek Plus üyelerine açıktır.' });
    videoSeconds = readMp4DurationSeconds(filePart.body);
    if (videoSeconds == null || videoSeconds <= 0 || videoSeconds > 180) {
      return send(res, 400, { error: 'Video 3 dakikadan kısa olmalı ve süresi sunucuda doğrulanabilmeli.' });
    }
  }

  let reservation = null;
  try {
    reservation = await reserveDailyUsage(user.uid, user.plus, mime, videoSeconds);
    const saved = await persistMedia(filePart.body, user.uid, folder, mime, extension);
    await logSecurityEvent(user.uid, 'media_upload', ip);
    return send(res, 200, {
      url: saved.url,
      path: saved.path,
      size: filePart.body.length,
      mimeType: mime,
      storedOn: saved.storedOn
    });
  } catch (error) {
    await rollbackUsage(reservation);
    throw error;
  }
}

async function handleSecurityEvent(req, res) {
  const user = await requireUser(req);
  const ip = clientIp(req);
  const body = await readRequest(req, 8 * 1024);
  let payload = {};
  try { payload = body.length ? JSON.parse(body.toString('utf8')) : {}; } catch {}
  const event = ['session','signup','login'].includes(payload.event) ? payload.event : 'session';
  const saved = await logSecurityEvent(user.uid, event, ip);
  return send(res, saved ? 200 : 503, {
    ok: saved,
    message: saved ? 'Güvenlik olayı kaydedildi.' : 'IP kayıt anahtarı sunucuda yapılandırılmamış.'
  });
}

async function handleAdminLogs(req, res) {
  await requireAdmin(req);
  if (!ipEncryptionKey) return send(res, 503, { error: 'IP_LOG_ENCRYPTION_KEY yapılandırılmamış.' });
  pruneSecurityLogs();
  const limit = Math.max(1, Math.min(200, Number(new URL(req.url, 'http://localhost').searchParams.get('limit') || 100)));
  if (!fs.existsSync(SECURITY_LOG)) return send(res, 200, { logs: [] });
  const rows = fs.readFileSync(SECURITY_LOG, 'utf8').split('\n').filter(Boolean).slice(-limit);
  const logs = rows.map(line => {
    try {
      const row = JSON.parse(line);
      return { at: row.at, uid: row.uid, event: row.event, ip: decryptIp(row) };
    } catch { return null; }
  }).filter(Boolean).reverse();
  return send(res, 200, { logs });
}

async function serveLocalFile(req, res) {
  const raw = decodeURIComponent(req.url.split('?')[0].slice('/uploads/'.length));
  const filePath = path.resolve(UPLOAD_DIR, raw);
  if (!filePath.startsWith(UPLOAD_DIR + path.sep) || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    return send(res, 404, { error: 'Dosya bulunamadı.' });
  }
  const mime = MIME_BY_EXT.get(path.extname(filePath).toLowerCase()) || 'application/octet-stream';
  res.writeHead(200, {
    'Content-Type': mime,
    'Access-Control-Allow-Origin': '*',
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'public, max-age=31536000, immutable',
    'Content-Length': fs.statSync(filePath).size
  });
  fs.createReadStream(filePath).pipe(res);
}

async function handle(req, res) {
  const cors = corsHeaders(req);
  if (req.method === 'OPTIONS') {
    return res.writeHead(204, cors).end();
  }
  const url = new URL(req.url, 'http://localhost');
  try {
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/health')) {
      const localBytes = walkBytes(UPLOAD_DIR);
      return send(res, 200, {
        ok: true,
        service: 'forever-plus-media',
        storage: {
          localUsedBytes: localBytes,
          localMaxBytes: LOCAL_STORAGE_MAX_BYTES,
          localFreeBytes: Math.max(0, LOCAL_STORAGE_MAX_BYTES - localBytes),
          supabaseFallback: !!(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY),
          supabaseBucket: SUPABASE_BUCKET
        },
        security: { ipLogging: !!ipEncryptionKey, retentionDays: SECURITY_RETENTION_DAYS }
      }, cors);
    }
    if (req.method === 'GET' && url.pathname.startsWith('/uploads/')) return await serveLocalFile(req, res);
    if (req.method === 'POST' && url.pathname === '/upload') return await handleUpload(req, res, cors);
    if (req.method === 'POST' && url.pathname === '/security/event') return await handleSecurityEvent(req, res, cors);
    if (req.method === 'GET' && url.pathname === '/admin/security-logs') return await handleAdminLogs(req, res, cors);
    return send(res, 404, { error: 'Bulunamadı.' }, cors);
  } catch (error) {
    const status = Number(error.status || 500);
    if (status >= 500) console.error('[request]', error.message);
    return send(res, status, { error: status >= 500 ? error.message || 'Sunucu hatası.' : error.message }, cors);
  }
}

const server = http.createServer((req, res) => {
  handle(req, res).catch(error => {
    console.error('[fatal request]', error.message);
    if (!res.headersSent) send(res, 500, { error: 'Sunucu hatası.' }, corsHeaders(req));
    else res.destroy();
  });
});

setInterval(() => {
  try { pruneSecurityLogs(); } catch (error) { console.error('[security logs]', error.message); }
}, 6 * 60 * 60 * 1000).unref();

server.listen(PORT, () => {
  console.log('Forever Plus medya sunucusu port ' + PORT);
  console.log('Max dosya: ' + Math.round(MAX_UPLOAD_BYTES / 1024 / 1024) + ' MB');
  console.log('Yerel depolama üst sınırı: ' + Math.round(LOCAL_STORAGE_MAX_BYTES / 1024 / 1024) + ' MB');
  console.log('Supabase yedekleme: ' + (!!(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY)));
  console.log('IP loglama: ' + (!!ipEncryptionKey) + ' (şifreli, 30 günlük saklama)');
  if (!firebaseAuth || !firestore) console.error('UYARI: FIREBASE_SERVICE_ACCOUNT_JSON veya GOOGLE_APPLICATION_CREDENTIALS tanımlanmalı.');
  if (!PUBLIC_BASE_URL) console.error('UYARI: Üretimde PUBLIC_BASE_URL için HTTPS adresi ayarla.');
  if (!CORS_ORIGINS.size) console.error('UYARI: CORS_ORIGINS içinde uygulamanın HTTPS adresini belirt.');
});
