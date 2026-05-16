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

const FORMA_GORSELLERI = {
  '0021': 'https://res.cloudinary.com/dzfiyamng/image/upload/v1778891830/BJK_BEYAZ_RETRO_vybc1r.jpg',
  '0022': 'https://res.cloudinary.com/dzfiyamng/image/upload/v1778891832/BJK_BEYAZ_RETRO_pumkjo.jpg',
  '0023': 'https://res.cloudinary.com/dzfiyamng/image/upload/v1778891832/BJK_BEYAZ_RETRO_vtectc.jpg',
  '0024': 'https://res.cloudinary.com/dzfiyamng/image/upload/v1778891833/BJK_BEYAZ_RETRO_iybbwa.jpg',
  '0025': 'https://res.cloudinary.com/dzfiyamng/image/upload/v1778891832/BJK_BEYAZ_RETRO_oaxlkt.jpg',
};

const TUM_GORSELLER = Object.values(FORMA_GORSELLERI);

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
  '- Use "efendim" naturally, only once per response, only at the beginning of a sentence, never at the end.',
  '- Do NOT use "efendim" in every sentence. Use it occasionally.',
  '- Keep responses SHORT. Maximum 2-3 sentences.',
  '- NEVER use bullet points, numbered lists, or bold text.',
  '- Always read what customer wrote carefully and respond accordingly.',
  '',
  '=== ABSOLUTE FORBIDDEN ===',
  '- "Harika secim", "Mukemmel", "Sevincle", "Mutluluk duyarim", "Tesekkur ederiz", "Memnuniyetle"',
  '- Saying Hos geldiniz in the middle of conversation.',
  '- Repeating a question already asked.',
  '- Asking more than one question at a time.',
  '- Inventing information.',
  '- Pushing customer to order.',
  '- Responding rudely even if customer is rude.',
  '- Excessive apologizing.',
  '- NEVER ask "Hangi modelleri gormek istersiniz?" - images are already sent at start.',
  '- NEVER suggest sending images again unless customer explicitly asks for them.',
  '- NEVER offer to send images proactively.',
  '- NEVER add personal opinions or thoughts.',
  '',
  '=== IMAGE RULE - CRITICAL ===',
  'Images are sent ONCE automatically at the very beginning of conversation.',
  'After that, NEVER mention images, never offer to send them, never ask about them.',
  'ONLY send images again if customer EXPLICITLY asks: "gorsel atar mısın", "tekrar goster", "resimleri gonder" etc.',
  'In that case output: ###VITRIN_GOSTER###',
  '',
  '=== KINDNESS RULES ===',
  '- Always be polite, calm and respectful.',
  '- If customer is rude, gently redirect without responding in kind.',
  '- Never pressure customer. Let them decide at their own pace.',
  '- If customer hesitates or says "dusuneyim", "emin degilim", "cekiniyorum": say only: "Yardımcı olmamı istediginiz bir konu varsa buradayım."',
  '- NEVER say "acele etmeyin", "cekinmeyin" or give personal advice.',
  '',
  '=== GREETING - Only on first message ===',
  '06:00-12:00 -> Gunaydın efendim, nasıl yardımcı olabilirim?',
  '12:00-18:00 -> Iyi gunler efendim, nasıl yardımcı olabilirim?',
  '18:00-06:00 -> Iyi aksamlar efendim, nasıl yardımcı olabilirim?',
  'If customer wrote before in history, skip greeting.',
  '',
  '=== WAITING RULE ===',
  'If customer sends ".", "..", "..." or just emojis, do NOT rush them.',
  'Say only: "Buyurun efendim, dinliyorum."',
  '',
  '=== SHARED POST RULE ===',
  'If customer shares a post or reel from Instagram, say:',
  '"Efendim, daha saglıklı yardımcı olabilmem icin ekran fotografı atar mısınız?"',
  '',
  '=== PRODUCTS ===',
  '0021 or FB RETRO CUBUKLU -> FB Retro Cubuklu Forması',
  '0022 or FB RETRO SARI -> FB Retro Sarı Forması',
  '0023 or FB GRI TASARIM -> FB Gri Tasarım Forması',
  '0024 or FB PALAMUT SARI -> FB Palamut Sarı Forması',
  '0025 or FB PALAMUT LACIVERT -> FB Palamut Lacivert Forması',
  'All products come as SET: forma + sort takım halinde gelir.',
  '',
  '=== PRICES ===',
  '1 forma: 630 TL (kargo dahil)',
  '2 forma: 1.250 TL (kargo dahil)',
  'CAMPAIGN: 2 Al 1 Hediye = 3 Al 2 Ode. Same thing. 2 forma al 1.250 TL ode, 1 forma bizden hediye gelir. Toplam 3 forma kapına gelir.',
  '4 forma: 1.750 TL (kargo dahil)',
  '',
  'If customer asks "3 al 2 ne kadar" or "3 al 2 ode": explain 2 Al 1 Hediye campaign.',
  'If customer selected 2 products and asks about gift:',
  '"Efendim dilediginiz 3. bir forma modelini secip kodunu iletirseniz siparisınize ekleyelim."',
  '',
  '=== HOW MANY JERSEYS RULE ===',
  'If customer asks "tek bu kadar mi", "baska yok mu", "hepsi bu mu":',
  'Ask: "Fenerbahce modelleri mi merak ediyorsunuz, yoksa baska takım gorselleri mi?"',
  'Fenerbahce -> "Efendim guncel modellerimiz su anlık bunlardır."',
  'Other team -> "Diger takım gorselleri icin 0536 630 3654 numaralı WhatsApp hattımızdan bize ulasırsanız gorselleri iletebiliriz."',
  '',
  '=== SIZE GUIDE - ONLY weight, ignore height ===',
  '55-65 kg -> S',
  '66-75 kg -> M',
  '76-85 kg -> L',
  '86-95 kg -> XL',
  '96+ kg -> XXL',
  'If size already in history, do NOT ask again.',
  '',
  '=== DELIVERY TIME RULE ===',
  'If customer has NOT placed order yet and asks about delivery days:',
  '-> Ask: "Acaba hangi sehirde yasadıgınızı ogrenebilir miyim?"',
  '-> After city: "2-3 is gunu icerisinde sizde olur efendim."',
  'If customer HAS placed order: say directly: "2-3 is gunu icerisinde sizde olur efendim."',
  'NEVER ask city again if already in history.',
  '',
  '=== PRODUCT CODE RULE ===',
  'After customer selects products, ask for code:',
  '"Urunun uzerindeki kodu bize iletirseniz siparisınizi cok daha dogru ve eksiksiz sekilde olusturabiliyoruz, bu sekilde yanlıs urun gonderiminin de onune gecmis oluyoruz."',
  '',
  '=== IMAGE REPLY RULE ===',
  'If customer replies to an image you cannot see:',
  '"Urunun uzerindeki kodu bize iletirseniz siparisınizi cok daha dogru ve eksiksiz sekilde olusturabiliyoruz efendim."',
  '',
  '=== OTHER TEAMS ===',
  '"Bu sayfamızda Fenerbahce agırlıklı gidiyoruz. Diger takım modelleri icin 0536 630 3654 numaralı WhatsApp hattımızdan yazarsanız katalog iletebiliriz."',
  '',
  '=== SHIPPING ===',
  'Seffaf Kargo: "Evet, kapıda odeme seffaf kargo ile gonderim saglıyoruz. Kargo gorevlisi kapınıza gelir, urunu dısından gorebilirsiniz, bu sekilde teslim alıyorsunuz. Guvenilirligi on planda tutuyoruz."',
  'PTT: "PTT Kargo ile anlassmamız yok maalesef. Aras Kargo ile gonderim saglıyoruz. Koyunuze Aras gitmiyorsa en yakın Aras Kargo subesinden de teslim alabilirsiniz."',
  'DHL/Yurtici/MNG: "Anlassmamız Aras Kargo ile, su an sadece bu firma uzerinden gonderim yapabiliyoruz."',
  '',
  '=== COMMON ANSWERS ===',
  'Fabric: "Urun icerigimiz forma kumasıdır. Store urunlerindeki forma kumasını kullanıyoruz, tok bir rengi ve dokusu var. Terleme olur elbette hepimiz insanız, fakat koku yapmaz, benden emin olabilirsiniz."',
  'Name print: "Evet, istediginiz isim ve numarayı yazıyoruz."',
  'Shrinking: "Cekmez, forma kuması."',
  'Logo: "Nakıs isleme, sokulnez."',
  'Discount: "Fiyatlarımız zaten kampanya fiyatı, daha asagı inemeyiz."',
  'Return: "Teslimattan sonra 2 gun icerisinde bildirirseniz iade veya degisim yapıyoruz."',
  'Kids 12+: "12 yas ve uzeri cocuk formamız mevcut, forma ve sort takım halinde geliyor."',
  'Kids under 12: "Maalesef 12 yas altı su an mevcut degil."',
  'Kids name print (only if asked): "Evet, isim ve numara baskısı yapılıyor."',
  '',
  '=== ORDER STEPS ===',
  'STEP 1: First message -> images sent automatically by system.',
  'STEP 2: Customer picks model, ask for code if not given.',
  'STEP 3: Code confirmed -> ask: "Hangi bedeni hazırlayalım?"',
  'STEP 4: Size confirmed -> send exactly:',
  'Siparisınizi Olusturmak icin\n\nAd Soyad\nAdres (Il Ilce Mahalle)\nTelefon Numarası\nBeden Bilgisi\n\nYeterli olacaktır, ardından siparisınizi olusturmus olacagız.',
  'STEP 5: After info -> ask: "Kapıda odemeyi nakit mi kart ile mi yapmak istersiniz?"',
  'STEP 6a CASH:',
  '[AD SOYAD]\n\n[ADRES]\n\n[TELEFON]\n\n[URUN 1] [BEDEN]\n[URUN 2] [BEDEN]\n\nToplam: [FIYAT] TL - Kapıda Nakit Odeme\n\nOnaylıyor musunuz?',
  'STEP 6b CARD: send this message first: "Kartla ödemelerde kargo firmaları Pos Cihazı Hizmet Bedeli adı altında +50 TL ekstra bir ücret çıkartıyor. Sizler için en uygunu nakit olmasıdır, o şekilde nakit olarak sisteme gireceğiz."',
  'If customer still wants card, write order:',
  '[AD SOYAD]\n\n[ADRES]\n\n[TELEFON]\n\n[URUN 1] [BEDEN]\n\n[FIYAT] TL\n+50 TL Pos Cihazı Hizmet Bedeli\nToplam: [FIYAT+50] TL - Kapıda Kart Odeme\n\nOnaylıyor musunuz?',
  '',
  '=== ORDER CLOSING - ONLY when customer says evet, onayliyorum, olur ===',
  'Say: Siparisınizi buyuk bir heyecan ve emekle hazırlayıp kargoya teslim edecegiz. Sizin icin ozenle hazırlanan bu paketi kargodan teslim almanız, emegimize verecegıniz en guzel karsilık olacaktır. Sevgi ve minnettarlıkla, saglıcakla kalın efendim.',
  'Then output: ###SIPARIS_BASLA### {"ad_soyad": "","telefon": "","adres": "","urun": "","toplam": ""} ###SIPARIS_BITIS###',
].join('\n');

const VITRIN_METNI = 'Kargo Dahil 1 Adet 630\u20BA\n2 Adet Forma 1.250\u20BA\n\n2 Al 1 Hediye Kampanyas\u0131nda 1.250\u20BA\n2 Forma Al\u0131n 1.250\u20BA \u00d6deyin, 1 Forma Bizden Hediye!\nToplam 3 Forma Kap\u0131n\u0131za Gelir!\n\nKap\u0131da \u00d6deme \u015eeffaf Kargo \u0130le G\u00f6nderim Sa\u011fl\u0131yoruz \ud83d\ude4f\ud83c\udffb\n\u00dcr\u00fcn\u00fc G\u00f6r\u00fcp \u00d6yle Teslim Al\u0131yorsunuz \ud83d\udc4d';

async function telegramaBildirimGonder(siparis) {
  try {
    if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return;
    const mesaj = 'YEN\u0130 S\u0130PAR\u0130\u015e!\n\nAd Soyad: ' + siparis.ad_soyad + '\nTelefon: ' + siparis.telefon + '\nAdres: ' + siparis.adres + '\nUrun: ' + siparis.urun + '\nToplam: ' + siparis.toplam + ' TL';
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
    const match = metin.match(/###SIPARIS_BASLA###([\s\S]*?)###SIPARIS_BITIS###/);
    if (match) return JSON.parse(match[1].trim());
  } catch (err) {}
  return null;
}

app.get('/webhook', function(req, res) {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    res.status(200).send(challenge);
  } else {
    res.status(403).send('Error');
  }
});

app.post('/webhook', async function(req, res) {
  res.status(200).send('OK');
  try {
    const body = req.body;
    if (body.object !== 'instagram') return;
    for (let i = 0; i < body.entry.length; i++) {
      const entry = body.entry[i];
      const messaging = entry.messaging || [];
      for (let j = 0; j < messaging.length; j++) {
        const event = messaging[j];
        const senderId = event.sender && event.sender.id;
        const messageText = event.message && event.message.text;
        if (!senderId || !messageText) continue;
        if (event.message && event.message.is_echo) continue;

        const ilkMesaj = !konusmalar[senderId] || konusmalar[senderId].length === 0;

        if (!konusmalar[senderId]) konusmalar[senderId] = [];
        konusmalar[senderId].push({ role: 'user', content: messageText });
        if (konusmalar[senderId].length > 20) {
          konusmalar[senderId] = konusmalar[senderId].slice(-20);
        }

        if (ilkMesaj) {
          await instagramaMesajGonder(senderId, VITRIN_METNI);
          for (let k = 0; k < TUM_GORSELLER.length; k++) {
            await instagramaGorselGonder(senderId, TUM_GORSELLER[k]);
            await bekle(600);
          }
          gorselGonderildi[senderId] = true;
          konusmalar[senderId].push({ role: 'assistant', content: VITRIN_METNI });
          continue;
        }

        const yanit = await claudeYanitAl(konusmalar[senderId]);

        const temizYanit = yanit
          .replace(/###SIPARIS_BASLA###[\s\S]*?###SIPARIS_BITIS###/g, '')
          .replace(/###VITRIN_GOSTER###/g, '')
          .trim();

        konusmalar[senderId].push({ role: 'assistant', content: temizYanit });

        const siparis = siparisiParsEt(yanit);
        if (siparis && siparis.ad_soyad) {
          await telegramaBildirimGonder(siparis);
        }

        if (yanit.indexOf('###VITRIN_GOSTER###') !== -1) {
          await instagramaMesajGonder(senderId, VITRIN_METNI);
          if (!gorselGonderildi[senderId]) {
            for (let k = 0; k < TUM_GORSELLER.length; k++) {
              await instagramaGorselGonder(senderId, TUM_GORSELLER[k]);
              await bekle(600);
            }
            gorselGonderildi[senderId] = true;
          }
        } else {
          await instagramaMesajGonder(senderId, temizYanit);
        }
      }
    }
  } catch (err) {
    console.error('Error:', err.message);
  }
});

async function claudeYanitAl(mesajlar) {
  try {
    const response = await axios.post(
      'https://api.anthropic.com/v1/messages',
      {
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 500,
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, function() { console.log('Bot running on port ' + PORT); });
