const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');
const html = read('index.html');
const migration = read('SUPABASE_FOREVER_PLUS_FEATURES_MIGRATION.sql');
const chat = read('supabase/functions/aurai-chat/index.ts');
const search = read('supabase/functions/aurai-search/index.ts');

test('Plus rozet ve küçük elmas kullanıcı bulma satırına bağlanır', () => {
  assert.match(html, /verified-badge/);
  assert.match(html, /plus-diamond-badge/);
  assert.match(html, /badge-follow-row[^`]*\$\{userBadges\(username\)\}/s);
});

test('16 uygulama simgesi projede hazır; kullanıcı dosya yüklemez', () => {
  const ids = [...html.matchAll(/\{ id:'([a-z]+)', name:/g)].map(x => x[1]);
  for (const id of ['violet','emerald','ocean','rose','sunset','amber','ice','midnight','ruby','sapphire','aurora','coral','mint','onyx','pearl','gold']) {
    assert.ok(ids.includes(id), `missing icon preset ${id}`);
    assert.ok(fs.existsSync(path.join(root, 'icons', `forever-${id}-192.png`)));
    assert.ok(fs.existsSync(path.join(root, `manifest-${id}.json`)));
  }
});

test('Normal hesapta Keşfet metin-only gönderi istemcide ve SQL trigger ile engellenir', () => {
  assert.match(html, /text && !imageFiles\.length && !videoFile && !isPlusMember\(\)/);
  assert.match(migration, /Keşfet''te yalnızca metin içeren gönderiler Forever Plus üyelerine özeldir/);
  assert.match(migration, /create trigger aurax_guard_plus_post_rules/);
});

test('160 özgün SVG animasyonlu çıkartma vardır ve her dosya animasyon içerir', () => {
  const dir = path.join(root, 'stickers', 'forever-pack');
  const files = fs.readdirSync(dir).filter(x => x.endsWith('.svg'));
  assert.equal(files.length, 160);
  for (const file of files) {
    const svg = fs.readFileSync(path.join(dir, file), 'utf8');
    assert.match(svg, /<animate(?:Transform|Motion)?\b/);
    assert.doesNotMatch(svg, /<script\b|<foreignObject\b/i);
  }
  assert.match(html, /FOREVER_OFFICIAL_STICKERS/);
  assert.match(html, /isOfficialForeverSticker\(url\) && !isPlusMember\(\)/);
});

test('Emoji Laboratuvarı Unicode emojileri yerel olarak 64 öğeye kadar birleştirir ve Plus ile sınırlandırılır', () => {
  assert.match(html, /new Intl\.Segmenter/);
  assert.match(html, /slice\(0, 64\)/);
  assert.match(html, /if \(!isPlusMember\(\)\) return showToast\('Emoji birleştirme/);
  assert.doesNotMatch(html, /emojik\.vercel\.app/);
});

test('Plus BAI kişisel kotayı atlar ve gelişmiş yönerge/tokenu kullanır', () => {
  assert.match(chat, /if \(!crisis && !isPlusMember\)/);
  assert.match(chat, /const PLUS_ENHANCEMENT/);
  assert.match(chat, /isPlusMember \? PLUS_ENHANCEMENT/);
  assert.match(chat, /max_tokens: isPlusMember \? 2800 : 1500/);
  assert.match(chat, /num_predict: isPlusMember \? 1800 : 800/);
  assert.match(search, /if \(!isPlusMember\)/);
});

test('Plus gönderileri için 12 saatlik boost yalnızca sunucuda üretilir ve güncellemelerde korunur', () => {
  assert.match(migration, /v_now_ms \+ 43200000/);
  assert.match(migration, /plusBoostUntil/);
  assert.match(migration, /Preserve the original server stamp/);
  assert.match(html, /Number\(p\.plusBoostUntil\) > feedNow/);
});

test('Plus oda temaları, baloncuk şekilleri ve animasyonlu emoji efektleri tanımlıdır', () => {
  for (const id of ['space-ruby','space-sapphire','space-rose-gold','space-moonlight','space-rainbow','space-forest','space-iceberg','space-neon-pink','space-cosmic-purple','space-tropical','space-velvet','space-opal']) assert.ok(html.includes(id));
  for (const id of ['bubble-shape-soft','bubble-shape-wave','bubble-shape-jelly','bubble-shape-ticket','bubble-shape-comic','bubble-shape-capsule','bubble-shape-petal']) assert.ok(html.includes(id));
  for (const id of ['heart','heart-eyes','laugh-tears','tears']) assert.ok(html.includes(`fx-${id}`));
});

test('Plus hızlı tepkiler (özellik 10) korunmuştur', () => {
  assert.match(html, /function getQuickEmojis\(\) \{ return isPlusMember\(\) \? PLUS_QUICK_EMOJIS : QUICK_EMOJIS; \}/);
});
