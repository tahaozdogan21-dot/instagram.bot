const express = require(‘express’);
const axios = require(‘axios’);
const app = express();

app.use(express.json());

const VERIFY_TOKEN = process.env.VERIFY_TOKEN || ‘formataha2024’;
const CLAUDE_API_KEY = process.env.CLAUDE_API_KEY;
const IG_ACCESS_TOKEN = process.env.IG_ACCESS_TOKEN;

const FORMA_GORSELLERI = {
‘0021’: ‘https://res.cloudinary.com/dzfiyamng/image/upload/v1778891830/BJK_BEYAZ_RETRO_vybc1r.jpg’,
‘0022’: ‘https://res.cloudinary.com/dzfiyamng/image/upload/v1778891832/BJK_BEYAZ_RETRO_pumkjo.jpg’,
‘0023’: ‘https://res.cloudinary.com/dzfiyamng/image/upload/v1778891832/BJK_BEYAZ_RETRO_vtectc.jpg’,
‘0024’: ‘https://res.cloudinary.com/dzfiyamng/image/upload/v1778891833/BJK_BEYAZ_RETRO_iybbwa.jpg’,
‘0025’: ‘https://res.cloudinary.com/dzfiyamng/image/upload/v1778891832/BJK_BEYAZ_RETRO_oaxlkt.jpg’,
};

const TUM_GORSELLER = Object.values(FORMA_GORSELLERI);

const SISTEM_PROMPT = `Sen bir forma mağazasının nazik, resmi ve profesyonel satış danışmanısın. Müşterilerle “Efendim” diyerek hitap ediyorsun. Kısa ve net cevaplar veriyorsun. Firma adını asla söyleme.

YAZIM KURALLARI:

- Türkçe yaz, Türkçe karakterleri doğru kullan (ş, ı, ğ, ü, ö, ç, İ, Ş, Ğ, Ü, Ö, Ç)
- Kısa ve net cevaplar ver
- Madde listesi yapma
- Sohbeti uzatan sorular sorma
- İzin verilen emojiler: 👍 🙏🏻 🎁

ÜRÜN KATALOĞU:

- 0021 veya FB RETRO ÇUBUKLU -> FB Retro Çubuklu Forması
- 0022 veya FB RETRO SARI -> FB Retro Sarı Forması
- 0023 veya FB GRİ TASARIM -> FB Gri Tasarım Forması
- 0024 veya FB PALAMUT SARI -> FB Palamut Sarı Forması
- 0025 veya FB PALAMUT LACİVERT -> FB Palamut Lacivert Forması

SPESİFİK SORULAR:

- Beden/boy/kilo sorulursa: Kiloya göre beden öner. SADECE KİLOYA BAK:
  55-65 kg -> S beden
  66-75 kg -> M beden
  76-85 kg -> L beden
  86-95 kg -> XL beden
  96 kg ve üzeri -> XXL beden
  Cevap: “Efendim o kiloya [BEDEN] beden tam olacaktır 👍”
- İsim baskısı sorulursa: “Evet efendim, istediğiniz isim ve numarayı yazdırabiliyoruz.”
- Ödeme sorulursa: “Kapıda ödeme nakit veya kredi kartı ile mevcuttur efendim.”
- Kumaş/terleme sorulursa: “Ürünlerimiz orijinal kalitede forma kumaşıdır, koku yapmaz efendim.”
- Çekme/yıkama sorulursa: “Kesinlikle çekmez efendim.”
- Arma/logo sorulursa: “Nakış işlemedir, sökülme yapmaz efendim.”
- İndirim sorulursa: “En dip fiyat budur efendim.”
- Kargo/konum sorulursa: “Tekirdağ’dan Aras Kargo ile şeffaf kargo ve kapıda ödeme güvencesiyle gönderiyoruz efendim.”

VİTRİN - Müşteri fiyat, model, forma sorarsa SADECE şunu yaz:
###VITRIN_GOSTER###

SATIŞ ADIMLARI:

1. Vitrin: ###VITRIN_GOSTER### yaz
1. Beden: “S, M, L, XL ve XXL bedenlerimiz mevcuttur efendim. Hangi bedeni hazırlayalım?”
1. Adres: “Siparişi oluşturmak için Ad-Soyad, Telefon ve Tam Adresinizi yazar mısınız efendim?”
1. Onay: Bilgileri alt alta yaz, “Toplam [Fiyat]₺ - Kapıda Ödeme. Onaylıyor musunuz efendim?” ekle.

SİPARİŞ KAPANIŞI (sadece onay gelince):
“Siparişinizi özenle hazırlayıp kargoya teslim edeceğiz. Sağlıcakla kalın efendim 🙏🏻”

###SIPARIS_BASLA###
{“ad_soyad”: “”,“telefon”: “”,“adres”: “”,“urun”: “”,“toplam”: “”}
###SIPARIS_BITIS###`;

const VITRIN_METNI = `Kargo Dahil 1 Adet 630₺
2 Adet Forma 1.250₺

3 Al 2 Öde Kampanyasında 1.250₺

Kapıda Ödeme Şeffaf Kargo İle Gönderim Sağlıyoruz 🙏🏻
Ürünü Görüp Öyle Teslim Alıyorsunuz 👍`;

app.get(’/webhook’, (req, res) => {
const mode = req.query[‘hub.mode’];
const token = req.query[‘hub.verify_token’];
const challenge = req.query[‘hub.challenge’];
if (mode === ‘subscribe’ && token === VERIFY_TOKEN) {
res.status(200).send(challenge);
} else {
res.status(403).send(‘Hatalı token’);
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
const yanit = await claudeYanitAl(messageText);
if (yanit.includes(’###VITRIN_GOSTER###’)) {
await instagramaMesajGonder(senderId, VITRIN_METNI);
for (const url of TUM_GORSELLER) {
await instagramaGorselGonder(senderId, url);
await bekle(500);
}
} else {
await instagramaMesajGonder(senderId, yanit);
}
}
}
} catch (err) {
console.error(‘Hata:’, err.message);
}
});

async function claudeYanitAl(mesaj) {
try {
const response = await axios.post(
‘https://api.anthropic.com/v1/messages’,
{
model: ‘claude-haiku-4-5-20251001’,
max_tokens: 500,
system: SISTEM_PROMPT,
messages: [{ role: ‘user’, content: mesaj }],
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
return ‘Şu an teknik bir sorun yaşıyoruz efendim. En kısa sürede dönüş yapacağız.’;
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
console.error(‘Mesaj hatası:’, err.message);
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
console.error(‘Görsel hatası:’, err.message);
}
}

function bekle(ms) {
return new Promise(resolve => setTimeout(resolve, ms));
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Bot ${PORT} portunda çalışıyor`));
