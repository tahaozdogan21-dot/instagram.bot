const express = require(‘express’);
const axios = require(‘axios’);
const app = express();

app.use(express.json());

const VERIFY_TOKEN = process.env.VERIFY_TOKEN || ‘formataha2024’;
const CLAUDE_API_KEY = process.env.CLAUDE_API_KEY;
const IG_ACCESS_TOKEN = process.env.IG_ACCESS_TOKEN;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

// Her kullanıcı için konuşma geçmişi
const konusmalar = {};

const FORMA_GORSELLERI = {
‘0021’: ‘https://res.cloudinary.com/dzfiyamng/image/upload/v1778891830/BJK_BEYAZ_RETRO_vybc1r.jpg’,
‘0022’: ‘https://res.cloudinary.com/dzfiyamng/image/upload/v1778891832/BJK_BEYAZ_RETRO_pumkjo.jpg’,
‘0023’: ‘https://res.cloudinary.com/dzfiyamng/image/upload/v1778891832/BJK_BEYAZ_RETRO_vtectc.jpg’,
‘0024’: ‘https://res.cloudinary.com/dzfiyamng/image/upload/v1778891833/BJK_BEYAZ_RETRO_iybbwa.jpg’,
‘0025’: ‘https://res.cloudinary.com/dzfiyamng/image/upload/v1778891832/BJK_BEYAZ_RETRO_oaxlkt.jpg’,
};

const TUM_GORSELLER = Object.values(FORMA_GORSELLERI);

const SISTEM_PROMPT = `Sen bir forma mağazasının satış temsilcisisin. Instagram DM’den müşterilerle yazışıyorsun. Konuşma geçmişini dikkatlice oku ve bağlamı anla.

KİŞİLİK:

- Gerçek bir insan gibi konuş. Müşteri yapay zeka ile konuştuğunu anlamamalı.
- “Efendim” hitabını doğal kullan, her cümlede değil.
- Kısa yaz. Tek cümle çoğu zaman yeterli.
- Türkçe karakterleri doğru kullan: ş, ı, ğ, ü, ö, ç, İ, Ş, Ğ, Ü, Ö, Ç
- Emin olmadığın bir şeyi asla uydurma. Bilmiyorsan sor.

KESİNLİKLE YASAK:

- Madde listesi (•, -, 1. 2. 3.)
- Kalın yazı (**)
- “Harika seçim”, “Mükemmel”, “Sevinçle”, “Tabii ki!”
- Uzun paragraflar
- Yapay zekaya özgü kalıp cümleler

KONUŞMA GEÇMİŞİ KURALI (ÇOK ÖNEMLİ):
Müşteri “bunu istiyorum”, “şunu alacağım”, “onu istiyorum” gibi bir şey yazarsa konuşma geçmişine bak. Bir önceki mesajda hangi ürün konuşuluyordu veya hangi ürün görselinin kodu yazılıysa onu anla. Asla “hangi ürünü?” diye sorma, geçmişten anla.

ÜRÜN KATALOĞU:

- 0021 veya FB RETRO ÇUBUKLU -> FB Retro Çubuklu Forması
- 0022 veya FB RETRO SARI -> FB Retro Sarı Forması
- 0023 veya FB GRİ TASARIM -> FB Gri Tasarım Forması
- 0024 veya FB PALAMUT SARI -> FB Palamut Sarı Forması
- 0025 veya FB PALAMUT LACİVERT -> FB Palamut Lacivert Forması

SPESİFİK SORULAR:

- Beden/kilo: SADECE KİLOYA BAK:
  55-65 kg -> S | 66-75 kg -> M | 76-85 kg -> L | 86-95 kg -> XL | 96+ kg -> XXL
  Cevap: “O kiloya [BEDEN] beden tam olur efendim 👍 Yardımcı olabileceğim başka bir konu varsa buradayım.”
- İsim baskısı: “Evet, istediğiniz isim ve numarayı yazıyoruz efendim. Yardımcı olabileceğim başka bir konu varsa buradayım.”
- Ödeme: “Kapıda nakit veya kart var efendim. Yardımcı olabileceğim başka bir konu varsa buradayım.”
- Kumaş: “Kaliteli forma kumaşı efendim, koku yapmaz. Yardımcı olabileceğim başka bir konu varsa buradayım.”
- Çekme: “Çekmez efendim. Yardımcı olabileceğim başka bir konu varsa buradayım.”
- Arma/logo: “Nakış işleme efendim, sökülmez. Yardımcı olabileceğim başka bir konu varsa buradayım.”
- İndirim: “Fiyatlarımız zaten kampanya fiyatı efendim, daha aşağı inemeyiz. Yardımcı olabileceğim başka bir konu varsa buradayım.”
- Kargo/konum: “Tekirdağ’dan Aras Kargo ile gönderiyoruz efendim, kapıda ödeme var. Yardımcı olabileceğim başka bir konu varsa buradayım.”
- Teslimat: “Siparişten sonraki gün kargoya veriyoruz, 2-3 iş günü içinde kapınızda efendim. Yardımcı olabileceğim başka bir konu varsa buradayım.”
- İade: “Teslimattan sonra 2 gün içinde bildirirseniz iade veya değişim yapıyoruz efendim. Yardımcı olabileceğim başka bir konu varsa buradayım.”
- Kampanya süresi: “Stoklar sınırlı efendim, uzun sürmez. Yardımcı olabileceğim başka bir konu varsa buradayım.”

VİTRİN - Müşteri fiyat, model, forma, katalog sorarsa SADECE şunu yaz:
###VITRIN_GOSTER###

SATIŞ ADIMLARI:

1. Vitrin: ###VITRIN_GOSTER### yaz
1. Müşteri model seçince beden sor: “Hangi bedeni hazırlayalım efendim?”
1. Beden gelince adres iste: “Ad-Soyad, telefon ve adresinizi alabilir miyim efendim?”
1. Onay: Bilgileri düz yaz, “Toplam [Fiyat]₺ kapıda ödeme. Onaylıyor musunuz efendim?”

SİPARİŞ KAPANIŞI (sadece müşteri onayladıktan sonra):
“Siparişinizi aldık, özenle hazırlayıp kargoya vereceğiz. Sağlıcakla kalın efendim 🙏🏻”

###SIPARIS_BASLA###
{“ad_soyad”: “”,“telefon”: “”,“adres”: “”,“urun”: “”,“toplam”: “”}
###SIPARIS_BITIS###`;

const VITRIN_METNI = `Kargo Dahil 1 Adet 630₺
2 Adet Forma 1.250₺

3 Al 2 Öde Kampanyasında 1.250₺

Kapıda Ödeme Şeffaf Kargo İle Gönderim Sağlıyoruz 🙏🏻
Ürünü Görüp Öyle Teslim Alıyorsunuz 👍`;

// ============================================
// TELEGRAM BİLDİRİM
// ============================================
async function telegramaBildirimGonder(siparis) {
try {
if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return;
const mesaj = `🛍️ YENİ SİPARİŞ!\n\n👤 ${siparis.ad_soyad}\n📞 ${siparis.telefon}\n📦 ${siparis.urun}\n📍 ${siparis.adres}\n💰 ${siparis.toplam}₺ - Kapıda Ödeme`;
await axios.post(
`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
{ chat_id: TELEGRAM_CHAT_ID, text: mesaj }
);
console.log(‘Telegram bildirimi gönderildi!’);
} catch (err) {
console.error(‘Telegram hatası:’, err.message);
}
}

// ============================================
// SİPARİŞ PARSE
// ============================================
function siparisiParsEt(metin) {
try {
const match = metin.match(/###SIPARIS_BASLA###([\s\S]*?)###SIPARIS_BITIS###/);
if (match) return JSON.parse(match[1].trim());
} catch (err) {}
return null;
}

// ============================================
// WEBHOOK DOĞRULAMA
// ============================================
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

// ============================================
// GELEN MESAJLARI İŞLE
// ============================================
app.post(’/webhook’, async (req, res) => {
res.status(200).send(‘OK’);
try {
const body = req.body;
if (body.object !== ‘instagram’) return;

```
for (const entry of body.entry) {
  for (const event of entry.messaging || []) {
    const senderId = event.sender?.id;
    const messageText = event.message?.text;
    if (!senderId || !messageText) continue;
    if (event.message?.is_echo) continue;

    // Konuşma geçmişini al veya oluştur
    if (!konusmalar[senderId]) konusmalar[senderId] = [];
    konusmalar[senderId].push({ role: 'user', content: messageText });

    // Son 20 mesajı tut
    if (konusmalar[senderId].length > 20) {
      konusmalar[senderId] = konusmalar[senderId].slice(-20);
    }

    const yanit = await claudeYanitAl(konusmalar[senderId]);

    // Asistan cevabını geçmişe ekle
    const temizYanit = yanit.replace(/###SIPARIS_BASLA###[\s\S]*?###SIPARIS_BITIS###/g, '').replace(/###VITRIN_GOSTER###/g, '').trim();
    konusmalar[senderId].push({ role: 'assistant', content: temizYanit });

    // Sipariş var mı?
    const siparis = siparisiParsEt(yanit);
    if (siparis && siparis.ad_soyad) {
      await telegramaBildirimGonder(siparis);
    }

    // Vitrin mi yoksa normal mesaj mı?
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

// ============================================
// CLAUDE API - KONUŞMA GEÇMİŞİYLE
// ============================================
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
console.error(‘Claude hatası:’, err.message);
return ‘Şu an teknik bir sorun var efendim, birazdan tekrar yazabilirsiniz.’;
}
}

// ============================================
// INSTAGRAM METİN GÖNDER
// ============================================
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

// ============================================
// INSTAGRAM GÖRSEL GÖNDER
// ============================================
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
