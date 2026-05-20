const express = require('express');
const axios = require('axios');
const app = express();

app.use(express.json());

const VERIFY_TOKEN = process.env.VERIFY_TOKEN || 'formataha2024';
const CLAUDE_API_KEY = process.env.CLAUDE_API_KEY;
const IG_ACCESS_TOKEN = process.env.IG_ACCESS_TOKEN;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

// Her kullanici icin durum
const kullanicilar = {};

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

const KART_UYARI = 'Kartla odemelerde kargo firmalari Pos Cihazi Hizmet Bedeli adi altinda +50 TL ekstra bir ucret cikartıyor. Sizler icin en uygunu nakit olmasidır, o sekilde nakit olarak sisteme girecegiz.';

const VITRIN_METNI = 'Kargo Dahil 1 Adet 630\u20BA\n2 Adet Forma 1.250\u20BA\n\n2 Al 1 Hediye Kampanyas\u0131nda 1.250\u20BA\n2 Forma Al\u0131n 1.250\u20BA \u00d6deyin, 1 Forma Bizden Hediye!\nToplam 3 Forma Kap\u0131n\u0131za Gelir!\n\nKap\u0131da \u00d6deme \u015eeffaf Kargo \u0130le G\u00f6nderim Sa\u011fl\u0131yoruz \ud83d\ude4f\ud83c\udffb\n\u00dcr\u00fcn\u00fc G\u00f6r\u00fcp \u00d6yle Teslim Al\u0131yorsunuz \ud83d\udc4d';

function kullaniciyiAl(id) {
  if (!kullanicilar[id]) {
    kullanicilar[id] = {
      konusmalar: [],
      gorselGitti: false,
      kartUyariGitti: false,
      mesgulMu: false,
      bekleyenler: [],
      timer: null,
    };
  }
  return kullanicilar[id];
}

function kodaIsimCevir(metin) {
  var s = metin;
  Object.keys(URUN_KODLARI).forEach(function(k) {
    s = s.replace(new RegExp(k, 'g'), URUN_KODLARI[k]);
  });
  return s;
}

function kartVar(m) {
  return ['kart', 'kard', 'kartla', 'karta', 'kredi'].some(function(k) {
    return m.toLowerCase().indexOf(k) !== -1;
  });
}

function siparisiParsEt(metin) {
  try {
    var m = metin.match(/###SIPARIS_BASLA###([\s\S]*?)###SIPARIS_BITIS###/);
    if (m) return JSON.parse(m[1].trim());
  } catch (e) {}
  return null;
}

async function telegramGonder(siparis) {
  try {
    if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return;
    var urun = kodaIsimCevir(siparis.urun.toUpperCase());
    var msg = 'YEN\u0130 S\u0130PAR\u0130\u015e!\n\nAD SOYAD: ' + siparis.ad_soyad.toUpperCase() +
      '\nTELEFON: ' + siparis.telefon +
      '\nADRES: ' + siparis.adres.toUpperCase() +
      '\nURUN: ' + urun +
      '\nTOPLAM: ' + siparis.toplam + ' TL';
    await axios.post('https://api.telegram.org/bot' + TELEGRAM_BOT_TOKEN + '/sendMessage', {
      chat_id: TELEGRAM_CHAT_ID,
      text: msg,
    });
  } catch (e) {
    console.error('Telegram err:', e.message);
  }
}

async function igMesaj(id, metin) {
  try {
    await axios.post('https://graph.instagram.com/v21.0/me/messages',
      { recipient: { id: id }, message: { text: metin } },
      { headers: { Authorization: 'Bearer ' + IG_ACCESS_TOKEN, 'Content-Type': 'application/json' } }
    );
  } catch (e) { console.error('msg err:', e.message); }
}

async function igGorsel(id, url) {
  try {
    await axios.post('https://graph.instagram.com/v21.0/me/messages',
      { recipient: { id: id }, message: { attachment: { type: 'image', payload: { url: url, is_reusable: true } } } },
      { headers: { Authorization: 'Bearer ' + IG_ACCESS_TOKEN, 'Content-Type': 'application/json' } }
    );
  } catch (e) { console.error('img err:', e.message); }
}

function bekle(ms) {
  return new Promise(function(r) { setTimeout(r, ms); });
}

async function claude(mesajlar) {
  try {
    var r = await axios.post('https://api.anthropic.com/v1/messages',
      {
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 600,
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
    return 'Su an teknik bir sorun var, birazdan tekrar yazabilirsiniz.';
  }
}

async function isle(id) {
  var u = kullaniciyiAl(id);
  if (u.mesgulMu) return;
  if (u.bekleyenler.length === 0) return;

  u.mesgulMu = true;

  // Tum bekleyenleri birlestir, tekrarlari kaldir
  var mesajlar = u.bekleyenler.slice();
  u.bekleyenler = [];

  var benzersiz = [];
  var once = '';
  mesajlar.forEach(function(m) {
    var t = m.trim().toLowerCase();
    if (t !== once) { benzersiz.push(m); once = t; }
  });
  var birlesik = benzersiz.join(' ').trim();
  if (!birlesik) { u.mesgulMu = false; return; }

  var ilkMi = u.konusmalar.length === 0;

  // ILKE: Vitrin ve gorseller sadece 1 kez gider
  if (ilkMi && !u.gorselGitti) {
    u.gorselGitti = true;
    await igMesaj(id, VITRIN_METNI);
    for (var k = 0; k < TUM_GORSELLER.length; k++) {
      await igGorsel(id, TUM_GORSELLER[k]);
      await bekle(600);
    }
    u.konusmalar.push({ role: 'user', content: birlesik });
    u.konusmalar.push({ role: 'assistant', content: VITRIN_METNI });
    u.mesgulMu = false;
    return;
  }

  // Kart uyarisi
  if (kartVar(birlesik) && !u.kartUyariGitti) {
    u.kartUyariGitti = true;
    await igMesaj(id, KART_UYARI);
    u.konusmalar.push({ role: 'user', content: birlesik });
    u.konusmalar.push({ role: 'assistant', content: KART_UYARI });
    u.mesgulMu = false;
    return;
  }

  u.konusmalar.push({ role: 'user', content: birlesik });
  if (u.konusmalar.length > 20) u.konusmalar = u.konusmalar.slice(-20);

  var yanit = await claude(u.konusmalar);

  var temiz = yanit
    .replace(/###SIPARIS_BASLA###[\s\S]*?###SIPARIS_BITIS###/g, '')
    .replace(/###VITRIN_GOSTER###/g, '')
    .trim();

  u.konusmalar.push({ role: 'assistant', content: temiz });

  var siparis = siparisiParsEt(yanit);
  if (siparis && siparis.ad_soyad) await telegramGonder(siparis);

  // ###VITRIN_GOSTER### sadece fiyat metnini gonder, GORSEL GONDERME
  if (yanit.indexOf('###VITRIN_GOSTER###') !== -1) {
    await igMesaj(id, VITRIN_METNI);
  } else {
    await igMesaj(id, temiz);
  }

  u.mesgulMu = false;

  // Bekleyen yeni mesaj varsa isle
  if (u.bekleyenler.length > 0) {
    await isle(id);
  }
}

const PROMPT = [
  'You are a sales representative for a jersey store. Instagram DM. ALWAYS respond in Turkish.',
  '',
  '=== IDENTITY ===',
  'Real human. Never reveal AI. Never invent name. Never say store name.',
  '',
  '=== LANGUAGE ===',
  'Always formal: "siz" "sizin" "size". Never "sen" "sana".',
  '"efendim" max 1x per response, only at sentence start, never at end, not every sentence.',
  'SHORT responses. Max 2-3 sentences. No bullet points. No bold text.',
  '',
  '=== FORBIDDEN ===',
  '"Harika secim" "Mukemmel" "Sevincle" "Mutluluk duyarim" "Tesekkur ederiz" "Guzel secim" "Harika secimler".',
  'Never comment on product choice. Never offer images proactively. Never push to order.',
  'Never say "Hos geldiniz" mid-conversation. Never repeat asked questions. Never invent info.',
  'Never mention +50 TL card fee yourself. Never say "urunleri kontrol ederek alabilirsiniz".',
  '',
  '=== GREETING (first message only) ===',
  '06-12: Gunaydın efendim, nasil yardimci olabilirim?',
  '12-18: Iyi gunler efendim, nasil yardimci olabilirim?',
  '18-06: Iyi aksamlar efendim, nasil yardimci olabilirim?',
  'If customer wrote before: skip greeting.',
  '',
  '=== DOTS/FRAGMENTED MESSAGES ===',
  'If customer sends "." ".." "..." emojis or fragments: they are selecting.',
  'Say: "Ilettigimiz gorseller uzerindeki kodlari bizlere iletirseniz cok daha saglıklı ve dogru bir siparis vermis olacaksınız."',
  '',
  '=== REMINDER REQUEST ===',
  'If customer asks "bize yazar misiniz" "hatirlatir misiniz":',
  '"Bizlere siz yazarsanız cok mutlu oluruz, gun icerisinde bir cok musterimiz ile etkilesim halindeyiz, insanlık hali unutabiliyoruz."',
  '',
  '=== SHARED POST ===',
  'If customer shares Instagram post/reel: "Efendim, daha saglıklı yardimci olabilmem icin ekran fotografı atar misiniz?"',
  '',
  '=== PRODUCTS (ALWAYS UPPERCASE FULL NAME, NEVER CODE) ===',
  '0021/FB RETRO CUBUKLU -> FB RETRO CUBUKLU FORMASI',
  '0022/FB RETRO SARI -> FB RETRO SARI FORMASI',
  '0023/FB GRI TASARIM -> FB GRI TASARIM FORMASI',
  '0024/FB PALAMUT SARI -> FB PALAMUT SARI FORMASI',
  '0025/FB PALAMUT LACIVERT -> FB PALAMUT LACIVERT FORMASI',
  'All: forma + sort takim halinde.',
  '',
  '=== STOCK ===',
  'If asked about specific model: "Efendim guncel modellerimiz bu sekildedir, bunlarin haricinde ekstra bir modelimiz yoktur."',
  '',
  '=== PRICES ===',
  '1: 630 TL | 2: 1250 TL | Campaign: 2 al 1250 TL ode 1 hediye toplam 3 forma | 4: 1750 TL',
  'If 2 selected asks gift: "Efendim dilediginiz 3. bir forma kodunu iletirseniz siparisınize ekleyelim."',
  '',
  '=== SIZE (weight only) ===',
  '55-65->S | 66-75->M | 76-85->L | 86-95->XL | 96+->XXL. If already known, skip.',
  '',
  '=== DELIVERY ===',
  'No order yet: ask city first. After city: "2-3 is gunu icerisinde sizde olur efendim."',
  'After order: directly "2-3 is gunu icerisinde sizde olur efendim."',
  '',
  '=== RETURN ===',
  '"Urun sizlere ulastiktan sonra 2 gun icerisinde sorun yasarsaniz bizlere ulasabilirsiniz, bu konuda yardimci oluruz."',
  '',
  '=== CODE RULE ===',
  'After product selected: "Urunun uzerindeki kodu bize iletirseniz siparisınizi cok daha dogru ve eksiksiz olusturabiliyoruz."',
  '',
  '=== IMAGE REPLY ===',
  'Cannot see image: "Ilettigimiz gorseller uzerindeki kodlari bizlere iletirseniz cok daha saglıklı ve dogru siparis vermis olacaksınız efendim."',
  '',
  '=== OTHER TEAMS ===',
  '"Bu sayfamizda Fenerbahce agırlıklı gidiyoruz. Diger modeller icin 0536 630 3654 WhatsApp hattimizdan katalog iletebiliriz."',
  '',
  '=== HOW MANY ===',
  'Ask: "Fenerbahce mi yoksa baska takım mi?" Fenerbahce: "Guncel modellerimiz bunlardir." Other: WhatsApp yonlendir.',
  '',
  '=== SHIPPING ===',
  'Seffaf Kargo: kapida odeme, urunu gorerek teslim alirsiniz, guvenilirlik on planda.',
  'PTT: anlassmamiz yok, Aras subesi uzaksa en yakin subeyi onerir.',
  'Other cargo: sadece Aras ile gonderim yapilıyor.',
  '',
  '=== COMMON ===',
  'Fabric: forma kumasi, koku yapmaz. Name: evet yazıyoruz. Shrink: cekmez. Logo: nakis, sokulnez.',
  'Discount: kampanya fiyati bu. Kids 12+: mevcut. Kids <12: yok. Kids print: sadece sorulursa evet.',
  '',
  '=== ORDER ===',
  'S1: images auto. S2: ask code. S3: code->UPPERCASE NAME, ask beden. S4: send form text.',
  'Form: "Siparisınizi Olusturmak Icin\n\nAd Soyad\nAdres (Il Ilce Mahalle)\nTelefon Numarasi\nBeden Bilgisi\n\nYeterli olacaktir."',
  'S5: ask nakit/kart. S6: system handles card warning.',
  'CASH (ALL CAPS): [AD]\n\n[ADRES]\n\n[TEL]\n\n[URUN] [BEDEN]\n\nTOPLAM: X TL - KAPIDA NAKIT\n\nOnaylıyor musunuz?',
  'CARD (ALL CAPS, after confirm): same + +50 TL POS BEDELI.',
  '',
  '=== CLOSING (only evet/onayliyorum/olur) ===',
  'Say: Siparisınizi buyuk bir heyecan ve emekle hazırlayıp kargoya teslim edecegiz. Sizin icin ozenle hazırlanan bu paketi kargodan teslim almanız, emegimize verecegıniz en guzel karsilık olacaktır. Sevgi ve minnettarlıkla, saglıcakla kalın efendim.',
  'Output: ###SIPARIS_BASLA### {"ad_soyad":"","telefon":"","adres":"","urun":"","toplam":""} ###SIPARIS_BITIS###',
].join('\n');

app.get('/webhook', function(req, res) {
  if (req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === VERIFY_TOKEN) {
    res.status(200).send(req.query['hub.challenge']);
  } else {
    res.status(403).send('Error');
  }
});

app.post('/webhook', async function(req, res) {
  res.status(200).send('OK');
  try {
    var body = req.body;
    if (body.object !== 'instagram') return;
    for (var i = 0; i < body.entry.length; i++) {
      var messaging = body.entry[i].messaging || [];
      for (var j = 0; j < messaging.length; j++) {
        var event = messaging[j];
        var sid = event.sender && event.sender.id;
        var txt = event.message && event.message.text;
        if (!sid || !txt) continue;
        if (event.message && event.message.is_echo) continue;

        var u = kullaniciyiAl(sid);

        // Ayni mesaj tekrar geldiyse atla
        var temizTxt = txt.trim().toLowerCase();
        if (u.bekleyenler.length > 0 && u.bekleyenler[u.bekleyenler.length - 1].trim().toLowerCase() === temizTxt) continue;

        u.bekleyenler.push(txt);

        if (u.timer) clearTimeout(u.timer);

        (function(id) {
          u.timer = setTimeout(async function() {
            u.timer = null;
            await isle(id);
          }, 3000);
        })(sid);
      }
    }
  } catch (e) {
    console.error('Webhook err:', e.message);
  }
});

var PORT = process.env.PORT || 3000;
app.listen(PORT, function() { console.log('Bot running on port ' + PORT); });
