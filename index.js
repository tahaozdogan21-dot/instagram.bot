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
// npm install @libsql/client
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
  try { await db.execute('ALTER TABLE kullanicilar ADD COLUMN son_mesaj INTEGER DEFAULT 0'); } catch(e) {}
}
dbInit().catch(e => console.error('DB init err:', e.message));

const BIR_GUN_SANIYE = 24 * 60 * 60;

async function dbKullaniciAl(id) {
  const r = await db.execute({ sql: 'SELECT * FROM kullanicilar WHERE id = ?', args: [id] });
  const simdi = Math.floor(Date.now() / 1000);
  if (r.rows.length === 0) {
    await db.execute({ sql: 'INSERT INTO kullanicilar (id, son_mesaj) VALUES (?, ?)', args: [id, simdi] });
    return { gorselGitti: false, kartUyariGitti: false, konusmalar: [] };
  }
  const row = r.rows[0];
  const sonMesaj = Number(row.son_mesaj) || 0;
  // 1 gunden fazla sessizlik → sifirla
  if ((simdi - sonMesaj) > BIR_GUN_SANIYE && row.gorsel_gitti) {
    return { gorselGitti: false, kartUyariGitti: false, konusmalar: [] };
  }
  return {
    gorselGitti:    !!row.gorsel_gitti,
    kartUyariGitti: !!row.kart_uyari_gitti,
    konusmalar:     JSON.parse(row.konusmalar || '[]'),
  };
}

async function dbKaydet(id, data) {
  const simdi = Math.floor(Date.now() / 1000);
  await db.execute({
    sql: `UPDATE kullanicilar
          SET gorsel_gitti = ?, kart_uyari_gitti = ?, konusmalar = ?,
              son_mesaj = ?, guncelleme = unixepoch()
          WHERE id = ?`,
    args: [
      data.gorselGitti ? 1 : 0,
      data.kartUyariGitti ? 1 : 0,
      JSON.stringify(data.konusmalar),
      simdi,
      id,
    ],
  });
}

// 30 günden eski kayıtları temizle
async function eskiKayitlariTemizle() {
  const sinir = Math.floor(Date.now() / 1000) - 30 * 24 * 3600;
  await db.execute({ sql: 'DELETE FROM kullanicilar WHERE guncelleme < ?', args: [sinir] });
}
setInterval(eskiKayitlariTemizle, 24 * 60 * 60 * 1000);

// ─── RAM: Sadece geçici işlem state'i ─────────────────────────────────────────
const islemDurumu = {}; // { [id]: { mesgulMu, bekleyenler, timer } }

function islemDurumuAl(id) {
  if (!islemDurumu[id]) {
    islemDurumu[id] = { mesgulMu: false, bekleyenler: [], timer: null };
  }
  return islemDurumu[id];
}

// ─── SABİTLER ──────────────────────────────────────────────────────────────────
const FORMA_GORSELLERI = {
  '0021': 'https://res.cloudinary.com/dzfiyamng/image/upload/v1778891830/BJK_BEYAZ_RETRO_vybc1r.jpg',
  '0022': 'https://res.cloudinary.com/dzfiyamng/image/upload/v1778891832/BJK_BEYAZ_RETRO_pumkjo.jpg',
  '0023': 'https://res.cloudinary.com/dzfiyamng/image/upload/v1778891832/BJK_BEYAZ_RETRO_vtectc.jpg',
  '0024': 'https://res.cloudinary.com/dzfiyamng/image/upload/v1778891833/BJK_BEYAZ_RETRO_iybbwa.jpg',
  '0025': 'https://res.cloudinary.com/dzfiyamng/image/upload/v1778891832/BJK_BEYAZ_RETRO_oaxlkt.jpg',
};

const URUN_KODLARI = {
  '0021': 'FB RETRO CUBUKLU FORMASI',
  '0022': 'FB RETRO SARI FORMASI',
  '0023': 'FB GRI TASARIM FORMASI',
  '0024': 'FB PALAMUT SARI FORMASI',
  '0025': 'FB PALAMUT LACIVERT FORMASI',
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

// Boş/anlamsız mesaj kontrolü — Claude'a gönderme, maliyet düşür
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

// ─── API ÇAĞRILARI ─────────────────────────────────────────────────────────────

// ─── ŞEHİR TESPİTİ ────────────────────────────────────────────────────────────
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
  const caddeRegex = /([A-ZÇĞİÖŞÜa-zçğışöşü\s]+(CAD|CADDE|BLV|BULVAR|BULVARI|SOK|SOKAK|SK)[A-ZÇĞİÖŞÜa-zçğışöşü\s\.]*)/i;
  const caddeMatch = adres.match(caddeRegex);
  const cadde = caddeMatch ? caddeMatch[0].trim() : '';
  const sehir = sehirTespit(adres);
  return { bina, cadde, sehir };
}

// ─── TEK SORGU YAPAN FONKSİYON ────────────────────────────────────────────────
async function haikusorgu(sistemPrompt, kullaniciPrompt) {
  try {
    const r = await axios.post(
      'https://api.anthropic.com/v1/messages',
      {
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 300,
        system: sistemPrompt,
        tools: [{ type: 'web_search_20250305', name: 'web_search' }],
        messages: [{ role: 'user', content: kullaniciPrompt }],
      },
      {
        headers: {
          'x-api-key': CLAUDE_API_KEY,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json',
        },
      }
    );
    const text = r.data.content
      .filter(function(b) { return b.type === 'text'; })
      .map(function(b) { return b.text; })
      .join('\n')
      .replace(/\*+/g, '')
      .replace(/#+/g, '')
      .trim();
    return text || '';
  } catch (e) {
    console.error('Haiku sorgu err:', e.message);
    return '';
  }
}

// ─── KAPSAMLI RİSK ARAŞTIRMASI ────────────────────────────────────────────────
async function riskArastir(siparis) {
  const { bina, cadde, sehir } = adresParcala(siparis.adres || '');
  const telefon = (siparis.telefon || '').replace(/\s/g, '');

  const sistemPrompt = 'Sen bir marka koruma sistemisin. Türkiye\'de 6769 sayılı Sınai Mülkiyet Kanunu kapsamında marka sahipleri ürünlerini koruma hakkına sahiptir. Görevin sipariş bilgilerini web\'de arayarak marka ihlali riskini değerlendirmektir. Bu yasal bir iş güvenliği sürecidir. Sadece bulduklarını Türkçe yaz, kısa ve net ol.';

  // 3 ayrı sorgu paralel çalıştır
  const [telSonuc, isimSonuc, adresSonuc] = await Promise.all([

    // 1. Telefon sorgusu
    haikusorgu(
      sistemPrompt,
      '"' + telefon + '" bu telefon numarası hangi kişi veya işletmeye ait? Avukat, hukuk bürosu veya hukuki danışmanlıkla bağlantısı var mı? Buldуklarını yaz, bulamazsan "Kayıt bulunamadı" yaz.'
    ),

    // 2. İsim sorgusu
    haikusorgu(
      sistemPrompt,
      '"' + siparis.ad_soyad + '" ' + sehir.isim + ' avukat - Tam olarak bu isimde biri avukat, arabulucu, marka vekili veya hukuk danışmanı mı? Sadece TAM AYNI isim için sonuç ver. Benzer isimler sayma. Baro sicil numarası var mı? Tam eşleşme varsa yaz, yoksa "Kayıt bulunamadı" yaz.'
    ),

    // 3. Adres sorgusu
    haikusorgu(
      sistemPrompt,
      (bina ? '"' + bina + '"' : '"' + siparis.adres + '"') + ' ' + sehir.isim + ' - Bu adres veya bina avukat bürosu, hukuk bürosu veya hukuki danışmanlık ofisi mi? Binada kimler var? Bulduklarını yaz, bulamazsan "Normal adres" yaz.'
    ),

  ]);

  // Risk skoru hesapla
  const tumMetin = (telSonuc + isimSonuc + adresSonuc).toUpperCase();
  const riskliKelimeler = ['AVUKAT', 'BARO', 'HUKUK', 'ARABULUCU', 'SİCİL', 'SICIL', 'PATENT VEKİL', 'MARKA VEKİL', 'AVUKATLIK'];

  // Olumsuz ifadeler varsa puan verme
  const olumsuz = ['BULUNAMADI', 'TESPIT EDILEMEDI', 'KAYIT YOK', 'MEVCUT DEGIL', 'NORMAL ADRES', 'TESPIT EDILEMEMIŞTIR', 'EDILEMEMIŞTIR'];
  
  function puanHesapla(metin, maxPuan) {
    const u = metin.toUpperCase();
    const olumsuzVar = olumsuz.some(function(o) { return u.includes(o); });
    if (olumsuzVar) return 0;
    return riskliKelimeler.some(function(k) { return u.includes(k); }) ? maxPuan : 0;
  }

  const puan =
    puanHesapla(telSonuc, 3) +
    puanHesapla(isimSonuc, 3) +
    puanHesapla(adresSonuc, 2);

  let riskEmoji, riskTR, riskAciklama;

  if (!telSonuc && !isimSonuc && !adresSonuc) {
    riskEmoji = '⚪';
    riskTR = 'ANALİZ YAPILAMADI';
    riskAciklama = 'Otomatik analiz tamamlanamadı, manuel doğrulama önerilir';
  } else if (puan >= 5) {
    riskEmoji = '🔴';
    riskTR = 'YÜKSEK RİSK';
    riskAciklama = 'Birden fazla avukatlık bağlantısı tespit edildi';
  } else if (puan >= 2) {
    riskEmoji = '🟡';
    riskTR = 'ORTA RİSK';
    riskAciklama = 'Şüpheli sinyal var, manuel doğrulama önerilir';
  } else {
    riskEmoji = '🟢';
    riskTR = 'NORMAL';
    riskAciklama = 'Avukatlık bağlantısı bulunamadı';
  }

  console.log('=== RİSK ANALİZİ ===');
  console.log('TEL:', telSonuc);
  console.log('İSİM:', isimSonuc);
  console.log('ADRES:', adresSonuc);
  console.log('PUAN:', puan);
  console.log('RİSK:', riskTR);
  console.log('===================');

  return { telSonuc, isimSonuc, adresSonuc, riskEmoji, riskTR, riskAciklama };
}

// ─── TELEGRAM GÖNDER ──────────────────────────────────────────────────────────
async function telegramGonder(siparis) {
  try {
    if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return;

    const urun = kodaIsimCevir(siparis.urun.toUpperCase());
    const telefon = (siparis.telefon || '').replace(/\s/g, '');
    const telefonUyari = telefon.replace(/\D/g, '').length < 10 ? ' ⚠️EKSİK' : '';
    const { bina, cadde, sehir } = adresParcala(siparis.adres || '');

    // Araştırmayı yap
    const { telSonuc, isimSonuc, adresSonuc, riskEmoji, riskTR, riskAciklama } = await riskArastir(siparis);

    // Sorgulama linkleri
    const avukatSorgula = sehir.slug ? 'https://avukatsorgula.com/' + sehir.slug + '-avukat-sorgulama' : 'https://avukatsorgula.com';
    const baroLink = 'https://www.barobirlik.org.tr/AvukatArama/?q=' + encodeURIComponent(siparis.ad_soyad);
    const googleTel = 'https://www.google.com/search?q=' + encodeURIComponent('"' + telefon + '"');
    const googleIsimSadece = 'https://www.google.com/search?q=' + encodeURIComponent('"' + siparis.ad_soyad + '"');
    const googleIsimSehir = 'https://www.google.com/search?q=' + encodeURIComponent('"' + siparis.ad_soyad + '" ' + sehir.isim + ' avukat hukuk');
    const googleAdres = 'https://www.google.com/search?q=' + encodeURIComponent('"' + (bina || siparis.adres) + '" avukat hukuk');
    const numaraAra = 'https://www.numaraara.com/numara/' + telefon;

    const msg =
      '📦 YENİ SİPARİŞ!\n\n' +
      'AD: ' + siparis.ad_soyad.toUpperCase() + '\n' +
      'TEL: ' + siparis.telefon + telefonUyari + '\n' +
      'ADRES: ' + siparis.adres.toUpperCase() + '\n' +
      'ÜRÜN: ' + urun + '\n' +
      'TOPLAM: ' + siparis.toplam + ' TL\n\n' +
      '━━━━━━━━━━━━━━━━━━━━━\n' +
      riskEmoji + ' ' + riskTR + ' — ' + riskAciklama + '\n' +
      '━━━━━━━━━━━━━━━━━━━━━\n' +
      '📱 ' + (telSonuc || 'Analiz yapılamadı') + '\n' +
      '──────────────────\n' +
      '👤 ' + (isimSonuc || 'Analiz yapılamadı') + '\n' +
      '──────────────────\n' +
      '🏢 ' + (adresSonuc || 'Analiz yapılamadı') + '\n\n' +
      '━━━━━━━━━━━━━━━━━━━━━\n' +
      '🔗 SORGULA\n' +
      '━━━━━━━━━━━━━━━━━━━━━\n' +
      '📱 ' + googleTel + '\n' +
      '──────────────────\n' +
      '📱 ' + numaraAra + '\n' +
      '──────────────────\n' +
      '👤 ' + googleIsimSadece + '\n' +
      '──────────────────\n' +
      '👤 ' + googleIsimSehir + '\n' +
      '──────────────────\n' +
      '⚖️ ' + baroLink + '\n' +
      '──────────────────\n' +
      '⚖️ ' + avukatSorgula + '\n' +
      '──────────────────\n' +
      '🏢 ' + googleAdres;

    await axios.post('https://api.telegram.org/bot' + TELEGRAM_BOT_TOKEN + '/sendMessage', {
      chat_id: TELEGRAM_CHAT_ID,
      text: msg,
      disable_web_page_preview: true,
    });
  } catch (e) {
    console.error('Telegram err:', e.message);
  }
}


async function igMesaj(id, metin) {
  try {
    await axios.post(
      'https://graph.instagram.com/v21.0/me/messages',
      { recipient: { id }, message: { text: metin } },
      { headers: { Authorization: `Bearer ${IG_ACCESS_TOKEN}`, 'Content-Type': 'application/json' } }
    );
  } catch (e) { console.error('msg err:', e.message); }
}

async function igGorsel(id, url) {
  try {
    await axios.post(
      'https://graph.instagram.com/v21.0/me/messages',
      { recipient: { id }, message: { attachment: { type: 'image', payload: { url, is_reusable: true } } } },
      { headers: { Authorization: `Bearer ${IG_ACCESS_TOKEN}`, 'Content-Type': 'application/json' } }
    );
  } catch (e) { console.error('img err:', e.message); }
}

async function claude(mesajlar) {
  try {
    const r = await axios.post(
      'https://api.anthropic.com/v1/messages',
      {
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 400, // 600'den düşürdük — kısa cevap yeter
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

  // Race condition koruması: zaten işlemdeyse çıkıyoruz,
  // isle() zaten biterken kuyruğu kontrol ediyor (aşağıda).
  if (durum.mesgulMu) return;
  if (durum.bekleyenler.length === 0) return;

  durum.mesgulMu = true;

  // Tüm bekleyenleri al, kuyruğu temizle
  const mesajlar = durum.bekleyenler.splice(0);

  // Tekrar ve boşlukları temizle
  const benzersiz = [];
  let onceki = '';
  for (const m of mesajlar) {
    const t = m.trim().toLowerCase();
    if (t !== onceki) { benzersiz.push(m); onceki = t; }
  }
  const birlesik = benzersiz.join(' ').trim();

  if (!birlesik || anlamsizMi(birlesik)) {
    durum.mesgulMu = false;
    return;
  }

  // DB'den kullanıcı verisi
  const veri = await dbKullaniciAl(id);
  const ilkMi = veri.konusmalar.length === 0;

  // ── Vitrin: sadece ilk mesajda, sadece 1 kez ──
  if (!veri.gorselGitti) {
    veri.gorselGitti = true;
    await igMesaj(id, VITRIN_METNI);
    for (const url of TUM_GORSELLER) {
      await igGorsel(id, url);
      await bekle(600);
    }
    // Sadece selamlama ise burada dur
    const selamlamaMi = /^(merhaba|selam|iyi g.nl.r|g.nayd.n|iyi ak.amlar|hey|sa|slm|mrb)[\s!.]*$/i.test(birlesik.trim());
    veri.konusmalar.push({ role: 'user', content: birlesik });
    veri.konusmalar.push({ role: 'assistant', content: VITRIN_METNI });
    await dbKaydet(id, veri);
    if (selamlamaMi) {
      durum.mesgulMu = false;
      if (durum.bekleyenler.length > 0) await isle(id);
      return;
    }
    // Soru varsa Claude da cevap versin — devam et
  }

  // ── Kart uyarısı: sadece 1 kez ──
  if (kartVar(birlesik) && !veri.kartUyariGitti) {
    veri.kartUyariGitti = true;
    veri.konusmalar.push({ role: 'user', content: birlesik });
    veri.konusmalar.push({ role: 'assistant', content: KART_UYARI });
    dbKaydet(id, veri);

    await igMesaj(id, KART_UYARI);
    durum.mesgulMu = false;
    if (durum.bekleyenler.length > 0) await isle(id);
    return;
  }

  // ── Claude'a gönder ──
  veri.konusmalar.push({ role: 'user', content: birlesik });

  // Maliyet optimizasyonu: son 10 mesaj (20 yerine)
  if (veri.konusmalar.length > 10) {
    veri.konusmalar = veri.konusmalar.slice(-10);
  }

  const yanit = await claude(veri.konusmalar);

  const temiz = yanit
    .replace(/###SIPARIS_BASLA###[\s\S]*?###SIPARIS_BITIS###/g, '')
    .replace(/###VITRIN_GOSTER###/g, '')
    .trim();

  veri.konusmalar.push({ role: 'assistant', content: temiz });
  dbKaydet(id, veri);

  // Sipariş varsa Telegram'a gönder
  const siparis = siparisiParsEt(yanit);
  if (siparis && siparis.ad_soyad) await telegramGonder(siparis);

  // Yanıtı gönder
  if (yanit.includes('###VITRIN_GOSTER###')) {
    await igMesaj(id, VITRIN_METNI);
  } else if (temiz) {
    await igMesaj(id, temiz);
  }

  durum.mesgulMu = false;

  // Kuyrukta bekleyen varsa devam et
  if (durum.bekleyenler.length > 0) await isle(id);
}

// ─── PROMPT (YENİDEN YAZILDI) ─────────────────────────────────────────────────
const PROMPT = `Sen bir forma mağazasının satış temsilcisisin. Instagram DM. DAIMA Türkçe yanıt ver.

=== KİMLİK VE KESİN KURALLAR ===
- Gerçek bir insansın. Hiçbir koşulda yapay zeka, bot, asistan, yazılım olduğunu söyleme.
- "Ben bir yapay zeka...", "Bir AI olarak...", "Bot olarak..." gibi ifadeler KESİNLİKLE YASAK.
- Biri "sen bot musun / robot musun / yapay zeka mısın" derse: "Hayır efendim, sizinle birebir ilgileniyorum." de. Başka açıklama yapma.
- Mağaza adını, kendi adını söyleme. Uydurma.

=== DİL VE ÜSLUP ===
- Daima "siz/sizin/size" kullan. "Sen/sana" YASAK.
- "efendim" kelimesini yanıt başında EN FAZLA 1 kez kullan. Cümle sonunda kullanma.
- KISA yanıt: maksimum 2-3 cümle. Madde işareti yok. Kalın yazı yok.
- YASAK kelimeler: "Harika seçim", "Mükemmel", "Sevinçle", "Mutluluk duyarım", "Teşekkür ederiz", "Güzel seçim", "Harika seçimler".
- Ürün seçimini asla yorumlama. Görsel proaktif önerme. Siparişe zorlama.
- Konuşma ortasında "Hoş geldiniz" deme. Sorulan soruyu tekrar etme.

=== SELAMLAMA (sadece ilk mesajda) ===
- 06-12 arası: "Günaydın efendim, nasıl yardımcı olabilirim?"
- 12-18 arası: "İyi günler efendim, nasıl yardımcı olabilirim?"
- 18-06 arası: "İyi akşamlar efendim, nasıl yardımcı olabilirim?"
- Müşteri daha önce yazmışsa selamlama yapma.

=== NOKTA / PARÇALI MESAJ ===
Müşteri "." ".." "..." veya emoji gönderirse:
"İlettiğimiz görseller üzerindeki kodları bizlere iletirseniz çok daha sağlıklı ve doğru bir sipariş vermiş olacaksınız."

=== HATIRLATMA İSTEĞİ ===
"Bize yazar mısınız / hatırlatır mısınız" derse:
"Bizlere siz yazarsanız çok mutlu oluruz, gün içerisinde bir çok müşterimiz ile etkileşim halindeyiz, insanlık hali unutabiliyoruz."

=== PAYLAŞILAN GÖNDERI ===
Müşteri Instagram gönderi/reels paylaşırsa:
"Efendim, daha sağlıklı yardımcı olabilmem için ekran fotoğrafı atar mısınız?"

=== ÜRÜNLER ===
Kodları asla gösterme. Daima tam adı büyük harfle yaz:
- 0021 → FB RETRO ÇUBUKLU FORMASI
- 0022 → FB RETRO SARI FORMASI
- 0023 → FB GRİ TASARIM FORMASI
- 0024 → FB PALAMUT SARI FORMASI
- 0025 → FB PALAMUT LACİVERT FORMASI
Tüm ürünler forma + şort takım halinde.

=== STOK ===
Belirli model sorulursa: "Efendim güncel modellerimiz bu şekildedir, bunların haricinde ekstra bir modelimiz yoktur."

=== FİYATLAR ===
- 1 adet: 630 TL
- 2 adet: 1.250 TL
- Kampanya: 2 al 1.250 TL öde → 1 forma hediye (toplam 3 forma)
- 4 adet: 1.750 TL
Müşteri 2 seçip hediye sorarsa: "Efendim dilediğiniz 3. bir forma kodunu iletirseniz siparişinize ekleyelim."

=== BEDEN (sadece kilo sorarak) ===
55-65 kg → S | 66-75 kg → M | 76-85 kg → L | 86-95 kg → XL | 96+ kg → XXL
Beden zaten belli ise tekrar sorma.

=== TESLİMAT ===
Sipariş öncesi şehir sor. Şehir verildikten sonra: "2-3 iş günü içerisinde sizde olur efendim."
Sipariş sonrası direkt: "2-3 iş günü içerisinde sizde olur efendim."

=== İADE ===
"Ürün sizlere ulaştıktan sonra 2 gün içerisinde sorun yaşarsanız bizlere ulaşabilirsiniz, bu konuda yardımcı oluruz."

=== KOD KURALI ===
Ürün seçildikten sonra: "Ürünün üzerindeki kodu bize iletirseniz siparişinizi çok daha doğru ve eksiksiz oluşturabiliyoruz."

=== GÖRSEL YANITI ===
"İlettiğimiz görseller üzerindeki kodları bizlere iletirseniz çok daha sağlıklı ve doğru sipariş vermiş olacaksınız efendim."

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
- İsim baskısı: evet yazıyoruz.
- Çekme: çekmez.
- Logo: nakış, sökülmez.
- İndirim: kampanya fiyatı bu.
- 12+ yaş çocuk: mevcut. 12 yaş altı: yok. Çocuk baskı: sadece sorulursa evet.

=== SİPARİŞ AKIŞI (sırayla takip et) ===
ADIM 1: Görseller otomatik gönderilir.
ADIM 2: Kod sor.
ADIM 3: Kodu BÜYÜK HARFLE tam adına çevir, beden sor.
ADIM 4: Formu gönder:
"Siparişinizi Oluşturmak İçin

Ad Soyad
Adres (İl İlçe Mahalle)
Telefon Numarası
Beden Bilgisi

Yeterli olacaktır."

ADIM 5: Nakit mi kart mı sor.
ADIM 6: Sistem kart uyarısını otomatik yönetir.

NAKİT onay özeti (büyük harf):
[AD SOYAD]

[ADRES]

[TELEFON]

[ÜRÜN ADI] [BEDEN]

TOPLAM: X TL - KAPIDA NAKİT

Onaylıyor musunuz?

KART onay özeti (onaydan sonra, büyük harf): aynı format + "+50 TL POS BEDELİ" ekle.

=== KAPANIŞ (sadece "evet"/"onaylıyorum"/"olur" sonrası) ===
Şunu söyle:
"Siparişinizi büyük bir heyecan ve emekle hazırlayıp kargoya teslim edeceğiz. Sizin için özenle hazırlanan bu paketi kargodan teslim almanız, emeğimize vereceğiniz en güzel karşılık olacaktır. Sevgi ve minnettarlıkla, sağlıcakla kalın efendim."

Ardından şu JSON bloğunu çıkar (müşteriye gösterme):
###SIPARIS_BASLA###
{"ad_soyad":"","telefon":"","adres":"","urun":"","toplam":""}
###SIPARIS_BITIS###`;

// ─── WEBHOOK ──────────────────────────────────────────────────────────────────
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
  res.status(200).send('OK'); // IG 200 bekliyor, hemen yanıtla

  try {
    const body = req.body;
    if (body.object !== 'instagram') return;

    for (const entry of body.entry) {
      for (const event of (entry.messaging || [])) {
        const sid = event.sender?.id;
        const txt = event.message?.text;

        if (!sid || !txt) continue;
        if (event.message?.is_echo) continue;

        const durum = islemDurumuAl(sid);

        // Aynı mesaj tekrar geldiyse atla (IG bazen tekrar gönderiyor)
        const temizTxt = txt.trim().toLowerCase();
        const sonBekleyen = durum.bekleyenler[durum.bekleyenler.length - 1];
        if (sonBekleyen && sonBekleyen.trim().toLowerCase() === temizTxt) continue;

        durum.bekleyenler.push(txt);

        // Debounce: 3 saniye içinde gelen mesajları birleştir
        if (durum.timer) clearTimeout(durum.timer);
        durum.timer = setTimeout(async () => {
          durum.timer = null;
          await isle(sid);
        }, 3000);
      }
    }
  } catch (e) {
    console.error('Webhook err:', e.message);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Bot running on port ${PORT}`));
