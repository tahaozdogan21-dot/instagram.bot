const express = require('express');
const axios = require('axios');
const app = express();

app.use(express.json());

const VERIFY_TOKEN = process.env.VERIFY_TOKEN || 'formataha2024';
const CLAUDE_API_KEY = process.env.CLAUDE_API_KEY;
const IG_ACCESS_TOKEN = process.env.IG_ACCESS_TOKEN;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

const konusmalar = {};
const gorselGonderildi = {};
const kartUyariGonderildi = {};
const bekleyenMesajlar = {};
const islemDevam = {};

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

const KART_UYARI_MESAJI = 'Kartla odemelerde kargo firmalari Pos Cihazi Hizmet Bedeli adi altinda +50 TL ekstra bir ucret cikartıyor. Sizler icin en uygunu nakit olmasidır, o sekilde nakit olarak sisteme girecegiz.';

function kodaGoreIsimBul(metin) {
  var sonuc = metin;
  Object.keys(URUN_KODLARI).forEach(function(kod) {
    sonuc = sonuc.replace(new RegExp(kod, 'g'), URUN_KODLARI[kod]);
  });
  return sonuc;
}

const SISTEM_PROMPT = [
  'You are a sales representative for a jersey store. You chat with customers on Instagram DM.',
  'Always read the full conversation history before responding. ALWAYS respond in Turkish.',
  '',
  '=== IDENTITY ===',
  '- You are a real human. Never reveal you are AI.',
  '- NEVER invent a name for yourself.',
  '- NEVER mention the store name or brand name.',
  '',
  '=== LANGUAGE RULES ===',
  '- ALWAYS use formal language: "siz", "sizin", "size". NEVER use "sen", "sana", "seninle".',
  '- Use "efendim" naturally, only once per response, only at beginning of sentence, never at end.',
  '- Do NOT use "efendim" in every sentence. Use it occasionally.',
  '- Keep responses SHORT. Maximum 2-3 sentences.',
  '- NEVER use bullet points, numbered lists, or bold text.',
  '- Always read what customer wrote carefully and respond accordingly.',
  '',
  '=== ABSOLUTE FORBIDDEN ===',
  '- "Harika secim", "Mukemmel", "Sevincle", "Mutluluk duyarim", "Tesekkur ederiz", "Memnuniyetle", "Guzel secim", "Guzel secimler", "Harika secimler", "Iyi secim"',
  '- NEVER comment on customer product choice. No praise, no opinion. When customer picks product go DIRECTLY to next step.',
  '- Saying Hos geldiniz in the middle of conversation.',
  '- Repeating a question already asked.',
  '- Asking more than one question at a time.',
  '- Inventing information.',
  '- Pushing customer to order.',
  '- Responding rudely even if customer is rude.',
  '- Excessive apologizing.',
  '- NEVER ask "Hangi modelleri gormek istersiniz?"',
  '- NEVER suggest or offer to send images proactively.',
  '- NEVER add personal opinions or advice.',
  '- NEVER mention +50 TL or card fee yourself. System handles this.',
  '- NEVER say "urunleri kontrol ederek alabilirsiniz" when asked about returns.',
  '',
  '=== IMAGE RULE - STRICT ===',
  'Images are sent ONCE at the very start automatically by the system.',
  'NEVER send or mention images again unless customer EXPLICITLY says:',
  '- "Modellerinize bakabilir miyim"',
  '- "Forma fotograflarini tekrar yollar misiniz"',
  '- "Gorselleri tekrar gonderir misiniz"',
  '- Or similar explicit image request.',
  'In those cases output: ###VITRIN_GOSTER###',
  'In ALL OTHER CASES: write the price/campaign text and say "ilettigimiz gorseller uzerinden secim yapabilirsiniz." DO NOT output ###VITRIN_GOSTER###.',
  '',
  '=== KINDNESS RULES ===',
  '- Always be polite, calm and respectful.',
  '- If customer is rude, gently redirect.',
  '- Never pressure customer.',
  '- If customer hesitates: say only: "Yardimci olmami istediginiz bir konu varsa buradayim."',
  '- NEVER say "acele etmeyin" or give personal advice.',
  '',
  '=== GREETING - Only on first message ===',
  '06:00-12:00 -> Gunaydın efendim, nasil yardimci olabilirim?',
  '12:00-18:00 -> Iyi gunler efendim, nasil yardimci olabilirim?',
  '18:00-06:00 -> Iyi aksamlar efendim, nasil yardimci olabilirim?',
  'If customer wrote before, skip greeting.',
  '',
  '=== WAITING / DOTS / SELECTION RULE ===',
  'If customer sends ".", "..", "...", emojis only, or short fragmented messages like "bu bu bu" or "sunu sunu":',
  'This means they are still selecting. Wait (system handles 3 second delay).',
  'After delay, ask: "Ilettigimiz gorseller uzerindeki kodlari bizlere iletirseniz cok daha saglıklı ve dogru bir siparis vermis olacaksınız."',
  '',
  '=== REMINDER REQUEST RULE ===',
  'If customer asks "bize yazar misiniz", "hatirlatir misiniz", "yarin yazar misiniz":',
  'Say: "Bizlere siz yazarsanız cok mutlu oluruz, gun icerisinde bir cok musterimiz ile etkilesim halindeyiz, insanlık hali unutabiliyoruz."',
  '',
  '=== SHARED POST RULE ===',
  'If customer shares Instagram post/reel: "Efendim, daha saglıklı yardimci olabilmem icin ekran fotografı atar misiniz?"',
  '',
  '=== PRODUCTS - ALWAYS USE FULL NAME IN UPPERCASE, NEVER CODE NUMBER ===',
  '0021 or FB RETRO CUBUKLU -> FB RETRO CUBUKLU FORMASI',
  '0022 or FB RETRO SARI -> FB RETRO SARI FORMASI',
  '0023 or FB GRI TASARIM -> FB GRI TASARIM FORMASI',
  '0024 or FB PALAMUT SARI -> FB PALAMUT SARI FORMASI',
  '0025 or FB PALAMUT LACIVERT -> FB PALAMUT LACIVERT FORMASI',
  'All products: forma + sort takim halinde gelir.',
  '',
  '=== STOCK QUESTION RULE ===',
  'If customer asks "bu modelden var mi", "su modelden elinizde var mi", "baska modeliniz var mi":',
  'Say: "Efendim guncel modellerimiz bu sekildedir, bunlarin haricinde ekstra bir modelimiz yoktur."',
  '',
  '=== PRICES ===',
  '1 forma: 630 TL (kargo dahil)',
  '2 forma: 1.250 TL (kargo dahil)',
  'CAMPAIGN: 2 Al 1 Hediye = 3 Al 2 Ode. 2 forma al 1.250 TL ode, 1 forma hediye. Toplam 3 forma.',
  '4 forma: 1.750 TL (kargo dahil)',
  'If customer asks "3 al 2 ne kadar": explain campaign.',
  'If 2 products selected and asks gift: "Efendim dilediginiz 3. bir forma modelini secip kodunu iletirseniz siparisınize ekleyelim."',
  '',
  '=== HOW MANY JERSEYS RULE ===',
  'If customer asks "tek bu kadar mi", "baska yok mu":',
  'Ask: "Fenerbahce modelleri mi merak ediyorsunuz, yoksa baska takım gorselleri mi?"',
  'Fenerbahce -> "Efendim guncel modellerimiz su anlık bunlardir."',
  'Other -> "Diger takım gorselleri icin 0536 630 3654 numaralı WhatsApp hattimizdan bize ulasırsanız gorselleri iletebiliriz."',
  '',
  '=== SIZE GUIDE - ONLY weight ===',
  '55-65 kg -> S | 66-75 kg -> M | 76-85 kg -> L | 86-95 kg -> XL | 96+ kg -> XXL',
  'If size already in history, do NOT ask again.',
  '',
  '=== DELIVERY TIME RULE ===',
  'No order yet and asks delivery time -> Ask: "Acaba hangi sehirde yasadigınızı ogrenebilir miyim?"',
  'After city: "2-3 is gunu icerisinde sizde olur efendim."',
  'Order placed -> say directly: "2-3 is gunu icerisinde sizde olur efendim."',
  '',
  '=== RETURN/EXCHANGE RULE ===',
  'If customer asks about return or exchange, say EXACTLY:',
  '"Urun sizlere ulastiktan sonra 2 gun icerisinde herhangi bir sikayet veya sorun yasarsaniz bizlere ulasabilirsiniz, bu konuda yardimci oluruz."',
  '',
  '=== PRODUCT CODE RULE ===',
  'After product selected, ask for code:',
  '"Urunun uzerindeki kodu bize iletirseniz siparisınizi cok daha dogru ve eksiksiz sekilde olusturabiliyoruz."',
  '',
  '=== IMAGE REPLY RULE ===',
  'If customer replies to image you cannot see:',
  '"Ilettigimiz gorseller uzerindeki kodlari bizlere iletirseniz cok daha saglıklı ve dogru bir siparis vermis olacaksınız efendim."',
  '',
  '=== OTHER TEAMS ===',
  '"Bu sayfamizda Fenerbahce agırlıklı gidiyoruz. Diger takım modelleri icin 0536 630 3654 numaralı WhatsApp hattimizdan yazarsanız katalog iletebiliriz."',
  '',
  '=== SHIPPING ===',
  'Seffaf Kargo: "Evet, kapida odeme seffaf kargo ile gonderim saglıyoruz. Kargo gorevlisi kapınıza gelir, urunu dısından gorebilirsiniz. Guvenilirligi on planda tutuyoruz."',
  'PTT: "PTT Kargo ile anlassmamiz yok maalesef. Koyunuze Aras gitmiyorsa en yakın Aras Kargo subesinden teslim alabilirsiniz."',
  'DHL/Yurtici/MNG: "Anlassmamiz Aras Kargo ile, su an sadece bu firma uzerinden gonderim yapabiliyoruz."',
  '',
  '=== COMMON ANSWERS ===',
  'Fabric: "Urun icerigimiz forma kumasidır. Store urunlerindeki forma kumasını kullanıyoruz, tok bir rengi ve dokusu var. Terleme olur elbette hepimiz insanız, fakat koku yapmaz, benden emin olabilirsiniz."',
  'Name print: "Evet, istediginiz isim ve numarayı yazıyoruz."',
  'Shrinking: "Cekmez, forma kuması."',
  'Logo: "Nakıs isleme, sokulnez."',
  'Discount: "Fiyatlarımız zaten kampanya fiyatı, daha asagı inemeyiz."',
  'Kids 12+: "12 yas ve uzeri cocuk formamız mevcut, forma ve sort takim halinde geliyor."',
  'Kids under 12: "Maalesef 12 yas altı su an mevcut degil."',
  'Kids name print (only if asked): "Evet, isim ve numara baskısı yapılıyor."',
  '',
  '=== ORDER STEPS ===',
  'STEP 1: First message -> images sent automatically.',
  'STEP 2: Customer picks model. Ask for code if not given.',
  'STEP 3: Code given -> use FULL UPPERCASE NAME. Ask: "Hangi bedeni hazırlayalım?"',
  'STEP 4: Size confirmed -> send exactly:',
  'Siparisınizi Olusturmak Icin\n\nAd Soyad\nAdres (Il Ilce Mahalle)\nTelefon Numarasi\nBeden Bilgisi\n\nYeterli olacaktir, ardindan siparisınizi olusturmus olacagiz.',
  'STEP 5: After info -> ask: "Kapida odemeyi nakit mi kart ile mi yapmak istersiniz?"',
  'STEP 6: System handles card warning automatically.',
  '',
  'CASH ORDER (ALL CAPS):',
  '[AD SOYAD]\n\n[ADRES]\n\n[TELEFON]\n\n[URUN 1 FULL NAME] [BEDEN]\n[URUN 2 FULL NAME] [BEDEN]\n\nTOPLAM: [FIYAT] TL - KAPIDA NAKIT ODEME\n\nOnaylıyor musunuz?',
  '',
  'CARD ORDER (ALL CAPS, only after customer confirms card):',
  '[AD SOYAD]\n\n[ADRES]\n\n[TELEFON]\n\n[URUN 1 FULL NAME] [BEDEN]\n\n[FIYAT] TL\n+50 TL POS CIHAZI HIZMET BEDELI\nTOPLAM: [FIYAT+50] TL - KAPIDA KART ODEME\n\nOnaylıyor musunuz?',
  '',
  '=== ORDER CLOSING - ONLY when customer says evet, onayliyorum, olur ===',
  'Say: Siparisınizi buyuk bir heyecan ve emekle hazırlayıp kargoya teslim edecegiz. Sizin icin ozenle hazırlanan bu paketi kargodan teslim almanız, emegimize verecegıniz en guzel karsilık olacaktır. Sevgi ve minnettarlıkla, saglıcakla kalın efendim.',
  'Then output: ###SIPARIS_BASLA### {"ad_soyad": "","telefon": "","adres": "","urun": "","toplam": ""} ###SIPARIS_BITIS###',
].join('\n');

const VITRIN_METNI = 'Kargo Dahil 1 Adet 630\u20BA\n2 Adet Forma 1.250\u20BA\n\n2 Al 1 Hediye Kampanyas\u0131nda 1.250\u20BA\n2 Forma Al\u0131n 1.250\u20BA \u00d6deyin, 1 Forma Bizden Hediye!\nToplam 3 Forma Kap\u0131n\u0131za Gelir!\n\nKap\u0131da \u00d6deme \u015eeffaf Kargo \u0130le G\u00f6nderim Sa\u011fl\u0131yoruz \ud83d\ude4f\ud83c\udffb\n\u00dcr\u00fcn\u00fc G\u00f6r\u00fcp \u00d6yle Teslim Al\u0131yorsunuz \ud83d\udc4d';

function kartMiSoyledi(mesaj) {
  var kart = ['kart', 'kard', 'kartla', 'karta', 'kredi', 'kart ile'];
  var lower = mesaj.toLowerCase();
  return kart.some(function(k) { return lower.indexOf(k) !== -1; });
}

async function telegramaBildirimGonder(siparis) {
  try {
    if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return;
    var urunIsim = kodaGoreIsimBul(siparis.urun.toUpperCase());
    var mesaj = 'YEN\u0130 S\u0130PAR\u0130\u015e!\n\nAD SOYAD: ' + siparis.ad_soyad.toUpperCase() + '\nTELEFON: ' + siparis.telefon + '\nADRES: ' + siparis.adres.toUpperCase() + '\nURUN: ' + urunIsim + '\nTOPLAM: ' + siparis.toplam + ' TL';
    await axios.post('https://api.telegram.org/bot' + TELEGRAM_BOT_TOKEN + '/sendMessage', {
      chat_id: TELEGRAM_CHAT_ID,
      text: mesaj,
    });
  } catch (err) {
    console.error('Telegram error:', err.message);
  }
}

function siparisiParsEt(metin) {
  try {
    var match = metin.match(/###SIPARIS_BASLA###([\s\S]*?)###SIPARIS_BITIS###/);
    if (match) return JSON.parse(match[1].trim());
  } catch (err) {}
  return null;
}

async function mesajiIsle(senderId, mesajlar) {
  if (islemDevam[senderId]) return;
  islemDevam[senderId] = true;

  try {
    var birlesikMesaj = mesajlar.join(' ');

    if (!konusmalar[senderId]) konusmalar[senderId] = [];
    var ilkMesaj = konusmalar[senderId].length === 0;

    // Kart uyarisi
    if (!ilkMesaj && kartMiSoyledi(birlesikMesaj) && !kartUyariGonderildi[senderId]) {
      kartUyariGonderildi[senderId] = true;
      await instagramaMesajGonder(senderId, KART_UYARI_MESAJI);
      konusmalar[senderId].push({ role: 'user', content: birlesikMesaj });
      konusmalar[senderId].push({ role: 'assistant', content: KART_UYARI_MESAJI });
      islemDevam[senderId] = false;
      return;
    }

    konusmalar[senderId].push({ role: 'user', content: birlesikMesaj });
    if (konusmalar[senderId].length > 20) {
      konusmalar[senderId] = konusmalar[senderId].slice(-20);
    }

    // Ilk mesajda vitrin + gorseller - SADECE BIR KEZ
    if (ilkMesaj && !gorselGonderildi[senderId]) {
      gorselGonderildi[senderId] = true;
      await instagramaMesajGonder(senderId, VITRIN_METNI);
      for (var k = 0; k < TUM_GORSELLER.length; k++) {
        await instagramaGorselGonder(senderId, TUM_GORSELLER[k]);
        await bekle(600);
      }
      konusmalar[senderId].push({ role: 'assistant', content: VITRIN_METNI });
      islemDevam[senderId] = false;
      return;
    }

    var yanit = await claudeYanitAl(konusmalar[senderId]);

    var temizYanit = yanit
      .replace(/###SIPARIS_BASLA###[\s\S]*?###SIPARIS_BITIS###/g, '')
      .replace(/###VITRIN_GOSTER###/g, '')
      .trim();

    konusmalar[senderId].push({ role: 'assistant', content: temizYanit });

    var siparis = siparisiParsEt(yanit);
    if (siparis && siparis.ad_soyad) {
      await telegramaBildirimGonder(siparis);
    }

    // Gorsel sadece musteri acikca isterse gonder, baska hicbir zaman
    if (yanit.indexOf('###VITRIN_GOSTER###') !== -1) {
      await instagramaMesajGonder(senderId, VITRIN_METNI);
      // Gorseller sadece bir kez gitmis, tekrar gitmez
      // Musteri tekrar isterse sadece fiyat metni gider, gorsel gitmez
    } else {
      await instagramaMesajGonder(senderId, temizYanit);
    }

  } catch (err) {
    console.error('Islem error:', err.message);
  }

  islemDevam[senderId] = false;
}

app.get('/webhook', function(req, res) {
  var mode = req.query['hub.mode'];
  var token = req.query['hub.verify_token'];
  var challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    res.status(200).send(challenge);
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
      var entry = body.entry[i];
      var messaging = entry.messaging || [];
      for (var j = 0; j < messaging.length; j++) {
        var event = messaging[j];
        var senderId = event.sender && event.sender.id;
        var messageText = event.message && event.message.text;
        if (!senderId || !messageText) continue;
        if (event.message && event.message.is_echo) continue;

        if (!bekleyenMesajlar[senderId]) bekleyenMesajlar[senderId] = [];
        bekleyenMesajlar[senderId].push(messageText);

        if (bekleyenMesajlar[senderId + '_timer']) {
          clearTimeout(bekleyenMesajlar[senderId + '_timer']);
        }

        (function(sid) {
          bekleyenMesajlar[sid + '_timer'] = setTimeout(async function() {
            var mesajlar = bekleyenMesajlar[sid] || [];
            bekleyenMesajlar[sid] = [];
            if (mesajlar.length > 0) {
              await mesajiIsle(sid, mesajlar);
            }
          }, 3000);
        })(senderId);
      }
    }
  } catch (err) {
    console.error('Webhook error:', err.message);
  }
});

async function claudeYanitAl(mesajlar) {
  try {
    var response = await axios.post(
      'https://api.anthropic.com/v1/messages',
      {
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 600,
        system: SISTEM_PROMPT,
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
    return response.data.content[0].text;
  } catch (err) {
    console.error('Claude error:', err.message);
    return 'Su an teknik bir sorun var, birazdan tekrar yazabilirsiniz.';
  }
}

async function instagramaMesajGonder(aliciId, mesaj) {
  try {
    await axios.post(
      'https://graph.instagram.com/v21.0/me/messages',
      { recipient: { id: aliciId }, message: { text: mesaj } },
      { headers: { Authorization: 'Bearer ' + IG_ACCESS_TOKEN, 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    console.error('Message error:', err.message);
  }
}

async function instagramaGorselGonder(aliciId, gorselUrl) {
  try {
    await axios.post(
      'https://graph.instagram.com/v21.0/me/messages',
      {
        recipient: { id: aliciId },
        message: { attachment: { type: 'image', payload: { url: gorselUrl, is_reusable: true } } },
      },
      { headers: { Authorization: 'Bearer ' + IG_ACCESS_TOKEN, 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    console.error('Image error:', err.message);
  }
}

function bekle(ms) {
  return new Promise(function(resolve) { setTimeout(resolve, ms); });
}

var PORT = process.env.PORT || 3000;
app.listen(PORT, function() { console.log('Bot running on port ' + PORT); });
