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

const BIR_GUN_SANIYE = 45 * 60; // 45 dakika

async function dbKullaniciAl(id) {
  const r = await db.execute({ sql: 'SELECT * FROM kullanicilar WHERE id = ?', args: [id] });
  const simdi = Math.floor(Date.now() / 1000);
  if (r.rows.length === 0) {
    await db.execute({ sql: 'INSERT INTO kullanicilar (id, son_mesaj) VALUES (?, ?)', args: [id, simdi] });
    return { gorselGitti: false, kartUyariGitti: false, konusmalar: [] };
  }
  const row = r.rows[0];
  const sonMesaj = Number(row.son_mesaj) || 0;
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

async function eskiKayitlariTemizle() {
  const sinir = Math.floor(Date.now() / 1000) - 30 * 24 * 3600;
  await db.execute({ sql: 'DELETE FROM kullanicilar WHERE guncelleme < ?', args: [sinir] });
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

async function telegramGonder(siparis) {
  try {
    if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return;

    const urun = kodaIsimCevir(siparis.urun.toUpperCase());
    const telefon = (siparis.telefon || '').replace(/\s/g, '');
    const telefonUyari = telefon.replace(/\D/g, '').length < 10 ? ' ⚠️EKSİK' : '';
    const { bina, sehir } = adresParcala(siparis.adres || '');
    const { riskEmoji, riskTR, riskAciklama } = riskHesapla(siparis);

    const baroLink = 'https://www.barobirlik.org.tr/AvukatArama/?q=' + encodeURIComponent(siparis.ad_soyad);
    const googleTel = 'https://www.google.com/search?q=' + encodeURIComponent('"' + telefon + '"');
    const googleIsimSadece = 'https://www.google.com/search?q=' + encodeURIComponent('"' + siparis.ad_soyad + '"');
    const googleIsimSehir = 'https://www.google.com/search?q=' + encodeURIComponent('"' + siparis.ad_soyad + '" ' + sehir.isim + ' avukat hukuk');
    const googleAdres = 'https://www.google.com/search?q=' + encodeURIComponent('"' + (bina || siparis.adres) + '" avukat hukuk');

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

    await axios.post('https://api.telegram.org/bot' + TELEGRAM_BOT_TOKEN + '/sendMessage', {
      chat_id: TELEGRAM_CHAT_ID,
      text: msg,
      disable_web_page_preview: true,
    });
  } catch (e) {
    console.error('Telegram err:', e.message);
  }
}

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
        max_tokens: 400,
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

  const mesajlar = durum.bekleyenler.splice(0);

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

  const veri = await dbKullaniciAl(id);

  if (!veri.gorselGitti) {
    veri.gorselGitti = true;
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
      durum.mesgulMu = false;
      if (durum.bekleyenler.length > 0) await isle(id);
      return;
    }
  }

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

  veri.konusmalar.push({ role: 'user', content: birlesik });

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

  const siparis = siparisiParsEt(yanit);
  if (siparis && siparis.ad_soyad) await telegramGonder(siparis);

  if (yanit.includes('###VITRIN_GOSTER###')) {
    await igMesaj(id, VITRIN_METNI);
  } else if (temiz) {
    await igMesaj(id, temiz);
  }

  durum.mesgulMu = false;

  if (durum.bekleyenler.length > 0) await isle(id);
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
"Efendim, daha sağlıklı yardımcı olabilmem için ekran fotoğrafı atar mısınız?"

=== ÜRÜNLER ===
Kodları asla gösterme. Daima tam adı büyük harfle yaz:
- 0021 → FB RETRO ÇUBUKLU FORMASI
- 0022 → FB RETRO SARI FORMASI
- 0023 → FB GRİ TASARIM FORMASI
- 0024 → FB PALAMUT SARI FORMASI
- 0025 → FB PALAMUT LACİVERT FORMASI
Yetişkin ürünlerimizde maalesef şort bulunmamaktadır, sadece forma olarak gönderim yapılıyor. Şort sadece çocuk formalarında mevcuttur.

=== STOK ===
Belirli model sorulursa: "Efendim güncel modellerimiz bu şekildedir, bunların haricinde ekstra bir modelimiz yoktur."

=== FİYATLAR ===
- 1 adet: 630 TL
- 2 adet: 1.250 TL (kampanya otomatik devreye girer, aşağıya bak)
- 3 adet: 1.250 TL (kampanya: 2 al 1 hediye)
- 4 adet: 1.750 TL

KAMPANYA KURALI (ÇOK ÖNEMLİ):
Müşteri 2 forma seçerse: "Efendim kampanyamız var, 1 forma da bizden size hediye. Gönderdiğimiz görseller üzerinden istediğiniz 1 formanın kodunu iletirseniz kampanyamızdan yararlanmış olursunuz."
Müşteri 3 forma seçerse: Kampanya otomatik uygulanır, fiyat 1.250 TL'dir. Ayrıca sormadan uygula.
Müşteri 4 forma seçerse: 1.750 TL.
ASLA kendi başına fiyat hesaplama. Yukarıdaki fiyatların dışına çıkma.

FİYAT SORUSU GELİNCE:
Müşteri fiyat, kampanya, kaç para gibi sorular sorarsa önce ###VITRIN_GOSTER### yaz, sonra kısa açıklama yap.

=== BEDEN ===
Beden tablosunu müşteriye ASLA gösterme. Sadece kilo sor, sonucu söyle.
55-65 kg → S | 66-75 kg → M | 76-85 kg → L | 86-95 kg → XL | 96+ kg → XXL
Beden zaten belli ise tekrar sorma.

Müşteri boy endişesi belirtirse:
"Efendim o boy için [beden] tam olur, gönül rahatlığıyla alabilirsiniz."

=== EKSİK BİLGİ TAMAMLAMA ===
Müşteri eksik bilgi verirse sadece eksik olanı sor, kendi düşünceni katma, kampanyayı tekrar açıklama:

Müşteri beden söyler ama model söylemezse:
"Hangi modellerden almak istiyorsunuz, görseller üzerinden kodunu iletebilirsiniz."

Müşteri model söyler ama beden söylemezse:
"Bu modeller için bedenleriniz ne olacak, kilonuzu söyler misiniz?"

Müşteri hem model hem beden söylerse direkt siparişe geç, tekrar sorma.
Müşteri kaç adet alacağını zaten belirttiyse kampanyayı tekrar açıklama.

=== KALIP KURALI (nabza göre şerbet) ===
Asla "bu kalıp yok" veya "bu beden yok" deme. Müşterinin isteğine göre ürünü tanımla:

Müşteri bol/oversize/geniş kalıp isterse:
"Ürünlerimiz geniş kalıplıdır efendim, kilonuzu söylerseniz tam bedeninizi belirleyelim."

Müşteri dar/normal/standart isterse VEYA "dar kalıp var mı" diye sorarsa:
"Ürünlerimiz standart kalıplıdır efendim, dar kalıp tercihine de uygundur."
ASLA "geniş kalıplıdır" deme eğer müşteri dar kalıp istiyorsa.

Müşteri 3XL isterse:
"Efendim 3XL bedenimiz bulunmuyor, ancak kalıplarımız geniş olduğu için 2XL sizin için tam oturacaktır. Dilerseniz 2XL üzerinden yardımcı olayım."

Müşteri kalıp belirtmezse sadece kilo sor, kalıp hakkında yorum yapma.

=== TESLİMAT ===
Sipariş öncesi şehir sor. Şehir verildikten sonra: "2-3 iş günü içerisinde sizde olur efendim."
Sipariş sonrası direkt: "2-3 iş günü içerisinde sizde olur efendim."

=== İADE ===
Bu bilgiyi proaktif olarak söyleme. Sadece müşteri "yanlış gelirse", "dar olursa", "beden tutmazsa" gibi endişe belirtirse söyle:
"Ürün sizlere ulaştıktan sonra 2 gün içerisinde bizlere ulaşırsanız sorununuzu çözüme kavuşturabiliriz efendim."

=== KOD KURALI ===
Müşteri ürün adını söylerse kodu ayrıca sorma. Müşteri kod yazarsa direkt kabul et.

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
- 12+ yaş çocuk: mevcut, forma + şort takım halinde geliyor. 12 yaş altı: yok. Çocuk baskı: sadece sorulursa evet. Çocuk çorap: maalesef yok.

=== SİPARİŞ AKIŞI (sırayla takip et) ===
ADIM 1: Görseller otomatik gönderilir.
ADIM 2: Müşteri ürün kodu veya ürün adı iletir. Her ikisi de geçerlidir, kodu ayrıca sorma.
ADIM 3: Ürünü BÜYÜK HARFLE tam adına çevir. Beden bilgisi yoksa sadece kilo sor. Beden zaten belli ise bir daha sorma.
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

[ÜRÜN ADI] [BEDEN]

TOPLAM: X TL - KAPIDA NAKİT

Onaylıyor musunuz?

KART onay özeti (onaydan sonra, TAMAMI BÜYÜK HARF): aynı format + "+50 TL POS BEDELİ" ekle.

=== KAPANIŞ (sadece "evet"/"onaylıyorum"/"olur" sonrası) ===
Şunu söyle:
"Siparişinizi büyük bir heyecan ve emekle hazırlayıp kargoya teslim edeceğiz. Sizin için özenle hazırlanan bu paketi kargodan teslim almanız, emeğimize vereceğiniz en güzel karşılık olacaktır. Sevgi ve minnettarlıkla, sağlıcakla kalın efendim."

Ardından şu JSON bloğunu çıkar (müşteriye gösterme):
###SIPARIS_BASLA###
{"ad_soyad":"","telefon":"","adres":"","urun":"","toplam":""}
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

// ─── BOT'UN KENDİ IG ID'Sİ — başlangıçta çek ────────────────────────────────
let BOT_IG_ID = '';
async function botIdAl() {
  try {
    const r = await axios.get('https://graph.instagram.com/v25.0/me?fields=id', {
      headers: { Authorization: 'Bearer ' + IG_ACCESS_TOKEN }
    });
    BOT_IG_ID = r.data.id;
    console.log('Bot IG ID:', BOT_IG_ID);
  } catch(e) {
    console.error('Bot ID alinamadi:', e.message);
  }
}
botIdAl();

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

          // İşlem bitti, 45 dk takip timer'ı başlat
          durum.takipTimer = setTimeout(async () => {
            durum.takipTimer = null;
            const gonder = await takipMesajiGonderilsinMi(sid);
            if (gonder) {
              await igMesaj(sid, 'Yardımcı olabileceğim bir konu olursa sizin için buradayım efendim, aklınıza takılan bir soru var mı? Yoksa sadece fiyat bilgisi için mi ulaşmıştınız? 🙏🏻');
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
