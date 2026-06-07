const express = require('express');
const axios = require('axios');
const { createClient } = require('@libsql/client');
const app = express();

app.use(express.json());

// ─── ENV ───────────────────────────────────────────────────────────────────────
const VERIFY_TOKEN    = process.env.VERIFY_TOKEN    || 'formataha2024';
const CLAUDE_API_KEY  = process.env.CLAUDE_API_KEY;
const IG_ACCESS_TOKEN = process.env.IG_ACCESS_TOKEN;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID   = process.env.TELEGRAM_CHAT_ID;
const TURSO_URL          = process.env.TURSO_URL;
const TURSO_TOKEN        = process.env.TURSO_TOKEN;

// ─── TURSO KURULUM ─────────────────────────────────────────────────────────────
const db = createClient({ url: TURSO_URL, authToken: TURSO_TOKEN });

async function dbInit() {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS kullanicilar (
      id TEXT PRIMARY KEY,
      gorsel_gitti INTEGER DEFAULT 0,
      kart_uyari_gitti INTEGER DEFAULT 0,
      konusmalar TEXT DEFAULT '[]',
      son_mesaj INTEGER DEFAULT 0,
      guncelleme INTEGER DEFAULT (unixepoch())
    )
  `);
  await db.execute(`
    CREATE TABLE IF NOT EXISTS islenmis_yorumlar (
      yorum_id TEXT PRIMARY KEY,
      tarih INTEGER DEFAULT (unixepoch())
    )
  `);
  await db.execute(`
    CREATE TABLE IF NOT EXISTS takip_mesajlari (
      id TEXT PRIMARY KEY,
      adet INTEGER DEFAULT 0,
      tarih INTEGER DEFAULT (unixepoch())
    )
  `);
  try { await db.execute('ALTER TABLE kullanicilar ADD COLUMN son_mesaj INTEGER DEFAULT 0'); } catch(e) {}
  try { await db.execute('ALTER TABLE kullanicilar ADD COLUMN siparis_verildi INTEGER DEFAULT 0'); } catch(e) {}
  try { await db.execute('ALTER TABLE kullanicilar ADD COLUMN siparis_tarihi INTEGER DEFAULT 0'); } catch(e) {}
  await db.execute(`
    CREATE TABLE IF NOT EXISTS bekleyen_siparisler (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      siparis_json TEXT NOT NULL,
      deneme INTEGER DEFAULT 0,
      tarih INTEGER DEFAULT (unixepoch())
    )
  `);
}
dbInit().catch(e => console.error('DB init err:', e.message));

// 7 günden eski işlenmiş yorumları temizle
async function eskiYorumlariTemizle() {
  const sinir = Math.floor(Date.now() / 1000) - 7 * 24 * 3600;
  await db.execute({ sql: 'DELETE FROM islenmis_yorumlar WHERE tarih < ?', args: [sinir] });
}
setInterval(eskiYorumlariTemizle, 24 * 60 * 60 * 1000);

async function yorumIslendi(yorumId) {
  try {
    await db.execute({ sql: 'INSERT INTO islenmis_yorumlar (yorum_id) VALUES (?)', args: [yorumId] });
    return true;
  } catch(e) {
    return false;
  }
}

// Takip mesajı — günde max 2 kez
async function takipMesajiGonderilsinMi(id) {
  const simdi = Math.floor(Date.now() / 1000);
  const gunBaslangic = simdi - (simdi % 86400);
  try {
    const r = await db.execute({ sql: 'SELECT adet, tarih FROM takip_mesajlari WHERE id = ?', args: [id] });
    if (r.rows.length === 0) {
      await db.execute({ sql: 'INSERT INTO takip_mesajlari (id, adet, tarih) VALUES (?, 1, ?)', args: [id, simdi] });
      return true;
    }
    const row = r.rows[0];
    const ayniGun = Number(row.tarih) >= gunBaslangic;
    if (ayniGun && Number(row.adet) >= 2) return false;
    const yeniAdet = ayniGun ? Number(row.adet) + 1 : 1;
    await db.execute({ sql: 'UPDATE takip_mesajlari SET adet = ?, tarih = ? WHERE id = ?', args: [yeniAdet, simdi, id] });
    return true;
  } catch(e) {
    return false;
  }
}

const BIR_GUN_SANIYE = 24 * 60 * 60; // 24 saat

async function dbKullaniciAl(id) {
  const r = await db.execute({ sql: 'SELECT * FROM kullanicilar WHERE id = ?', args: [id] });
  const simdi = Math.floor(Date.now() / 1000);
  if (r.rows.length === 0) {
    await db.execute({ sql: 'INSERT INTO kullanicilar (id, son_mesaj) VALUES (?, ?)', args: [id, simdi] });
    return { gorselGitti: false, kartUyariGitti: false, konusmalar: [], siparisVerildi: false, siparisTarihi: 0 };
  }
  const row = r.rows[0];
  const sonMesaj = Number(row.son_mesaj) || 0;
  const siparisVerildi = !!row.siparis_verildi;
  const siparisTarihi = Number(row.siparis_tarihi) || 0;
  const BES_GUN = 5 * 24 * 60 * 60;

  // Sipariş verilmişse
  if (siparisVerildi) {
    if ((simdi - siparisTarihi) > BES_GUN) {
      // 5 gün geçti, sıfırla ama bot kendiliğinden yazmayacak
      await db.execute({ sql: 'UPDATE kullanicilar SET gorsel_gitti=0, kart_uyari_gitti=0, konusmalar=?, siparis_verildi=0, siparis_tarihi=0 WHERE id=?', args: ['[]', id] });
      return { gorselGitti: false, kartUyariGitti: false, konusmalar: [], siparisVerildi: false, siparisTarihi: 0 };
    }
    // 5 gün dolmadı, görsel gönderme ama soruları cevapla
    return {
      gorselGitti:    true,
      kartUyariGitti: !!row.kart_uyari_gitti,
      konusmalar:     JSON.parse(row.konusmalar || '[]'),
      siparisVerildi: true,
      siparisTarihi,
    };
  }

  // Sipariş verilmemiş, 24 saat geçtiyse sıfırla
  if ((simdi - sonMesaj) > BIR_GUN_SANIYE && row.gorsel_gitti) {
    return { gorselGitti: false, kartUyariGitti: false, konusmalar: [], siparisVerildi: false, siparisTarihi: 0 };
  }
  return {
    gorselGitti:    !!row.gorsel_gitti,
    kartUyariGitti: !!row.kart_uyari_gitti,
    konusmalar:     JSON.parse(row.konusmalar || '[]'),
    siparisVerildi: false,
    siparisTarihi:  0,
  };
}

async function dbKaydet(id, data) {
  const simdi = Math.floor(Date.now() / 1000);
  await db.execute({
    sql: `UPDATE kullanicilar
          SET gorsel_gitti = ?, kart_uyari_gitti = ?, konusmalar = ?,
              son_mesaj = ?, guncelleme = unixepoch(),
              siparis_verildi = ?, siparis_tarihi = ?
          WHERE id = ?`,
    args: [
      data.gorselGitti ? 1 : 0,
      data.kartUyariGitti ? 1 : 0,
      JSON.stringify(data.konusmalar),
      simdi,
      data.siparisVerildi ? 1 : 0,
      data.siparisTarihi || 0,
      id,
    ],
  });
}

async function eskiKayitlariTemizle() {
  const sinir = Math.floor(Date.now() / 1000) - 30 * 24 * 3600;
  // Sipariş veren müşteriyi silme, 5 gün koruma süresi dolmadan temizleme
  await db.execute({ sql: 'DELETE FROM kullanicilar WHERE guncelleme < ? AND siparis_verildi = 0', args: [sinir] });
}
setInterval(eskiKayitlariTemizle, 24 * 60 * 60 * 1000);

// ─── RAM: Sadece geçici işlem state'i ─────────────────────────────────────────
const islemDurumu = {};
const floodKoruma = {}; // { [id]: { sayac, ilkZaman, engellendi } }

function islemDurumuAl(id) {
  if (!islemDurumu[id]) {
    islemDurumu[id] = { mesgulMu: false, bekleyenler: [], timer: null };
  }
  return islemDurumu[id];
}

function floodKontrol(id) {
  const simdi = Date.now();
  if (!floodKoruma[id]) floodKoruma[id] = { sayac: 0, ilkZaman: simdi, engellendi: false };
  const f = floodKoruma[id];

  // Engel süresi bitti mi?
  if (f.engellendi && (simdi - f.ilkZaman) > 10 * 60 * 1000) {
    floodKoruma[id] = { sayac: 1, ilkZaman: simdi, engellendi: false };
    return false;
  }
  if (f.engellendi) return true;

  // 10 saniye penceresi
  if ((simdi - f.ilkZaman) > 10 * 1000) {
    floodKoruma[id] = { sayac: 1, ilkZaman: simdi, engellendi: false };
    return false;
  }

  f.sayac++;
  if (f.sayac >= 5) {
    f.engellendi = true;
    f.ilkZaman = simdi;
    console.log('Flood engeli:', id);
    return true;
  }
  return false;
}

// ─── SABİTLER ──────────────────────────────────────────────────────────────────
const FORMA_GORSELLERI = {
  '0021': 'https://res.cloudinary.com/dzfiyamng/image/upload/v1778891830/BJK_BEYAZ_RETRO_vybc1r.jpg',
  '0022': 'https://res.cloudinary.com/dzfiyamng/image/upload/v1778891832/BJK_BEYAZ_RETRO_pumkjo.jpg',
  '0023': 'https://res.cloudinary.com/dzfiyamng/image/upload/v1778891832/BJK_BEYAZ_RETRO_vtectc.jpg',
  '0024': 'https://res.cloudinary.com/dzfiyamng/image/upload/v1778891833/BJK_BEYAZ_RETRO_iybbwa.jpg',
  '0025': 'https://res.cloudinary.com/dzfiyamng/image/upload/v1778891832/BJK_BEYAZ_RETRO_oaxlkt.jpg',
  '0026': 'https://res.cloudinary.com/dzfiyamng/image/upload/v1780840047/0026_yhyahd.png',
  '0027': 'https://res.cloudinary.com/dzfiyamng/image/upload/v1780840056/0027_l6ofmb.png',
  '0028': 'https://res.cloudinary.com/dzfiyamng/image/upload/v1780840052/0028_blj8dc.png',
};

const URUN_KODLARI = {
  '0021': 'FB RETRO ÇUBUKLU FORMASI',
  '0022': 'FB RETRO SARI FORMASI',
  '0023': 'FB GRİ TASARIM FORMASI',
  '0024': 'FB PALAMUT SARI FORMASI',
  '0025': 'FB PALAMUT LACİVERT FORMASI',
  '0026': 'FB YENİ SEZON LACİVERT FORMASI',
  '0027': 'FB YENİ SEZON ÇUBUKLU FORMASI',
  '0028': 'FB YENİ SEZON SARI FORMASI',
};

const TUM_GORSELLER = Object.values(FORMA_GORSELLERI);

const KART_UYARI = 'Kartla ödemelerde kargo firmaları Pos Cihazı Hizmet Bedeli adı altında +50 TL ekstra bir ücret çıkartıyor. Sizler için en uygunu nakit olmasıdır, o şekilde nakit olarak sisteme gireceğiz.';

const VITRIN_METNI = 'Kargo Dahil 1 Adet 630₺\n2 Adet Forma 1.250₺\n\n2 Al 1 Hediye Kampanyasında 1.250₺\n2 Forma Alın 1.250₺ Ödeyin, 1 Forma Bizden Hediye!\nToplam 3 Forma Kapınıza Gelir!\n\nKapıda Ödeme Şeffaf Kargo İle Gönderim Sağlıyoruz 🙏🏻\nÜrünü Görüp Öyle Teslim Alıyorsunuz 👍';

// ─── YARDIMCI FONKSİYONLAR ─────────────────────────────────────────────────────
function kodaIsimCevir(metin) {
  let s = metin;
  Object.keys(URUN_KODLARI).forEach(k => {
    s = s.replace(new RegExp(k, 'g'), URUN_KODLARI[k]);
  });
  return s;
}

function kartVar(m) {
  return ['kart', 'kard', 'kartla', 'karta', 'kredi'].some(k =>
    m.toLowerCase().includes(k)
  );
}

function siparisiParsEt(metin) {
  try {
    const m = metin.match(/###SIPARIS_BASLA###([\s\S]*?)###SIPARIS_BITIS###/);
    if (m) return JSON.parse(m[1].trim());
  } catch (e) {}
  return null;
}

function anlamsizMi(txt) {
  const t = txt.trim();
  if (!t) return true;
  if (/^[.…\s😊👍❤️🙏]+$/.test(t)) return true;
  if (t.length < 2) return true;
  return false;
}

function bekle(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ─── ŞEHİR TESPİTİ & RİSK ────────────────────────────────────────────────────
const SEHIR_MAP = {
  'eskişehir': 'eskisehir', 'istanbul': 'istanbul', 'ankara': 'ankara',
  'izmir': 'izmir', 'şanlıurfa': 'sanliurfa', 'konya': 'konya',
  'bursa': 'bursa', 'antalya': 'antalya', 'adana': 'adana',
  'gaziantep': 'gaziantep', 'kayseri': 'kayseri', 'mersin': 'mersin',
  'diyarbakır': 'diyarbakir', 'samsun': 'samsun', 'trabzon': 'trabzon',
};

function sehirTespit(adres) {
  const k = adres.toLowerCase();
  for (const [tr, slug] of Object.entries(SEHIR_MAP)) {
    if (k.includes(tr)) return { isim: tr, slug };
  }
  return { isim: '', slug: '' };
}

function adresParcala(adres) {
  const binaRegex = /([A-ZÇĞİÖŞÜa-zçğışöşü\s]+(APT|APARTMANI|APARTMAN|PLAZA|İŞ MERKEZİ|IS MERKEZI|İŞHANI|ISHANI|TOWER|REZİDANS|REZIDANS|BLOK)[A-ZÇĞİÖŞÜa-zçğışöşü\s\.]*)/i;
  const binaMatch = adres.match(binaRegex);
  const bina = binaMatch ? binaMatch[0].trim() : '';
  const sehir = sehirTespit(adres);
  return { bina, sehir };
}

function riskHesapla(siparis) {
  const adres = (siparis.adres || '').toLowerCase();
  const riskliKelimeler = ['plaza', 'iş merkezi', 'is merkezi', 'işhanı', 'ishani', 'tower', 'rezidans', 'ofis', 'büro', 'buro'];
  const bulunan = riskliKelimeler.filter(k => adres.includes(k));

  if (bulunan.length > 0) {
    const etiket = bulunan.map(k => k.charAt(0).toUpperCase() + k.slice(1)).join(', ');
    return { riskEmoji: '🔴', riskTR: 'YÜKSEK RİSK', riskAciklama: etiket + ' tespit edildi' };
  }

  const katRegex = /k[:\.]?\s*[3-9]|kat\s*[3-9]/i;
  if (katRegex.test(siparis.adres || '')) {
    return { riskEmoji: '🟡', riskTR: 'ORTA RİSK', riskAciklama: 'Yüksek kat — ofis olabilir' };
  }

  return { riskEmoji: '🟢', riskTR: 'NORMAL', riskAciklama: 'Standart konut adresi' };
}

function telegramMesajOlustur(siparis) {
  const urun = kodaIsimCevir(siparis.urun.toUpperCase());
  const telefon = (siparis.telefon || '').replace(/\s/g, '');
  let telefonRakam = telefon.replace(/\D/g, '');
  if (telefonRakam.startsWith('90')) telefonRakam = telefonRakam.slice(2);
  if (telefonRakam.startsWith('0')) telefonRakam = telefonRakam.slice(1);
  const telefonUyari = telefonRakam.length !== 10 ? ' ⚠️EKSİK' : '';
  const { bina, sehir } = adresParcala(siparis.adres || '');
  const { riskEmoji, riskTR, riskAciklama } = riskHesapla(siparis);
  const baroLink = 'https://www.barobirlik.org.tr/AvukatArama/?q=' + encodeURIComponent(siparis.ad_soyad);
  const googleTel = 'https://www.google.com/search?q=' + encodeURIComponent('"' + telefon + '"');
  const googleIsimSadece = 'https://www.google.com/search?q=' + encodeURIComponent('"' + siparis.ad_soyad + '"');
  const googleIsimSehir = 'https://www.google.com/search?q=' + encodeURIComponent('"' + siparis.ad_soyad + '" ' + sehir.isim + ' avukat hukuk');
  const googleAdres = 'https://www.google.com/search?q=' + encodeURIComponent('"' + (bina || siparis.adres) + '" avukat hukuk');
  return '📦 YENİ SİPARİŞ!\n\n' +
    'AD: ' + siparis.ad_soyad.toUpperCase() + '\n' +
    'TEL: ' + siparis.telefon + telefonUyari + '\n' +
    'ADRES: ' + siparis.adres.toUpperCase() + '\n' +
    'ÜRÜN: ' + urun + '\n' +
    'TOPLAM: ' + siparis.toplam + ' TL\n' +
    'TOPLAM ADET: ' + (siparis.adet || '-') + '\n\n' +
    '━━━━━━━━━━━━━━━━━━━━━\n' +
    riskEmoji + ' ' + riskTR + ' — ' + riskAciklama + '\n' +
    '━━━━━━━━━━━━━━━━━━━━━\n' +
    '🔗 SORGULA\n' +
    '━━━━━━━━━━━━━━━━━━━━━\n' +
    '📱 ' + googleTel + '\n' +
    '──────────────────\n' +
    '👤 ' + googleIsimSadece + '\n' +
    '──────────────────\n' +
    '👤 ' + googleIsimSehir + '\n' +
    '──────────────────\n' +
    '⚖️ ' + baroLink + '\n' +
    '──────────────────\n' +
    '🏢 ' + googleAdres;
}

async function telegramGonder(siparis) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return true;
  const msg = telegramMesajOlustur(siparis);
  for (let deneme = 0; deneme < 3; deneme++) {
    try {
      await axios.post('https://api.telegram.org/bot' + TELEGRAM_BOT_TOKEN + '/sendMessage', {
        chat_id: TELEGRAM_CHAT_ID,
        text: msg,
        disable_web_page_preview: true,
      });
      console.log('Telegram gönderildi ✓');
      return true;
    } catch (e) {
      console.error('Telegram err (deneme ' + (deneme+1) + '):', e.message);
      if (deneme < 2) await bekle(3000);
    }
  }
  // 3 denemede başarısız — DB'ye kaydet
  try {
    await db.execute({
      sql: 'INSERT INTO bekleyen_siparisler (siparis_json) VALUES (?)',
      args: [JSON.stringify(siparis)],
    });
    console.error('⚠️ Sipariş DB yedekle kaydedildi, retry bekliyor.');
  } catch (dbErr) {
    console.error('DB yedek kayıt hatası:', dbErr.message);
  }
  return false;
}

// Her 2 dakikada bir bekleyen siparişleri dene
async function bekleyenSiparisleriGonder() {
  try {
    const r = await db.execute('SELECT * FROM bekleyen_siparisler ORDER BY tarih ASC LIMIT 10');
    for (const row of r.rows) {
      const siparis = JSON.parse(row.siparis_json);
      const msg = telegramMesajOlustur(siparis);
      try {
        await axios.post('https://api.telegram.org/bot' + TELEGRAM_BOT_TOKEN + '/sendMessage', {
          chat_id: TELEGRAM_CHAT_ID,
          text: '🔄 BEKLEYEN SİPARİŞ (Yeniden):\n' + msg,
          disable_web_page_preview: true,
        });
        await db.execute({ sql: 'DELETE FROM bekleyen_siparisler WHERE id = ?', args: [row.id] });
        console.log('Bekleyen sipariş gönderildi, ID:', row.id);
        await bekle(1000);
      } catch (e) {
        console.error('Bekleyen sipariş gönderilemedi, ID:', row.id, e.message);
      }
    }
  } catch (e) {
    console.error('bekleyenSiparisleriGonder err:', e.message);
  }
}
setInterval(bekleyenSiparisleriGonder, 2 * 60 * 1000);


// ─── API ÇAĞRILARI ─────────────────────────────────────────────────────────────
// FIX: v21.0 → v25.0 (tüm endpoint'lerde)

async function igMesaj(id, metin) {
  try {
    await axios.post(
      'https://graph.instagram.com/v25.0/me/messages',
      { recipient: { id }, message: { text: metin } },
      { headers: { Authorization: `Bearer ${IG_ACCESS_TOKEN}`, 'Content-Type': 'application/json' } }
    );
  } catch (e) { console.error('msg err:', e.message); }
}

async function igGorsel(id, url) {
  try {
    await axios.post(
      'https://graph.instagram.com/v25.0/me/messages',
      { recipient: { id }, message: { attachment: { type: 'image', payload: { url, is_reusable: true } } } },
      { headers: { Authorization: `Bearer ${IG_ACCESS_TOKEN}`, 'Content-Type': 'application/json' } }
    );
  } catch (e) { console.error('img err:', e.message); }
}

async function yorumuCevapla(yorumId, metin) {
  try {
    await axios.post(
      'https://graph.instagram.com/v25.0/' + yorumId + '/replies',
      { message: metin },
      { headers: { Authorization: 'Bearer ' + IG_ACCESS_TOKEN, 'Content-Type': 'application/json' } }
    );
    console.log('Yorum cevaplandi:', yorumId);
  } catch (e) { console.error('Yorum cevapla err:', e.message); }
}

async function claude(mesajlar) {
  try {
    const r = await axios.post(
      'https://api.anthropic.com/v1/messages',
      {
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1000,
        system: PROMPT,
        messages: mesajlar,
      },
      {
        headers: {
          'x-api-key': CLAUDE_API_KEY,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json',
        },
      }
    );
    return r.data.content[0].text;
  } catch (e) {
    console.error('Claude err:', e.message);
    return 'Şu an teknik bir sorun var, birazdan tekrar yazabilirsiniz.';
  }
}

// ─── ANA İŞLEM DÖNGÜSÜ ────────────────────────────────────────────────────────
async function isle(id) {
  const durum = islemDurumuAl(id);

  if (durum.mesgulMu) return;
  if (durum.bekleyenler.length === 0) return;

  durum.mesgulMu = true;

  try {
    const mesajlar = durum.bekleyenler.splice(0);

    const benzersiz = [];
    let onceki = '';
    for (const m of mesajlar) {
      const t = m.trim().toLowerCase();
      if (t !== onceki) { benzersiz.push(m); onceki = t; }
    }
    let birlesik = benzersiz.join(' ').trim();

    // Kısa ürün kodu düzeltmesi: "28" → "0028", "21" → "0021" vb.
    const KOD_MAP = { '21':'0021','22':'0022','23':'0023','24':'0024','25':'0025','26':'0026','27':'0027','28':'0028' };
    birlesik = birlesik.replace(/\b(2[1-8])\b/g, (m) => KOD_MAP[m] || m);

    if (!birlesik || anlamsizMi(birlesik)) return;

    const veri = await dbKullaniciAl(id);

    let vitrinBuTurGitti = false;
    if (!veri.gorselGitti) {
      veri.gorselGitti = true;
      vitrinBuTurGitti = true;
      await igMesaj(id, VITRIN_METNI);
      for (const url of TUM_GORSELLER) {
        await igGorsel(id, url);
        await bekle(600);
      }
      const selamlamaMi = /^(merhaba|selam|iyi g.nl.r|g.nayd.n|iyi ak.amlar|hey|sa|slm|mrb)[\s!.]*$/i.test(birlesik.trim());
      veri.konusmalar.push({ role: 'user', content: birlesik });
      veri.konusmalar.push({ role: 'assistant', content: VITRIN_METNI });
      await dbKaydet(id, veri);
      if (selamlamaMi) {
        if (durum.bekleyenler.length > 0) isle(id);
        return;
      }
    }

    // Kart sorusu kontrolü
    if (kartVar(birlesik) && !veri.kartUyariGitti) {
      const siparisAsamasinda = veri.konusmalar.some(m =>
        m.role === 'assistant' && (
          m.content.includes('Onaylıyor musunuz') ||
          m.content.includes('TOPLAM:') ||
          m.content.includes('nakit mi') ||
          m.content.includes('Nakit mi') ||
          m.content.includes('kart mı') ||
          m.content.includes('Kart mı')
        )
      );
      if (!siparisAsamasinda) {
        veri.konusmalar.push({ role: 'user', content: birlesik });
        const kartCevap = 'Evet tabiki yapabilirsiniz efendim, kapıda kartla ödeme seçeneğimiz mevcut.';
        veri.konusmalar.push({ role: 'assistant', content: kartCevap });
        await dbKaydet(id, veri);
        await igMesaj(id, kartCevap);
        if (durum.bekleyenler.length > 0) isle(id);
        return;
      } else {
        veri.kartUyariGitti = true;
        veri.konusmalar.push({ role: 'user', content: birlesik });
        veri.konusmalar.push({ role: 'assistant', content: KART_UYARI });
        await dbKaydet(id, veri);
        await igMesaj(id, KART_UYARI);
        if (durum.bekleyenler.length > 0) isle(id);
        return;
      }
    }

    veri.konusmalar.push({ role: 'user', content: birlesik });

    if (veri.konusmalar.length > 40) {
      veri.konusmalar = veri.konusmalar.slice(-40);
    }

    const yanit = await claude(veri.konusmalar);

    const temiz = yanit
      .replace(/###SIPARIS_BASLA###[\s\S]*?###SIPARIS_BITIS###/g, '')
      .replace(/###VITRIN_GOSTER###/g, '')
      .trim();

    veri.konusmalar.push({ role: 'assistant', content: temiz });
    await dbKaydet(id, veri);

    const siparis = siparisiParsEt(yanit);
    if (siparis && siparis.ad_soyad) {
      const telegramBasarili = await telegramGonder(siparis);
      veri.siparisVerildi = true;
      veri.siparisTarihi = Math.floor(Date.now() / 1000);
      await dbKaydet(id, veri);
      if (!telegramBasarili) {
        console.error('⚠️ Sipariş Telegram\'a gitmedi, DB\'ye yedeklendi:', siparis.ad_soyad);
      }
      if (durum.takipTimer) {
        clearTimeout(durum.takipTimer);
        durum.takipTimer = null;
      }
    }

    if (yanit.includes('###VITRIN_GOSTER###') && !vitrinBuTurGitti) {
      await igMesaj(id, VITRIN_METNI);
      if (temiz) {
        await bekle(400);
        await igMesaj(id, temiz);
      }
    } else if (temiz) {
      await igMesaj(id, temiz);
    }

    if (durum.bekleyenler.length > 0) isle(id);

  } catch (e) {
    console.error('isle() hata:', id, e.message, e.stack);
    try {
      await igMesaj(id, 'Şu an teknik bir sorun yaşıyoruz, birazdan tekrar yazabilirsiniz.');
    } catch (_) {}
  } finally {
    durum.mesgulMu = false;
  }
}

// ─── PROMPT ───────────────────────────────────────────────────────────────────
const PROMPT = `Sen bir forma mağazasının satış temsilcisisin. Instagram DM. DAIMA Türkçe yanıt ver.

=== DİL VE ÜSLUP ===
- Yanıtlarını daima sade, günlük Türkçe ile yaz. Resmi veya karmaşık kelimeler kullanma.
- Sakin ve dengeli yaz. Heyecanlı, abartılı ifadeler kullanma. Cümleyi doğal bitir, zorla uzatma.
- Daima "siz/sizin/size" kullan. "Sen/sana" YASAK.
- "efendim" kelimesini yanıt başında EN FAZLA 1 kez kullan. Cümle sonunda kullanma.
- KISA yanıt: maksimum 2-3 cümle. Madde işareti yok. Kalın yazı yok.
- Üslup: sade, doğal, işine odaklı. Tıpkı güvenilir bir esnaf gibi.
- YASAK ifadeler:
  "Harika seçim", "Mükemmel seçim", "Güzel seçim", "Harika seçimler",
  "Sevinçle", "Mutluluk duyarım", "Mutluluk duyarız", "Memnuniyetle",
  "Sizi memnun etmek", "Sizin memnuniyetiniz", "Her zaman yanınızdayız",
  "Hizmetinizdeyiz", "Emrinizdeyiz", "Rica ederiz", "Ne kadar güzel",
  "Çok iyi seçtiniz", "Kesinlikle beğeneceksiniz", "Sorunsuz".
- Ürün seçimini asla yorumlama. Görsel proaktif önerme. Siparişe zorlama.
- Konuşma ortasında "Hoş geldiniz" deme. Sorulan soruyu tekrar etme.

=== KİMLİK VE KESİN KURALLAR ===
- Gerçek bir insansın. Hiçbir koşulda yapay zeka, bot, asistan, yazılım olduğunu söyleme.
- "Ben bir yapay zeka...", "Bir AI olarak...", "Bot olarak..." gibi ifadeler KESİNLİKLE YASAK.
- Biri "sen bot musun / robot musun / yapay zeka mısın" derse: "Hayır efendim, sizinle ilgileniyorum." de. Başka açıklama yapma.
- Mağaza adını, kendi adını söyleme. Uydurma.

=== SELAMLAMA (sadece ilk mesajda) ===
- 06-12 arası: "Günaydın efendim, nasıl yardımcı olabilirim?"
- 12-18 arası: "İyi günler efendim, nasıl yardımcı olabilirim?"
- 18-06 arası: "İyi akşamlar efendim, nasıl yardımcı olabilirim?"
- Müşteri daha önce yazmışsa selamlama yapma.

=== NOKTA / PARÇALI MESAJ ===
Müşteri "." ".." "..." veya emoji gönderirse:
"Sohbetin başında görselleri iletmiştik efendim, oradan beğendiğiniz formayı seçip kodunu iletebilirsiniz."

=== GÖRSEL İSTEĞİ ===
Müşteri "görsel yok", "gelmedi", "nereden seçeceğim" gibi bir şey yazarsa:
"Sohbetin başında tüm modellerimizi iletmiştik efendim, yukarı kaydırarak inceleyebilirsiniz."
Asla "görselleri iletiyorum" veya "gönderiyorum" deme — görselleri tekrar gönderemezsin.

=== HATIRLATMA İSTEĞİ ===
"Bize yazar mısınız / hatırlatır mısınız" derse:
"Bizlere siz yazarsanız iyi olur efendim, gün içinde çok sayıda müşteriyle ilgileniyoruz, insanlık hali atlayabiliriz."

=== PAYLAŞILAN GÖNDERI ===
Müşteri Instagram gönderi/reels paylaşırsa:
"Efendim görselin üzerindeki kodu bize iletir misiniz? Örneğin 0021 gibi."

=== ÜRÜNLER ===
Kodları asla gösterme. Daima tam adı büyük harfle yaz:
- 0021 → FB RETRO ÇUBUKLU FORMASI
- 0022 → FB RETRO SARI FORMASI
- 0023 → FB GRİ TASARIM FORMASI
- 0024 → FB PALAMUT SARI FORMASI
- 0025 → FB PALAMUT LACİVERT FORMASI
- 0026 → FB YENİ SEZON LACİVERT FORMASI
- 0027 → FB YENİ SEZON ÇUBUKLU FORMASI
- 0028 → FB YENİ SEZON SARI FORMASI
Yetişkin ürünlerimizde maalesef şort bulunmamaktadır, sadece forma olarak gönderim yapılıyor. Şort sadece çocuk formalarında mevcuttur.

=== STOK ===
Belirli model sorulursa: "Efendim güncel modellerimiz bu şekildedir, bunların haricinde ekstra bir modelimiz yoktur."

=== YENİ SEZON ÜRÜN TESLİMAT BİLGİSİ (0026 / 0027 / 0028) ===
Müşterinin sipariş listesinde 0026, 0027 veya 0028 kodlu ürünlerden biri varsa siparişi normal şekilde al.
Sipariş özetini göster ve "Onaylıyor musunuz?" diye sor. "Onaylıyor musunuz?" cümlesinin hemen ardına, aynı yanıt içinde şu cümleyi ekle (müşteri daha cevap vermeden):
"Seçtiğiniz ürün şu an üretim aşamasındadır. 15 Haziran'da üretimden çıkıp paketlenerek kargoya teslim edilecektir, ardından 2-3 iş günü içerisinde kapınızda olacaktır."
Müşteri her ikisini de görüp onaylarsa (evet/olur/onaylıyorum) kapanış cümlesini söyle ve siparişi tamamla.
- Sadece 1 kez söyle, tekrarlama.


=== FİYATLAR ===
- 1 adet: 630 TL
- 2 adet: 1.250 TL (kampanya otomatik devreye girer, aşağıya bak)
- 3 adet: 1.250 TL (kampanya: 2 al 1 hediye)
Müşteri 4 adet ve üzeri sorarsa: "Efendim şu an için en fazla 3 adet kampanyamız bulunuyor."
ASLA kendi başına fiyat hesaplama. Yukarıdaki fiyatların dışına çıkma.

KAMPANYA KURALI (ÇOK ÖNEMLİ):
Müşteri 2 forma seçerse: "Efendim kampanyamız var, 1 forma da bizden size hediye. Gönderdiğimiz görseller üzerinden istediğiniz 1 formanın kodunu iletirseniz kampanyamızdan yararlanmış olursunuz."
Müşteri 3 forma seçerse: Kampanya otomatik uygulanır, fiyat 1.250 TL'dir. Ayrıca sormadan uygula.

FİYAT SORUSU GELİNCE:
Müşteri fiyat, kampanya, kaç para gibi sorular sorarsa önce ###VITRIN_GOSTER### yaz, sonra kısa açıklama yap.

=== BEDEN ===
Beden tablosunu müşteriye ASLA gösterme. Sadece kilo sor, sonucu söyle.
55-65 kg → S | 66-75 kg → M | 76-85 kg → L | 86-95 kg → XL | 96+ kg → XXL
Beden zaten belli ise tekrar sorma.

Müşteri boy endişesi belirtirse:
"Efendim o boy için [beden] tam olur, gönül rahatlığıyla alabilirsiniz."

=== EKSİK BİLGİ TAMAMLAMA ===
Müşteri eksik bilgi verirse sadece eksik olanı sor, kendi düşünceni katma:

Müşteri beden söyler ama model söylemezse:
"Hangi modellerden almak istiyorsunuz, görseller üzerinden kodunu iletebilirsiniz."

Müşteri model söyler ama beden söylemezse:
"Bu modeller için bedenleriniz ne olacak, kilonuzu söyler misiniz?"

Müşteri hem model hem beden söylerse direkt siparişe geç, tekrar sorma.
Müşteri kaç adet alacağını zaten belirttiyse adet tekrar sorma.

=== KALIP KURALI (nabza göre şerbet) ===
Asla "bu kalıp yok" veya "bu beden yok" deme. Müşterinin isteğine göre ürünü tanımla:

Müşteri bol/oversize/geniş kalıp isterse:
"Ürünlerimiz geniş kalıplıdır efendim, kilonuzu söylerseniz tam bedeninizi belirleyelim."

Müşteri dar/normal/standart isterse VEYA "dar kalıp var mı" diye sorarsa:
"Ürünlerimiz standart kalıplıdır efendim, dar kalıp tercihine de uygundur."
ASLA "geniş kalıplıdır" deme eğer müşteri dar kalıp istiyorsa.

Müşteri 3XL isterse:
"Efendim 3XL bedenimiz bulunmuyor, ancak kalıplarımız geniş olduğu için 2XL sizin için tam oturacaktır. Dilerseniz 2XL üzerinden yardımcı olayım."

Müşteri 4XL, 5XL, 6XL, 7XL, 8XL veya 9XL isterse:
"Maalesef sizlere uygun bir bedenimiz bulunmuyor."
Başka beden önerme, alternatif sunma.

Müşteri kalıp belirtmezse sadece kilo sor, kalıp hakkında yorum yapma.

=== TESLİMAT ===
Müşteri teslim süresi sorarsa:
- Sipariş 0026, 0027 veya 0028 içeriyorsa ya da müşteri bu ürünleri almayı düşünüyorsa: "Efendim 0026, 0027 ve 0028 kodlu yeni sezon formalarımız 15 Haziran'da kargoya verilecektir, ardından 2-3 iş günü içerisinde teslim olacaktır."
- Diğer tüm ürünlerde: "2-3 iş günü içerisinde sizde olur efendim."
- Müşteri ürün seçmeden sorarsa her iki bilgiyi de ver: "Mevcut ürünlerimiz 2-3 iş günü içerisinde teslim edilir. 0026, 0027 ve 0028 kodlu yeni sezon ürünlerimiz ise 15 Haziran'da kargoya verilip 2-3 iş günü içinde kapınıza ulaşır."
=== İADE ===

Bu bilgiyi proaktif olarak söyleme. Sadece müşteri "yanlış gelirse", "dar olursa", "beden tutmazsa" gibi endişe belirtirse söyle:
"Ürün sizlere ulaştıktan sonra 2 gün içerisinde bizlere ulaşırsanız sorununuzu çözüme kavuşturabiliriz efendim."

=== TELEFON DOĞRULAMA ===
Müşteri telefon numarası iletirse şu kurallara göre kontrol et:
- Başında 0 varsa (05XX XXX XX XX): 0 hariç 10 rakam olmalı
- Başında +90 veya 90 varsa: +90/90 hariç 10 rakam olmalı
- Direkt 10 rakam yazılmışsa (5XX XXX XX XX): geçerlidir
Yani tüm varyasyonlarda temizlenmiş hali 10 rakam olmalı. Eğer açıkça eksik görünüyorsa: "Telefon numaranız eksik görünüyor, tekrar iletir misiniz?"
Emin değilsen sor, doğru numarayı yanlış sayma.

=== ADRES DOĞRULAMA ===
Müşteri adres iletirse il, ilçe ve mahalle bilgisinin hepsinin olup olmadığını kontrol et.
Eksikse sadece eksik olanı sor: "Adresinizde [il/ilçe/mahalle] bilgisi eksik, tamamlayabilir misiniz?"
Üçü de tamamlanmadan sipariş özetine geçme.

=== SOHBET GEÇMİŞİ ===
Her cevap vermeden önce tüm sohbet geçmişini göz önünde bulundur. Müşteri daha önce il, ilçe veya başka bir bilgi vermişse tekrar sorma. Belirsiz bir durum varsa kısa ve net bir soru sor, atlama.
Müşteri "dün söylemiştim", "daha önce yazdım", "geçen konuştuk" gibi bir şey derse:
"Sistemsel bir sorun yaşıyoruz, önceki sohbetimizi görüntülemeye çalışıyoruz fakat Instagram ile alakalı bir sorun var. Dilerseniz yeniden yardımcı olabilirim sizlere." de.

=== KOD KURALI ===
Müşteri ürün adını söylerse kodu ayrıca sorma. Müşteri kod yazarsa direkt kabul et.
KESİN KURAL: Mesajda 0021, 0022, 0023, 0024, 0025, 0026, 0027, 0028 sayılarından biri geçiyorsa — "28 numara", "28 numaralı", "0028 olsun", "28 olsun" gibi her türlü ifadede — bu MUTLAKA ürün kodudur. Beden, numara veya başka bir şey olarak yorumlama. "numara" kelimesi yanında olsa bile ürün kodu olarak kabul et, direkt o ürünü seçmiş say.

=== DİĞER TAKIMLAR ===
"Bu sayfamızda Fenerbahçe ağırlıklı gidiyoruz. Diğer modeller için 0536 630 3654 WhatsApp hattımızdan katalog iletebiliriz."

=== KAÇ ADET / HANGİ TAKIM ===
"Fenerbahçe mi yoksa başka takım mı?" sor. Fenerbahçe: güncel modelleri göster. Diğer: WhatsApp yönlendir.

=== KARGO ===
- Şeffaf Kargo: kapıda ödeme, ürünü görerek teslim alırsınız.
- PTT: anlaşmamız yok. Araş şubesi uzaksa en yakın şubeyi öner.
- Diğer kargo: sadece Araş ile gönderim yapılıyor.

=== SIK SORULAR ===
- Kumaş: forma kumaşı, koku yapmaz.
- İsim baskısı: "Evet yazıyoruz efendim." Font sorulursa: "Fenerbahçe'nin resmi kullandığı isim fontunu kullanıyoruz. Sayıların altında Fenerbahçe logosu da yer alıyor." 
- Çekme: çekmez.
- Logo: nakış, sökülmez.
- İndirim: kampanya fiyatı bu.
- Çocuk forması: 12 yaşından itibaren mevcut, forma + şort takım halinde geliyor. 12 yaş altı: yok. Çocuk baskı: sadece sorulursa evet. Çocuk çorap: maalesef yok.

=== ÇOCUK FORMASI SİPARİŞİ ===
Müşteri çocuk forması isterse kilo değil yaş sor: "Çocuğunuz kaç yaşında efendim?"
Yaşa göre sipariş al, ürün adının yanına yaşı yaz. Örnek: FB RETRO ÇUBUKLU FORMASI 12 YAŞ
12 yaş altı için: "Efendim çocuk bedenlerimiz şu an mevcut değil, 12 yaşından itibaren ürünümüz bulunuyor. Çocuk bedenlerimiz 2-3 hafta içinde gelecektir, o zaman yardımcı olabiliriz."
Sipariş özetinde beden yerine yaş yaz: [ÜRÜN ADI] [YAŞ]

=== SİPARİŞ AKIŞI (sırayla takip et) ===
ADIM 1: Görseller otomatik gönderilir.
ADIM 2: Müşteri ürün kodu veya ürün adı iletir. Her ikisi de geçerlidir, kodu ayrıca sorma.
ADIM 3: Ürünü BÜYÜK HARFLE tam adına çevir. Beden bilgisi yoksa sadece kilo sor. Beden zaten belli ise bir daha sorma.
ADIM 3B: Adet konusunda dikkat et. Müşteri kaç ürün kodu veya isim ilettiyse o kadar adet almak istiyor demektir, ayrıca sorma. Sadece hiçbir şekilde anlaşılamıyorsa sor.
ADIM 4: Beden belli olunca şu formu gönder:
"Siparişinizi Oluşturmak İçin

Ad Soyad
Adres (İl İlçe Mahalle)
Telefon Numarası

Yeterli olacaktır."

ADIM 5: Müşteri bilgileri iletince nakit mi kart mı sor.
ADIM 6: Sistem kart uyarısını otomatik yönetir.

NAKİT onay özeti (TAMAMI BÜYÜK HARF):
[AD SOYAD]

[ADRES]

[TELEFON]

[ÜRÜN ADI] [BEDEN] - [ADET] ADET

TOPLAM: X TL - KAPIDA NAKİT

Onaylıyor musunuz?



=== KAPANIŞ (sadece "evet"/"onaylıyorum"/"olur" sonrası) ===
Müşteri siparişi onayladığında YALNIZCA şu cümleyi gönder, kelimesi kelimesine, fazladan hiçbir şey ekleme:
"Siparişinizi büyük bir heyecan ve emekle hazırlayıp kargoya teslim edeceğiz. Sizin için özenle hazırlanan bu paketi kargodan teslim almanız, emeğimize vereceğiniz en güzel karşılık olacaktır. Sevgi ve minnettarlıkla, sağlıcakla kalın efendim."
NOT: Bu kapanış cümlesi bu tek an için geçerlidir. Sohbetin başka hiçbir yerinde bu tarz duygusal veya abartılı ifade kullanma.
Ardından şu JSON bloğunu çıkar (müşteriye gösterme):
###SIPARIS_BASLA###
{"ad_soyad":"","telefon":"","adres":"","urun":"","adet":"","toplam":""}
###SIPARIS_BITIS###`;

// ─── WEBHOOK ──────────────────────────────────────────────────────────────────

const YORUM_VARYASYONLAR = [
  'Merhaba efendim, sizinle daha iyi ilgilenebilmek için bize özelden yazmanızı rica ediyoruz, tüm sorularınızı memnuniyetle yanıtlarız 🙏🏻',
  'Merhaba efendim, fiyat ve modeller hakkında daha iyi bilgi verebilmemiz için bize özelden yazmanızı rica ederiz 🙏🏻',
  'Merhaba efendim, detaylı bilgi almak için bize özelden yazabilirsiniz, size yardımcı olmaktan mutluluk duyarız 🙏🏻',
  'Merhaba efendim, sizinle birebir ilgilenebilmemiz için bize özelden yazmanızı bekliyoruz 🙏🏻',
  'Merhaba efendim, tüm sorularınız için bize özelden yazabilirsiniz, en kısa sürede yardımcı oluruz 🙏🏻',
  'Merhaba efendim, size özel bilgi verebilmemiz için bize özelden yazmanızı rica ederiz 🙏🏻',
  'Merhaba efendim, daha sağlıklı bilgi verebilmek adına bize özelden yazmanızı bekliyoruz 🙏🏻',
  'Merhaba efendim, sorularınızı bize özelden iletirseniz sizinle daha yakından ilgilenebiliriz 🙏🏻',
  'Merhaba efendim, detaylar için bize özelden yazmanız yeterli, hemen yardımcı oluruz 🙏🏻',
  'Merhaba efendim, bilgi almak için bize özelden yazabilirsiniz, memnuniyetle karşılık veririz 🙏🏻',
  'Merhaba efendim, size daha iyi yardımcı olabilmemiz için bize özelden yazmanızı öneririz 🙏🏻',
  'Merhaba efendim, merak ettikleriniz için bize özelden yazarsanız her şeyi detaylıca aktarırız 🙏🏻',
  'Merhaba efendim, fiyat ve ürünler hakkında bize özelden yazmanız yeterli, anında bilgi verelim 🙏🏻',
  'Merhaba efendim, sizinle özelden görüşmek isteriz, bize yazmanız yeterli 🙏🏻',
  'Merhaba efendim, daha iyi hizmet verebilmek için bize özelden yazmanızı rica ediyoruz 🙏🏻',
  'Merhaba efendim, sorularınıza en doğru yanıtı verebilmek için bize özelden yazmanızı bekliyoruz 🙏🏻',
  'Merhaba efendim, ürünlerimiz hakkında merak ettikleriniz için bize özelden yazabilirsiniz 🙏🏻',
  'Merhaba efendim, size özel ilgi gösterebilmemiz için bize özelden yazmanızı rica ederiz 🙏🏻',
  'Merhaba efendim, tüm detayları paylaşabilmemiz için bize özelden yazmanız yeterli 🙏🏻',
  'Merhaba efendim, en hızlı şekilde yardımcı olabilmemiz için bize özelden yazmanızı bekliyoruz 🙏🏻',
];


function rastgeleVaryasyon() {
  return YORUM_VARYASYONLAR[Math.floor(Math.random() * YORUM_VARYASYONLAR.length)];
}

app.get('/', (req, res) => res.status(200).send('OK'));

app.get('/webhook', (req, res) => {
  if (
    req.query['hub.mode'] === 'subscribe' &&
    req.query['hub.verify_token'] === VERIFY_TOKEN
  ) {
    res.status(200).send(req.query['hub.challenge']);
  } else {
    res.status(403).send('Error');
  }
});

app.post('/webhook', async (req, res) => {
  // Meta 200 bekliyor, hemen yanıtla
  res.status(200).send('OK');

  try {
    const body = req.body;

    // DEBUG: Gelen her isteği logla
    console.log('WEBHOOK GELDI | object:', body.object, '| entry sayisi:', (body.entry || []).length);

    // FIX: 'page' object type'ını da kabul et (FB Page bağlantılı IG hesapları)
    if (body.object !== 'instagram' && body.object !== 'page') return;

    for (const entry of body.entry) {

      // ── YORUM OTOMASYONU ──
      for (const change of (entry.changes || [])) {
        console.log('CHANGE FIELD:', change.field, '| value:', JSON.stringify(change.value).slice(0, 100));

        if (change.field !== 'comments') continue;
        const yorum = change.value;
        if (!yorum || !yorum.id) continue;

        // Sadece ana yorumlara cevap ver, reply'ları atla
        if (yorum.parent_id) {
          console.log('Reply yorumu, atlandi:', yorum.id);
          continue;
        }

        // Daha önce işlendiyse atla — Turso DB'de kontrol et
        const yeni = await yorumIslendi(yorum.id);
        if (!yeni) {
          console.log('Tekrar eden yorum, atlandi:', yorum.id);
          continue;
        }

        console.log('YORUM ALINDI:', yorum.id, '| metin:', yorum.text);

        // 1 saniye bekle, cevapla (beğeni kaldırıldı)
        await bekle(1000);
        await yorumuCevapla(yorum.id, rastgeleVaryasyon());
      }

      // ── DM OTOMASYONU ──
      for (const event of (entry.messaging || [])) {
        const sid = event.sender?.id;
        const txt = event.message?.text;

        if (!sid || !txt) continue;
        if (event.message?.is_echo) continue;

        // Flood koruması
        if (floodKontrol(sid)) continue;

        const durum = islemDurumuAl(sid);

        const temizTxt = txt.trim().toLowerCase();
        const sonBekleyen = durum.bekleyenler[durum.bekleyenler.length - 1];
        if (sonBekleyen && sonBekleyen.trim().toLowerCase() === temizTxt) continue;

        durum.bekleyenler.push(txt);

        // Takip mesajı timer'ını sıfırla (müşteri yazdı)
        if (durum.takipTimer) {
          clearTimeout(durum.takipTimer);
          durum.takipTimer = null;
        }

        if (durum.timer) clearTimeout(durum.timer);
        durum.timer = setTimeout(async () => {
          durum.timer = null;
          await isle(sid);

          // İşlem bitti, 45 dk takip timer'ı başlat (sipariş veren müşteriye gönderme)
          durum.takipTimer = setTimeout(async () => {
            durum.takipTimer = null;
            const veriKontrol = await dbKullaniciAl(sid);
            if (veriKontrol.siparisVerildi) return; // Sipariş verilmişse takip mesajı gönderme
            // Sadece 3'ten fazla mesaj attıysa takip mesajı gönder
            const mesajSayisi = veriKontrol.konusmalar.filter(m => m.role === 'user').length;
            if (mesajSayisi <= 3) return;
            const gonder = await takipMesajiGonderilsinMi(sid);
            if (gonder) {
              await igMesaj(sid, 'Aklınıza takılan bir soru var mı, yardımcı olabilir miyim?');
            }
          }, 45 * 60 * 1000);
        }, 3000);
      }
    }
  } catch (e) {
    console.error('Webhook err:', e.message, e.stack);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Bot running on port ${PORT}`));
