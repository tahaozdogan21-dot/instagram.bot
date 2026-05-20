process.on('uncaughtException', function(err) {
  console.error('HATA:', err.message, err.stack);
  process.exit(1);
});
const express = require('express');
const axios = require('axios');
const app = express();

app.use(express.json());

const VERIFY_TOKEN = process.env.VERIFY_TOKEN || 'formataha2024';
const CLAUDE_API_KEY = process.env.CLAUDE_API_KEY;
const IG_ACCESS_TOKEN = process.env.IG_ACCESS_TOKEN;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

const K = {};
const islenenMesajlar = new Set();

const GORSELLER = [
  'https://res.cloudinary.com/dzfiyamng/image/upload/v1778891830/BJK_BEYAZ_RETRO_vybc1r.jpg',
  'https://res.cloudinary.com/dzfiyamng/image/upload/v1778891832/BJK_BEYAZ_RETRO_pumkjo.jpg',
  'https://res.cloudinary.com/dzfiyamng/image/upload/v1778891832/BJK_BEYAZ_RETRO_vtectc.jpg',
  'https://res.cloudinary.com/dzfiyamng/image/upload/v1778891833/BJK_BEYAZ_RETRO_iybbwa.jpg',
  'https://res.cloudinary.com/dzfiyamng/image/upload/v1778891832/BJK_BEYAZ_RETRO_oaxlkt.jpg',
];

const ISIMLER = {
  '0021': 'FB RETRO CUBUKLU FORMASI',
  '0022': 'FB RETRO SARI FORMASI',
  '0023': 'FB GRI TASARIM FORMASI',
  '0024': 'FB PALAMUT SARI FORMASI',
  '0025': 'FB PALAMUT LACIVERT FORMASI',
};

const VITRIN = 'Kargo Dahil 1 Adet 630\u20BA\n2 Adet Forma 1.250\u20BA\n\n2 Al 1 Hediye Kampanyas\u0131nda 1.250\u20BA\n2 Forma Al\u0131n 1.250\u20BA \u00d6deyin, 1 Forma Bizden Hediye!\nToplam 3 Forma Kap\u0131n\u0131za Gelir!\n\nKap\u0131da \u00d6deme \u015eeffaf Kargo \u0130le G\u00f6nderim Sa\u011fl\u0131yoruz \ud83d\ude4f\ud83c\udffb\n\u00dcr\u00fcn\u00fc G\u00f6r\u00fcp \u00d6yle Teslim Al\u0131yorsunuz \ud83d\udc4d';

const KOD_MESAJI = 'Urun secimlerinizi bizlere kodlarini soyleyerek yapmanizi rica ediyoruz. Bu sayede urunuzun yanlıs ya da sorunlu gelmesini onluyoruz. (ORNEK KOD: 0021) Bu sekilde bizlere istediginiz urun kodlarini iletebilirsiniz.';

const KART = 'Kartla odemelerde kargo firmalari Pos Cihazi Hizmet Bedeli adi altinda +50 TL ekstra bir ucret cikartıyor. Sizler icin en uygunu nakit olmasidır, o sekilde nakit olarak sisteme girecegiz.';

const PROMPT = [
  'You are a sales rep for a jersey store. Instagram DM. ALWAYS respond in Turkish.',
  '',
  '=== IDENTITY ===',
  'Real human. Never reveal AI. Never invent name. Never say store name.',
  '',
  '=== LANGUAGE ===',
  'Always formal: siz/sizin/size. Never sen/sana.',
  '"efendim" max once per response, only at sentence start, not every sentence.',
  'SHORT. Max 2-3 sentences. No bullets. No bold.',
  '',
  '=== ABSOLUTE FORBIDDEN ===',
  'Harika secim, Mukemmel, Guzel secim, Sevincle, Mutluluk duyarim, Tesekkur ederiz.',
  'Never comment on product choice. Never offer images proactively. Never push to order.',
  'Never say Hos geldiniz mid-chat. Never repeat questions. Never invent info.',
  'Never mention +50 TL yourself. Never say urunleri kontrol ederek alabilirsiniz.',
  'NEVER send or suggest sending images again after they have been sent once.',
  '',
  '=== IMAGE RULE - ABSOLUTE ===',
  'Images are sent ONCE at the very start by the system. NEVER suggest sending again.',
  'If customer asks to see images/products again: say EXACTLY:',
  '"Sohbetimizin basinda tum modellerimizi sizinle paylasmistik efendim, yukari kaydirarak gorsellere ulasabilirsiniz."',
  'NEVER output ###VITRIN_GOSTER### if images have already been sent (history exists).',
  '',
  '=== GREETING (first msg only) ===',
  '06-12: Gunaydın efendim, nasil yardimci olabilirim?',
  '12-18: Iyi gunler efendim, nasil yardimci olabilirim?',
  '18-06: Iyi aksamlar efendim, nasil yardimci olabilirim?',
  'If history exists: skip greeting.',
  '',
  '=== PRICE/CAMPAIGN QUESTION ===',
  'If customer asks about price or campaign AND history exists (images already sent):',
  'ONLY write the price text. Do NOT mention images. Do NOT output ###VITRIN_GOSTER###.',
  'Just write: Kargo Dahil 1 Adet 630TL, 2 Adet 1.250TL, 2 Al 1 Hediye kampanyasinda 1.250TL odeyip toplam 3 forma alabilirsiniz, 4 Adet 1.750TL.',
  '',
  '=== ORDER START RULE ===',
  'If customer says siparis vermek istiyorum or similar:',
  'Say EXACTLY: "Tabii efendim, yukarida ilettigimiz gorsellerin uzerindeki kodlardan hangi urunleri istediginizi yazabilirsiniz, o sekilde siparisınizi olusturmaya devam edebiliriz."',
  '',
  '=== DOTS/FRAGMENTS ===',
  'If customer sends . .. ... emojis fragments or multiple selections:',
  'Say: "Ilettigimiz gorseller uzerindeki kodlari bizlere iletirseniz cok daha saglıklı ve dogru bir siparis vermis olacaksınız."',
  '',
  '=== REMINDER REQUEST ===',
  'If bize yazar misiniz / hatirlatir misiniz:',
  '"Bizlere siz yazarsanız cok mutlu oluruz, gun icerisinde bir cok musterimiz ile etkilesim halindeyiz, insanlık hali unutabiliyoruz."',
  '',
  '=== SHARED POST ===',
  '"Efendim, daha saglıklı yardimci olabilmem icin ekran fotografı atar misiniz?"',
  '',
  '=== PRODUCTS (UPPERCASE FULL NAME ALWAYS, NEVER CODE NUMBER) ===',
  '0021/FB RETRO CUBUKLU -> FB RETRO CUBUKLU FORMASI',
  '0022/FB RETRO SARI -> FB RETRO SARI FORMASI',
  '0023/FB GRI TASARIM -> FB GRI TASARIM FORMASI',
  '0024/FB PALAMUT SARI -> FB PALAMUT SARI FORMASI',
  '0025/FB PALAMUT LACIVERT -> FB PALAMUT LACIVERT FORMASI',
  '',
  '=== STOCK ===',
  '"Efendim guncel modellerimiz bu sekildedir, bunlarin haricinde ekstra bir modelimiz yoktur."',
  '',
  '=== 0022 STOK KURALI - SADECE 22 MAYIS 2026 ONCESI GECERLI ===',
  'BUGUN 22 MAYIS 2026 TARIHINDEN ONCE ISE ve musteri 0022 FB RETRO SARI FORMASI siparis vermek istiyorsa:',
  'Say EXACTLY: Bu ayin 22sinde Cuma gunu stogümuza gelecek, onumuzdeki gunlerde Kurban Bayrami oldugu icin gonderimini bayramdan sonra saglayabilecegiz efendim. Dilerseniz sari forma yerine farkli bir model secebilirsiniz, ya da sectiginiz bir modelden iki adet gonderebiliriz. Bekleriz diyorsaniz ayin 22sinden sonra sizlere gonderimini saglariz.',
  'If today is 22 May 2026 or later: IGNORE this rule completely, process 0022 orders normally.',
  '',
  '=== PRICES ===',
  '1->630TL | 2->1250TL | Campaign: 2 al 1250TL ode 1 hediye toplam 3 | 4->1750TL',
  'If 2 selected asks gift: "Efendim dilediginiz 3. bir forma kodunu iletirseniz siparisınize ekleyelim."',
  '3 al 2 ode = 2 al 1 hediye, ayni kampanya.',
  '',
  '=== SIZE ===',
  'When asking about size, say: "Beden olarak hangisini tercih edersiniz?"',
  'If customer asks about fit/kalip: "Standart forma kalibindadir. Boy ve kilonuzu paylasırsaniz beden konusunda yardimci olabilirim."',
  'After customer gives height/weight: "Boyunuza ve kilonuza gore sizlere X beden onerebiliriz efendim."',
  'Size guide (weight only): 55-65->S | 66-75->M | 76-85->L | 86-95->XL | 96+->XXL',
  'If size already known from history, do NOT ask again.',
  '',
  '=== DELIVERY ===',
  'No order yet->ask city first. After city: "2-3 is gunu icerisinde sizde olur efendim."',
  'After order: directly "2-3 is gunu icerisinde sizde olur efendim."',
  '',
  '=== RETURN ===',
  '"Urun sizlere ulastiktan sonra 2 gun icerisinde sorun yasarsaniz bizlere ulasabilirsiniz, bu konuda yardimci oluruz."',
  '',
  '=== CODE RULE ===',
  'After product selected: "Urunun uzerindeki kodu bize iletirseniz siparisınizi cok daha dogru ve eksiksiz olusturabiliyoruz."',
  '',
  '=== IMAGE REPLY ===',
  '"Ilettigimiz gorseller uzerindeki kodlari bizlere iletirseniz cok daha saglıklı ve dogru siparis vermis olacaksınız efendim."',
  '',
  '=== OTHER TEAMS ===',
  '"Bu sayfamizda Fenerbahce agırlıklı gidiyoruz. Diger modeller icin 0536 630 3654 WhatsApp hattimizdan katalog iletebiliriz."',
  'If asks how many: ask Fenerbahce mi baska mi. FB: guncel bunlar. Other: WhatsApp.',
  '',
  '=== SHIPPING ===',
  'Seffaf Kargo: "Seffaf paketleme ile gonderiyoruz, kurye kapınıza geldiginde urun icerigi disaridan gorunur sekilde teslim edilir."',
  'NEVER say musteri paketi acip kontrol edebilir. NEVER mention opening package.',
  'PTT: anlassmamiz yok, en yakin Aras subesi.',
  'Other: sadece Aras.',
  '',
  '=== COMMON ===',
  'Fabric: forma kumasi koku yapmaz. Name: evet. Shrink: cekmez. Logo: nakis sokulnez.',
  'Discount: kampanya fiyati.',
  'ADULT jerseys have NO shorts. Only forma. If asked: "Yetiskin formalarinda sort bulunmamaktadir, sadece forma olarak gonderim yapılıyor."',
  'Kids 12+: "12 yas ve uzeri cocuk formamiz mevcut, forma ve sort takim halinde geliyor."',
  'Kids <12: "Maalesef 12 yas altı su an mevcut degil."',
  'Kids socks (only if asked): "Maalesef cocuk formalarinda corap su an mevcut degil."',
  'Kids print (only if asked): "Evet, isim ve numara baskısı yapılıyor."',
  'Hesitant: "Yardimci olmami istediginiz bir konu varsa buradayim."',
  '',
  '=== ORDER STEPS ===',
  'S1: images+vitrin sent auto by system.',
  'S2: customer gives code -> translate to UPPERCASE NAME. Ask: "Beden olarak hangisini tercih edersiniz?"',
  'S3: size -> send form:',
  '"Siparisınizi Olusturmak Icin\n\nAd Soyad\nAdres (Il Ilce Mahalle)\nTelefon Numarasi\nBeden Bilgisi\n\nYeterli olacaktir, ardindan siparisınizi olusturmus olacagiz."',
  'S4: info received -> ask: "Kapida odemeyi nakit mi kart ile mi yapmak istersiniz?"',
  'S5: system handles card warning.',
  'CASH (ALL CAPS): [AD]\n\n[ADRES]\n\n[TEL]\n\n[URUN FULL NAME] [BEDEN]\n\nTOPLAM: X TL - KAPIDA NAKIT ODEME\n\nOnaylıyor musunuz?',
  'CARD (ALL CAPS after confirm): same + +50 TL POS CIHAZI HIZMET BEDELI.',
  '',
  '=== CLOSING (only evet/onayliyorum/olur) ===',
  '"Siparisınizi buyuk bir heyecan ve emekle hazırlayıp kargoya teslim edecegiz. Sizin icin ozenle hazırlanan bu paketi kargodan teslim almanız, emegimize verecegıniz en guzel karsilık olacaktır. Sevgi ve minnettarlıkla, saglıcakla kalın efendim."',
  'Output: ###SIPARIS_BASLA### {"ad_soyad":"","telefon":"","adres":"","urun":"","toplam":""} ###SIPARIS_BITIS###',
].join('\n');

// --- YARDIMCI FONKSİYONLAR ---

function getK(id) {
  if (!K[id]) K[id] = { hist: [], gorselGitti: false, kartGitti: false, sariUyariGitti: false, busy: false, queue: [], timer: null };
  return K[id];
}

function isimCevir(t) {
  Object.keys(ISIMLER).forEach(function(k) { t = t.replace(new RegExp(k, 'g'), ISIMLER[k]); });
  return t;
}

function kartVar(m) {
  return ['kart', 'kard', 'kartla', 'karta', 'kredi'].some(function(k) { return m.toLowerCase().indexOf(k) !== -1; });
}

function parseSiparis(t) {
  try {
    var m = t.match(/###SIPARIS_BASLA###([\s\S]*?)###SIPARIS_BITIS###/);
    if (m) return JSON.parse(m[1].trim());
  } catch (e) {}
  return null;
}

function wait(ms) { return new Promise(function(r) { setTimeout(r, ms); }); }

// --- API FONKSİYONLARI ---

async function tgGonder(s) {
  try {
    if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return;
    var u = isimCevir(s.urun.toUpperCase());
    await axios.post('https://api.telegram.org/bot' + TELEGRAM_BOT_TOKEN + '/sendMessage', {
      chat_id: TELEGRAM_CHAT_ID,
      text: 'YEN\u0130 S\u0130PAR\u0130\u015e!\n\nAD: ' + s.ad_soyad.toUpperCase() + '\nTEL: ' + s.telefon + '\nADRES: ' + s.adres.toUpperCase() + '\nURUN: ' + u + '\nTOPLAM: ' + s.toplam + ' TL',
    });
  } catch (e) { console.error('tg err:', e.message); }
}

async function igMsg(id, txt) {
  try {
    await axios.post('https://graph.instagram.com/v21.0/me/messages',
      { recipient: { id: id }, message: { text: txt } },
      { headers: { Authorization: 'Bearer ' + IG_ACCESS_TOKEN, 'Content-Type': 'application/json' } });
  } catch (e) { console.error('msg err:', e.message); }
}

async function igImg(id, url) {
  try {
    await axios.post('https://graph.instagram.com/v21.0/me/messages',
      { recipient: { id: id }, message: { attachment: { type: 'image', payload: { url: url, is_reusable: true } } } },
      { headers: { Authorization: 'Bearer ' + IG_ACCESS_TOKEN, 'Content-Type': 'application/json' } });
  } catch (e) { console.error('img err:', e.message); }
}

async function aiCall(hist) {
  try {
    var r = await axios.post('https://api.anthropic.com/v1/messages',
      { model: 'claude-haiku-4-5-20251001', max_tokens: 600, system: PROMPT, messages: hist },
      { headers: { 'x-api-key': CLAUDE_API_KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' } });
    return r.data.content[0].text;
  } catch (e) { return 'Su an teknik bir sorun var, birazdan tekrar yazabilirsiniz.'; }
}

// --- ANA PROCESS FONKSİYONU ---

async function process(id) {
  var u = getK(id);
  if (u.busy || u.queue.length === 0) return;
  u.busy = true;

  var msgs = u.queue.slice();
  u.queue = [];

  // Tekrar eden mesajları temizle
  var uniq = [];
  var prev = '';
  msgs.forEach(function(m) {
    var t = m.trim().toLowerCase();
    if (t !== prev) { uniq.push(m); prev = t; }
  });
  var combined = uniq.join(' ').trim();
  if (!combined) { u.busy = false; return; }

  var isFirst = u.hist.length === 0;

  // 1) GÖRSEL - sadece ilk mesajda, 1 kez
  if (isFirst && !u.gorselGitti) {
    u.gorselGitti = true;
    await igMsg(id, VITRIN);
    for (var i = 0; i < GORSELLER.length; i++) {
      await igImg(id, GORSELLER[i]);
      await wait(600);
    }
    await wait(500);
    await igMsg(id, KOD_MESAJI);
    u.hist.push({ role: 'user', content: combined });
    u.hist.push({ role: 'assistant', content: VITRIN });
    u.busy = false;
    if (u.queue.length > 0) await process(id);
    return;
  }

  // 2) KART UYARISI - sadece 1 kez
  if (kartVar(combined) && !u.kartGitti) {
    u.kartGitti = true;
    await igMsg(id, KART);
    u.hist.push({ role: 'user', content: combined });
    u.hist.push({ role: 'assistant', content: KART });
    u.busy = false;
    if (u.queue.length > 0) await process(id);
    return;
  }

  // 3) 0022 SARI FORMA STOK UYARISI - 22 Mayıs 2026 öncesi, sadece 1 kez
  var bugun = new Date();
  var sinir = new Date('2026-05-22T00:00:00');
  var sariKelimeler = ['0022', 'sari forma', 'sarı forma', 'retro sari', 'retro sarı'];
  var sariVar = sariKelimeler.some(function(k) { return combined.toLowerCase().indexOf(k) !== -1; });
  if (bugun < sinir && sariVar && !u.sariUyariGitti) {
    u.sariUyariGitti = true;
    var sariMesaj = 'Bu ayin 22\'sinde Cuma gunu stogümuza gelecek, onumuzdeki gunlerde Kurban Bayrami oldugu icin gonderimini bayramdan sonra saglayabilecegiz efendim. Dilerseniz sari forma yerine farkli bir model secebilirsiniz, ya da sectiginiz bir modelden iki adet gonderebiliriz. Bekleriz diyorsaniz ayin 22\'sinden sonra sizlere gonderimini saglariz.';
    await igMsg(id, sariMesaj);
    u.hist.push({ role: 'user', content: combined });
    u.hist.push({ role: 'assistant', content: sariMesaj });
    u.busy = false;
    if (u.queue.length > 0) await process(id);
    return;
  }

  // 4) NORMAL AI AKIŞI
  u.hist.push({ role: 'user', content: combined });
  if (u.hist.length > 20) u.hist = u.hist.slice(-20);

  var reply = await aiCall(u.hist);
  var clean = reply
    .replace(/###SIPARIS_BASLA###[\s\S]*?###SIPARIS_BITIS###/g, '')
    .replace(/###VITRIN_GOSTER###/g, '')
    .trim();

  u.hist.push({ role: 'assistant', content: clean });

  await igMsg(id, clean);

  // 5) SİPARİŞ ONAYLANDIYSA TELEGRAM + BAYRAM UYARISI
  var siparis = parseSiparis(reply);
  if (siparis && siparis.ad_soyad) {
    await tgGonder(siparis);
    var bayramBaslangic = new Date('2026-05-20T00:00:00');
    var bayramBitis = new Date('2026-05-29T23:59:59');
    if (bugun >= bayramBaslangic && bugun <= bayramBitis) {
      await wait(500);
      await igMsg(id, 'Efendim biliyorsunuz malum Kurban Bayrami yaklasıyor, bu durumlarda siparisıniz gecikebilir. Bunun nedeni kargo firmalarının tatil olmasından dolayı bu tarz gecikmeler yasanabilir ve elinize gec ulasabilir. Bu durum sizler icin bir sorun teskil ediyor mu?');
    }
  }

  u.busy = false;
  if (u.queue.length > 0) await process(id);
}

// --- WEBHOOK ENDPOINT'LERİ ---

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
    if (req.body.object !== 'instagram') return;
    for (var i = 0; i < req.body.entry.length; i++) {
      var msgs = req.body.entry[i].messaging || [];
      for (var j = 0; j < msgs.length; j++) {
        var ev = msgs[j];
        var sid = ev.sender && ev.sender.id;
        var txt = ev.message && ev.message.text;
        if (!sid || !txt) continue;
        if (ev.message && ev.message.is_echo) continue;

        // Aynı mesaj ID'si tekrar gelirse işleme (Instagram çift gönderebilir)
        var msgId = ev.message && ev.message.mid;
        if (msgId) {
          if (islenenMesajlar.has(msgId)) continue;
          islenenMesajlar.add(msgId);
          (function(mid) {
            setTimeout(function() { islenenMesajlar.delete(mid); }, 600000);
          })(msgId);
        }

        var u = getK(sid);
        var last = u.queue.length > 0 ? u.queue[u.queue.length - 1].trim().toLowerCase() : '';
        if (txt.trim().toLowerCase() === last) continue;

        u.queue.push(txt);

        if (u.timer) clearTimeout(u.timer);
        (function(id) {
          u.timer = setTimeout(async function() {
            u.timer = null;
            await process(id);
          }, 3000);
        })(sid);
      }
    }
  } catch (e) { console.error('webhook err:', e.message); }
});

var PORT = process.env.PORT || 3000;
app.listen(PORT, function() { console.log('Bot running on port ' + PORT); });
