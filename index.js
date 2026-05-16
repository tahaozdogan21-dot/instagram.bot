const express = require(‘express’);
const axios = require(‘axios’);
const app = express();

app.use(express.json());

const VERIFY_TOKEN = process.env.VERIFY_TOKEN || ‘formataha2024’;
const CLAUDE_API_KEY = process.env.CLAUDE_API_KEY;
const IG_ACCESS_TOKEN = process.env.IG_ACCESS_TOKEN;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

const konusmalar = {};

const FORMA_GORSELLERI = {
‘0021’: ‘https://res.cloudinary.com/dzfiyamng/image/upload/v1778891830/BJK_BEYAZ_RETRO_vybc1r.jpg’,
‘0022’: ‘https://res.cloudinary.com/dzfiyamng/image/upload/v1778891832/BJK_BEYAZ_RETRO_pumkjo.jpg’,
‘0023’: ‘https://res.cloudinary.com/dzfiyamng/image/upload/v1778891832/BJK_BEYAZ_RETRO_vtectc.jpg’,
‘0024’: ‘https://res.cloudinary.com/dzfiyamng/image/upload/v1778891833/BJK_BEYAZ_RETRO_iybbwa.jpg’,
‘0025’: ‘https://res.cloudinary.com/dzfiyamng/image/upload/v1778891832/BJK_BEYAZ_RETRO_oaxlkt.jpg’,
};

const TUM_GORSELLER = Object.values(FORMA_GORSELLERI);

const SISTEM_PROMPT = [
‘You are a sales representative for a jersey store. You chat with customers on Instagram DM.’,
‘Always read conversation history. ALWAYS respond in Turkish language.’,
‘’,
‘IDENTITY:’,
‘- You are a real human. Never reveal you are AI.’,
‘- NEVER invent a name. Never say Ben Ahmet or any name.’,
‘- NEVER mention the store or brand name.’,
‘’,
‘WRITING RULES:’,
‘- Always respond in Turkish with correct Turkish characters.’,
‘- Keep responses short. One or two sentences is enough.’,
‘- Use efendim max 1 time per response.’,
‘- NEVER use bullet points or numbered lists.’,
‘- NEVER use bold text.’,
‘’,
‘FORBIDDEN:’,
‘- Harika secim, Mukemmel, Sevincle, Mutluluk duyarim, Tesekkur ederiz’,
‘- Saying Hos geldiniz in the middle of conversation’,
‘- Repeating a question already asked’,
‘- Inventing information’,
‘’,
‘GREETING - Only on first message:’,
‘06:00-12:00 -> Gunaydın, nasil yardimci olabilirim?’,
‘12:00-18:00 -> Iyi gunler, nasil yardimci olabilirim?’,
‘18:00-06:00 -> Iyi aksamlar, nasil yardimci olabilirim?’,
‘If customer wrote before, skip greeting.’,
‘’,
‘PRODUCTS:’,
‘0021 or FB RETRO CUBUKLU -> FB Retro Cubuklu Formasi’,
‘0022 or FB RETRO SARI -> FB Retro Sari Formasi’,
‘0023 or FB GRI TASARIM -> FB Gri Tasarim Formasi’,
‘0024 or FB PALAMUT SARI -> FB Palamut Sari Formasi’,
‘0025 or FB PALAMUT LACIVERT -> FB Palamut Lacivert Formasi’,
‘’,
‘PRICES:’,
‘1 forma: 630 TL kargo dahil’,
‘2 forma: 1250 TL kargo dahil’,
‘3 forma: 1250 TL (3 al 2 ode, 1 forma hediye)’,
‘4 forma: 1750 TL kargo dahil’,
‘’,
‘SIZE GUIDE - ONLY look at weight, ignore height:’,
‘55-65 kg -> S’,
‘66-75 kg -> M’,
‘76-85 kg -> L’,
‘86-95 kg -> XL’,
‘96+ kg -> XXL’,
‘Example: customer says 161 90 -> 90 kg = XL beden tam olur.’,
‘If size already in history, do NOT ask again.’,
‘’,
‘IMAGE REPLY RULE:’,
‘If customer replies to image saying bunu istiyorum or similar, you cannot see image.’,
‘Say: Gorselin uzerindeki kodu yazar misiniz efendim? Kodunuzu iletmeniz siparisınizin dogru hazırlanması icin cok onemli.’,
‘’,
‘OTHER TEAMS (GS, BJK, Trabzon):’,
‘Bu sayfamızda Fenerbahce agırlıklı gidiyoruz. Diger takım modelleri icin 0536 630 3654 numaralı WhatsApp tan yazarsanız katalog iletebiliriz.’,
‘’,
‘SHIPPING:’,
‘Carrier: Aras Kargo from Tekirdag’,
‘Delivery: ships next day, arrives 2-3 business days’,
‘Seffaf Kargo: customer checks at door before paying. No tracking needed.’,
‘PTT: PTT Kargo ile anlassmamız yok maalesef. Aras Kargo ile gonderim saglıyoruz, sube uzak degilse oradan da teslim alabilirsiniz.’,
‘DHL/Yurtici/MNG: Anlassmamız Aras Kargo ile, su an sadece bu firma uzerinden gonderim yapabiliyoruz.’,
‘’,
‘COMMON ANSWERS (end each with: Yardimci olabilecegim baska konu varsa buradayim):’,
‘Isim baskisi: Evet, istediginiz isim ve numarayı yazıyoruz.’,
‘Payment: Kapida nakit veya kart var.’,
‘Fabric: Kaliteli forma kuması, koku yapmaz.’,
‘Shrinking: Cekmez, forma kuması.’,
‘Logo: Nakıs isleme, sokulnez.’,
‘Discount: Fiyatlarımız zaten kampanya fiyatı, daha asagı inemeyiz.’,
‘Return: Teslimattan sonra 2 gun icinde bildirirseniz iade veya degisim yapıyoruz.’,
‘Campaign: Stoklar sınırlı, uzun surmez.’,
‘Location: Tekirdag dan gonderim saglıyoruz.’,
‘Tight fit: Standart forma kalıbı, vucuda tam oturuyor.’,
‘’,
‘KIDS JERSEY:’,
‘12+ age available: 12 yas ve uzeri cocuk formamız mevcut.’,
‘Under 12: Maalesef 12 yas altı su an mevcut degil.’,
‘Name print on kids (only if asked): Evet, isim ve numara baskısı yapılıyor.’,
‘Do NOT mention name print unless asked.’,
‘’,
‘SHORT MESSAGE - if customer writes fiyat, var mi, ne kadar, bilgi, forma, katalog, modeller, ikili, 3lu, set:’,
‘###VITRIN_GOSTER###’,
‘’,
‘HESITANT CUSTOMER (dusunecegim, pahali, sonra):’,
‘Anlıyorum, kapıda odeme ve seffaf kargo var, urunu gorup oyle teslim alıyorsunuz. Acele etmenize gerek yok.’,
‘’,
‘SHOW CATALOG - if customer asks about price, models, catalog:’,
‘###VITRIN_GOSTER###’,
‘’,
‘ORDER STEPS:’,
‘1. Model question -> ###VITRIN_GOSTER###’,
‘2. Model picked -> Hangi bedeni hazırlayalım?’,
‘3. Size confirmed -> Ad-Soyad, telefon ve adresinizi alabilir miyim?’,
‘4. Info received -> write all plain without headers, end with: Toplam X TL kapida odeme. Onaylıyor musunuz?’,
‘’,
‘ORDER CLOSING - ONLY when customer says evet or onayliyorum:’,
‘Send this exact text: Siparisınizi buyuk bir heyecan ve emekle hazırlayıp kargoya teslim edecegiz. Sizin icin ozenle hazırlanan bu paketi kargodan teslim almanız, emegimize verecegıniz en guzel karsilık olacaktır. Sevgi ve minnettarlıkla, saglıcakla kalın efendim.’,
‘Then output: ###SIPARIS_BASLA### {“ad_soyad”: “”,“telefon”: “”,“adres”: “”,“urun”: “”,“toplam”: “”} ###SIPARIS_BITIS###’,
].join(’\n’);

const VITRIN_METNI = ‘Kargo Dahil 1 Adet 630 TL\n2 Adet Forma 1.250 TL\n\n3 Al 2 Ode Kampanyasinda 1.250 TL\n\nKapida Odeme Seffaf Kargo Ile Gonderim Sagliyoruz\nUrunu Gorup Oyle Teslim Aliyorsunuz’;

async function telegramaBildirimGonder(siparis) {
try {
if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return;
const mesaj = ’YENI SIPARIS!\n\nAd Soyad: ’ + siparis.ad_soyad + ’\nTelefon: ’ + siparis.telefon + ’\nUrun: ’ + siparis.urun + ’\nAdres: ’ + siparis.adres + ‘\nToplam: ’ + siparis.toplam + ’ TL - Kapida Odeme’;
await axios.post(‘https://api.telegram.org/bot’ + TELEGRAM_BOT_TOKEN + ‘/sendMessage’, {
chat_id: TELEGRAM_CHAT_ID,
text: mesaj,
});
} catch (err) {
console.error(‘Telegram error:’, err.message);
}
}

function siparisiParsEt(metin) {
try {
const match = metin.match(/###SIPARIS_BASLA###([\s\S]*?)###SIPARIS_BITIS###/);
if (match) return JSON.parse(match[1].trim());
} catch (err) {}
return null;
}

app.get(’/webhook’, function(req, res) {
const mode = req.query[‘hub.mode’];
const token = req.query[‘hub.verify_token’];
const challenge = req.query[‘hub.challenge’];
if (mode === ‘subscribe’ && token === VERIFY_TOKEN) {
res.status(200).send(challenge);
} else {
res.status(403).send(‘Error’);
}
});

app.post(’/webhook’, async function(req, res) {
res.status(200).send(‘OK’);
try {
const body = req.body;
if (body.object !== ‘instagram’) return;
for (let i = 0; i < body.entry.length; i++) {
const entry = body.entry[i];
const messaging = entry.messaging || [];
for (let j = 0; j < messaging.length; j++) {
const event = messaging[j];
const senderId = event.sender && event.sender.id;
const messageText = event.message && event.message.text;
if (!senderId || !messageText) continue;
if (event.message && event.message.is_echo) continue;

```
    if (!konusmalar[senderId]) konusmalar[senderId] = [];
    konusmalar[senderId].push({ role: 'user', content: messageText });
    if (konusmalar[senderId].length > 20) {
      konusmalar[senderId] = konusmalar[senderId].slice(-20);
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
      for (let k = 0; k < TUM_GORSELLER.length; k++) {
        await instagramaGorselGonder(senderId, TUM_GORSELLER[k]);
        await bekle(500);
      }
    } else {
      await instagramaMesajGonder(senderId, temizYanit);
    }
  }
}
```

} catch (err) {
console.error(‘Error:’, err.message);
}
});

async function claudeYanitAl(mesajlar) {
try {
const response = await axios.post(
‘https://api.anthropic.com/v1/messages’,
{
model: ‘claude-haiku-4-5-20251001’,
max_tokens: 500,
system: SISTEM_PROMPT,
messages: mesajlar,
},
{
headers: {
‘x-api-key’: CLAUDE_API_KEY,
‘anthropic-version’: ‘2023-06-01’,
‘Content-Type’: ‘application/json’,
},
}
);
return response.data.content[0].text;
} catch (err) {
console.error(‘Claude error:’, err.message);
return ‘Su an teknik bir sorun var, birazdan tekrar yazabilirsiniz.’;
}
}

async function instagramaMesajGonder(aliciId, mesaj) {
try {
await axios.post(
‘https://graph.instagram.com/v21.0/me/messages’,
{ recipient: { id: aliciId }, message: { text: mesaj } },
{ headers: { Authorization: ’Bearer ’ + IG_ACCESS_TOKEN, ‘Content-Type’: ‘application/json’ } }
);
} catch (err) {
console.error(‘Message error:’, err.message);
}
}

async function instagramaGorselGonder(aliciId, gorselUrl) {
try {
await axios.post(
‘https://graph.instagram.com/v21.0/me/messages’,
{
recipient: { id: aliciId },
message: { attachment: { type: ‘image’, payload: { url: gorselUrl, is_reusable: true } } },
},
{ headers: { Authorization: ’Bearer ’ + IG_ACCESS_TOKEN, ‘Content-Type’: ‘application/json’ } }
);
} catch (err) {
console.error(‘Image error:’, err.message);
}
}

function bekle(ms) {
return new Promise(function(resolve) { setTimeout(resolve, ms); });
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, function() { console.log(’Bot running on port ’ + PORT); });
