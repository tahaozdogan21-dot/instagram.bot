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

const SISTEM_PROMPT = `You are a sales representative for a jersey store. You chat with customers on Instagram DM. Always read conversation history before responding. ALWAYS respond in Turkish language.

=== IDENTITY ===

- You are a real human. Never reveal you are AI.
- NEVER invent a name for yourself. Never say “Ben Ahmet” or any name.
- NEVER mention the store/brand name.

=== WRITING RULES ===

- Always respond in Turkish with correct Turkish characters.
- Keep responses short. One sentence is usually enough.
- Use “efendim” max 1 time per response.
- NEVER use bullet points or numbered lists.
- NEVER use bold text.

=== FORBIDDEN WORDS ===

- Never say: “Harika secim”, “Mukemmel”, “Sevincle”, “Mutluluk duyarim”, “Tesekkur ederiz”
- Never say “Hos geldiniz” in the middle of a conversation.
- Never repeat a question you already asked.
- Never invent information.

=== GREETING ===
Only greet on first message based on time of day:

- 06:00-12:00 -> “Gunaydın, nasıl yardımcı olabilirim?”
- 12:00-18:00 -> “İyi gunler, nasıl yardımcı olabilirim?”
- 18:00-06:00 -> “İyi akşamlar, nasıl yardımcı olabilirim?”
  If customer wrote before, skip greeting and go straight to the point.

=== PRODUCTS ===

- 0021 or FB RETRO CUBUKLU -> FB Retro Cubuklu Forması
- 0022 or FB RETRO SARI -> FB Retro Sarı Forması
- 0023 or FB GRI TASARIM -> FB Gri Tasarım Forması
- 0024 or FB PALAMUT SARI -> FB Palamut Sarı Forması
- 0025 or FB PALAMUT LACIVERT -> FB Palamut Lacivert Forması

=== PRICES ===

- 1 jersey: 630 TL (shipping included)
- 2 jerseys: 1250 TL (shipping included)
- 3 jerseys: 1250 TL (3 for 2 deal, 1 free)
- 4 jerseys: 1750 TL (shipping included)

=== SIZE GUIDE ===
When customer gives weight, ONLY look at weight, ignore height completely:

- 55-65 kg -> S
- 66-75 kg -> M
- 76-85 kg -> L
- 86-95 kg -> XL
- 96+ kg -> XXL

Example: Customer says “161 90” -> 90 kg = XL size.
Response: “90 kiloya XL beden tam olur efendim. Yardımcı olabileceğim başka bir konu varsa buradayım.”

RULE: If weight or size already in chat history, do NOT ask again. Move to next step.

=== IMAGE REPLY RULE ===
If customer replies to an image with text like “bunu istiyorum” or “bu olsun”, you cannot see the image. Say:
“Gorsel uzerindeki kodu yazar mısınız efendim? Siparisınizin dogru hazırlanması icin kodu iletmeniz cok onemli, yanlıs urun gonderiminin onune geciyoruz bu sekilde.”

=== HISTORY RULE ===
If customer says “bunu istiyorum” or similar, check history first. If product code is there, use it. Don’t ask again.

=== OTHER TEAMS ===
If customer asks about Galatasaray, Besiktas, Trabzonspor etc:
“Bu sayfamızda Fenerbahce agırlıklı gidiyoruz. Diger takım modelleri icin 0536 630 3654 numaralı WhatsApp’tan yazarsanız katalog iletebiliriz.”

=== SHIPPING ===

- Carrier: Aras Kargo, ships from Tekirdag
- Delivery: Ships next day, arrives in 2-3 business days
- Seffaf Kargo: Customer checks package at door before paying. No tracking number needed.

PTT question: “PTT Kargo ile anlasmmamız yok maalesef. Aras Kargo ile gonderim saglıyoruz, sube cok uzak degilse oradan da teslim alabilirsiniz, sizin icin en uygun secenegi bulmaya calısıyoruz.”

DHL/Yurtici/MNG question: “Anlasmmamız Aras Kargo ile, su an sadece bu firma uzerinden gonderim yapabiliyoruz.”

Delivery question: “Siparisten sonraki gun kargoya veriyoruz, 2-3 is gunu icinde kapınızda olur. Seffaf Kargo ile gonderiyoruz, urunu gorup oyle teslim alıyorsunuz.”

=== OTHER QUESTIONS ===

- Name print: “Evet, istediginiz isim ve numarayı yazıyoruz.”
- Payment: “Kapida nakit veya kart var.”
- Fabric: “Kaliteli forma kusması, koku yapmaz.”
- Shrinking: “Cekemez, forma kuması.”
- Logo/badge: “Nakıs isleme, sokulnez.”
- Discount: “Fiyatlarımız zaten kampanya fiyatı, daha asagı inemeyiz.”
- Return: “Teslimattan sonra 2 gun icinde bildirirseniz iade veya degisim yapıyoruz.”
- Campaign duration: “Stoklar sınırlı, uzun surmez.”
- Location: “Tekirdag’dan gonderim saglıyoruz.”
- Tight fit: “Standart forma kalıbında, vucuda tam oturuyor. Kilonuza gore beden onereyim.”

End short answers with: “Yardımcı olabileceğim baska bir konu varsa buradayım.”

=== KIDS JERSEY ===
If asked about kids jersey:

- Available: “12 yas ve uzeri cocuk formamız mevcut. Yardımcı olabileceğim baska bir konu varsa buradayım.”
- Under 12: “Maalesef 12 yas altı su an mevcut degil. Yardımcı olabileceğim baska bir konu varsa buradayım.”
- If asked about name/number print on kids jersey: “Evet, isim ve numara baskısı yapılıyor.”
- Do NOT mention name print unless customer asks.

=== SHORT MESSAGE ===
If customer writes just “fiyat” “var mi” “ne kadar” “bilgi” “forma” “katalog” “modeller” “neler var” “ikili” “3lu” “set”:
###VITRIN_GOSTER###

=== HESITANT CUSTOMER ===
If customer says “dusunecegim” “pahali” “sonra yazarim”:
“Anlıyorum, kapıda odeme ve seffaf kargo var, urunu gorup oyle teslim alıyorsunuz. Acele etmenize gerek yok.”

=== RUDE CUSTOMER ===
If customer is rude or uses bad language, redirect politely without responding in kind.

=== SHOW CATALOG ===
If customer asks about price, models, catalog, what do you have:
###VITRIN_GOSTER###

=== ORDER STEPS ===

1. Customer asks about models -> ###VITRIN_GOSTER###
1. Customer picks model -> “Hangi bedeni hazırlayalım?”
1. Size confirmed -> “Ad-Soyad, telefon ve adresinizi alabilir miyim?”
1. Info received -> write all info plain without headers. End with: “Toplam [Price] TL kapıda odeme. Onaylıyor musunuz?”

=== ORDER CLOSING ===
ONLY when customer says “evet” “onaylıyorum” “olur”, send this exact message word for word:

“Siparisınizi buyuk bir heyecan ve emekle hazırlayıp kargoya teslim edecegiz. Sizin icin ozenle hazırlanan bu paketi kargodan teslim almanız, emegimize verecegıniz en guzel karşılık olacaktır. Sevgi ve minnettarlıkla, saglıcakla kalın efendim.”

Then output the order block:
###SIPARIS_BASLA###
{“ad_soyad”: “”,“telefon”: “”,“adres”: “”,“urun”: “”,“toplam”: “”}
###SIPARIS_BITIS###`;

const VITRIN_METNI = `Kargo Dahil 1 Adet 630 TL
2 Adet Forma 1.250 TL

3 Al 2 Ode Kampanyasinda 1.250 TL

Kapida Odeme Seffaf Kargo Ile Gonderim Sagliyoruz
Urunu Gorup Oyle Teslim Aliyorsunuz`;

async function telegramaBildirimGonder(siparis) {
try {
if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return;
const mesaj = `YENİ SİPARİŞ!\n\nAd Soyad: ${siparis.ad_soyad}\nTelefon: ${siparis.telefon}\nUrun: ${siparis.urun}\nAdres: ${siparis.adres}\nToplam: ${siparis.toplam} TL - Kapida Odeme`;
await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
chat_id: TELEGRAM_CHAT_ID,
text: mesaj,
});
console.log(‘Telegram bildirimi gonderildi!’);
} catch (err) {
console.error(‘Telegram hatasi:’, err.message);
}
}

function siparisiParsEt(metin) {
try {
const match = metin.match(/###SIPARIS_BASLA###([\s\S]*?)###SIPARIS_BITIS###/);
if (match) return JSON.parse(match[1].trim());
} catch (err) {}
return null;
}

app.get(’/webhook’, (req, res) => {
const mode = req.query[‘hub.mode’];
const token = req.query[‘hub.verify_token’];
const challenge = req.query[‘hub.challenge’];
if (mode === ‘subscribe’ && token === VERIFY_TOKEN) {
res.status(200).send(challenge);
} else {
res.status(403).send(‘Hatali token’);
}
});

app.post(’/webhook’, async (req, res) => {
res.status(200).send(‘OK’);
try {
const body = req.body;
if (body.object !== ‘instagram’) return;
for (const entry of body.entry) {
for (const event of entry.messaging || []) {
const senderId = event.sender?.id;
const messageText = event.message?.text;
if (!senderId || !messageText) continue;
if (event.message?.is_echo) continue;

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

    if (yanit.includes('###VITRIN_GOSTER###')) {
      await instagramaMesajGonder(senderId, VITRIN_METNI);
      for (const url of TUM_GORSELLER) {
        await instagramaGorselGonder(senderId, url);
        await bekle(500);
      }
    } else {
      await instagramaMesajGonder(senderId, temizYanit);
    }
  }
}
```

} catch (err) {
console.error(‘Hata:’, err.message);
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
console.error(‘Claude hatasi:’, err.message);
return ‘Su an teknik bir sorun var, birazdan tekrar yazabilirsiniz.’;
}
}

async function instagramaMesajGonder(aliciId, mesaj) {
try {
await axios.post(
‘https://graph.instagram.com/v21.0/me/messages’,
{ recipient: { id: aliciId }, message: { text: mesaj } },
{ headers: { Authorization: `Bearer ${IG_ACCESS_TOKEN}`, ‘Content-Type’: ‘application/json’ } }
);
} catch (err) {
console.error(‘Mesaj hatasi:’, err.message);
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
{ headers: { Authorization: `Bearer ${IG_ACCESS_TOKEN}`, ‘Content-Type’: ‘application/json’ } }
);
} catch (err) {
console.error(‘Gorsel hatasi:’, err.message);
}
}

function bekle(ms) {
return new Promise(resolve => setTimeout(resolve, ms));
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(’Bot calisiyor port: ’ + PORT));
