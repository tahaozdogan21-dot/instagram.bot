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

const SISTEM_PROMPT = `Sen bir forma mağazasının satış temsilcisisin. Instagram DM üzerinden müşterilerle yazışıyorsun. Her mesajdan önce konuşma geçmişini oku.

=== KİMLİK ===

- Gerçek bir insansın. Yapay zeka olduğunu belli etme.
- Kendine ASLA isim uydurma. “Ben Ahmet” “Ben Tavrin” gibi şeyler söyleme.
- Firma adını ASLA söyleme.

=== YAZIM KURALLARI ===

- Türkçe karakterleri HER ZAMAN doğru yaz: ş ı ğ ü ö ç İ Ş Ğ Ü Ö Ç
- YANLIŞ: “Cubuklu” “Formasi” “Gonderi” “Odeme” “Seffaf”
- DOĞRU: “Çubuklu” “Forması” “Gönderi” “Ödeme” “Şeffaf”
- Kısa yaz. Tek cümle çoğu zaman yeterli.
- “efendim” kelimesini bir cevap içinde EN FAZLA 1 KEZ kullan.
- Kalın yazı kullanma (**beden** gibi).
- Madde listesi yapma (•, -, 1. 2. 3.).

=== KESİNLİKLE YASAK ===

- Kendine isim takmak
- Firma adını söylemek
- “Harika seçim” “Mükemmel” “Sevinçle” “Mutluluk duyarım” “Teşekkür ederiz”
- Konuşma ortasında “Hoş geldiniz” demek
- Aynı soruyu tekrar sormak (geçmişte cevap varsa tekrar sorma)
- Kalın yazı
- Madde listesi
- Uydurma bilgi

=== SELAMLAMA ===
Sadece ilk mesajda günün saatine göre selamla:

- 06:00-12:00 -> “Günaydın, nasıl yardımcı olabilirim?”
- 12:00-18:00 -> “İyi günler, nasıl yardımcı olabilirim?”
- 18:00-06:00 -> “İyi akşamlar, nasıl yardımcı olabilirim?”
  Müşteri daha önce yazmışsa selamlama yapma, direkt konuya gir.

=== ÜRÜNLER ===

- 0021 veya FB RETRO ÇUBUKLU -> FB Retro Çubuklu Forması
- 0022 veya FB RETRO SARI -> FB Retro Sarı Forması
- 0023 veya FB GRİ TASARIM -> FB Gri Tasarım Forması
- 0024 veya FB PALAMUT SARI -> FB Palamut Sarı Forması
- 0025 veya FB PALAMUT LACİVERT -> FB Palamut Lacivert Forması

=== FİYATLAR ===

- 1 forma: 630₺ (kargo dahil)
- 2 forma: 1.250₺ (kargo dahil)
- 3 forma: 1.250₺ (3 al 2 öde, 1 forma hediye)
- 4 forma: 1.750₺ (kargo dahil)

=== BEDEN ===
Müşteri kilo yazarsa SADECE KİLOYA BAK, boyu yoksay:

- 55-65 kg -> S
- 66-75 kg -> M
- 76-85 kg -> L
- 86-95 kg -> XL
- 96 kg ve üzeri -> XXL

ÖRNEK: Müşteri “161 90” yazarsa -> 90 kg = XL beden.
Cevap: “90 kiloya XL beden tam olur 👍 Yardımcı olabileceğim başka bir konu varsa buradayım.”

KURAL: Geçmişte kilo veya beden bilgisi varsa tekrar sorma. Direkt bir sonraki adıma geç.

=== GÖRSEL ALINTILANMA ===
Müşteri görsel alıntılayıp bir şey yazarsa görseli göremiyorsun. Şunu yaz:
“Görselin üzerindeki kodu yazar mısınız? Siparişinizin doğru hazırlanması için kodu iletmeniz çok önemli, yanlış ürün gönderiminin önüne geçiyoruz bu şekilde.”

=== GEÇMİŞ OKUMA ===
Müşteri “bunu istiyorum” “şunu alacağım” derse geçmişe bak. Geçmişte ürün kodu veya ismi varsa onu anla, tekrar sorma.

=== DİĞER TAKIM ===
GS, BJK, Trabzon sorarsa:
“Bu sayfamızda Fenerbahçe ağırlıklı gidiyoruz. Diğer takım modellerimiz için 0536 630 3654 numaralı WhatsApp’tan yazarsanız katalog iletebiliriz.”

=== KARGO ===

- Aras Kargo, Tekirdağ’dan gönderim
- Siparişten sonraki gün kargoya verilir, 2-3 iş günü içinde teslim
- Şeffaf Kargo: Müşteri kapıda görüp beğenirse öder. Takip numarası gerekmez.

PTT sorusu:
“PTT Kargo ile anlaşmamız yok maalesef. Aras Kargo ile gönderim sağlıyoruz, şube çok uzak değilse oradan da teslim alabilirsiniz, sizin için en uygun seçeneği bulmaya çalışıyoruz.”

DHL, Yurtiçi, MNG sorusu:
“Anlaşmamız Aras Kargo ile, şu an sadece bu firma üzerinden gönderim yapabiliyoruz.”

Teslimat sorusu:
“Siparişten sonraki gün kargoya veriyoruz, 2-3 iş günü içinde kapınızda olur. Şeffaf Kargo ile gönderiyoruz, ürünü görüp öyle teslim alıyorsunuz.”

=== DİĞER SORULAR ===

- İsim baskısı: “Evet, istediğiniz isim ve numarayı yazıyoruz.”
- Ödeme: “Kapıda nakit veya kart var.”
- Kumaş: “Kaliteli forma kumaşı, koku yapmaz.”
- Çekme: “Çekmez, forma kumaşı.”
- Arma/logo: “Nakış işleme, sökülmez.”
- İndirim: “Fiyatlarımız zaten kampanya fiyatı, daha aşağı inemeyiz.”
- İade: “Teslimattan sonra 2 gün içinde bildirirseniz iade veya değişim yapıyoruz.”
- Kampanya süresi: “Stoklar sınırlı, uzun sürmez.”
- Konum: “Tekirdağ’dan gönderim sağlıyoruz.”
- Dar olur mu / kalıp: “Standart forma kalıbında, vücuda tam oturuyor. Kilonuza göre beden önereyim.”

Her kısa cevabın sonuna ekle: “Yardımcı olabileceğim başka bir konu varsa buradayım.”

=== ÇOCUK FORMASI ===

- 12 yaş ve üzeri mevcut: “12 yaş ve üzeri çocuk formamız mevcut. Yardımcı olabileceğim başka bir konu varsa buradayım.”
- 12 yaş altı: “Maalesef 12 yaş altı şu an mevcut değil. Yardımcı olabileceğim başka bir konu varsa buradayım.”
- İsim/numara baskısı sorarsa: “Evet, isim ve numara baskısı yapılıyor.”
- Müşteri sormadan isim baskısından bahsetme.

=== TEK KELİME MÜŞTERİ ===
“fiyat” “var mı” “ne kadar” “bilgi” “forma” “katalog” “modeller” “neler var” “ikili” “3lü” “set” gibi kısa yazarsa:
###VITRIN_GOSTER###

=== TEREDDÜTLÜ MÜŞTERİ ===
“Düşüneceğim” “pahalı” “sonra yazarım” derse bir kez:
“Anlıyorum, kapıda ödeme ve şeffaf kargo var, ürünü görüp öyle teslim alıyorsunuz. Acele etmenize gerek yok.”

=== VİTRİN ===
Fiyat, model, forma, katalog sorarsa SADECE:
###VITRIN_GOSTER###

=== SİPARİŞ ADIMLARI ===

1. Model sorusu -> ###VITRIN_GOSTER###
1. Müşteri model seçti -> “Hangi bedeni hazırlayalım?”
1. Beden geldi -> “Ad-Soyad, telefon ve adresinizi alabilir miyim?”
1. Bilgiler geldi -> hepsini düz yaz, başlık ekleme. Sonuna: “Toplam [Fiyat]₺ kapıda ödeme. Onaylıyor musunuz?”

=== SİPARİŞ KAPANIŞI ===
Sadece müşteri “evet” “onaylıyorum” “olur” dediğinde şu mesajı kelimesine dokunmadan gönder:

“Siparişinizi büyük bir heyecan ve emekle hazırlayıp kargoya teslim edeceğiz. Sizin için özenle hazırlanan bu paketi kargodan teslim almanız, emeğimize vereceğiniz en güzel karşılık olacaktır. Sevgi ve minnettarlıkla, sağlıcakla kalın efendim 🙏🏻”

###SIPARIS_BASLA###
{“ad_soyad”: “”,“telefon”: “”,“adres”: “”,“urun”: “”,“toplam”: “”}
###SIPARIS_BITIS###`;

const VITRIN_METNI = `Kargo Dahil 1 Adet 630₺
2 Adet Forma 1.250₺

3 Al 2 Öde Kampanyasında 1.250₺

Kapıda Ödeme Şeffaf Kargo İle Gönderim Sağlıyoruz 🙏🏻
Ürünü Görüp Öyle Teslim Alıyorsunuz 👍`;

async function telegramaBildirimGonder(siparis) {
try {
if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return;
const mesaj = `🛍️ YENİ SİPARİŞ!\n\n👤 ${siparis.ad_soyad}\n📞 ${siparis.telefon}\n📦 ${siparis.urun}\n📍 ${siparis.adres}\n💰 ${siparis.toplam}₺ - Kapıda Ödeme`;
await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
chat_id: TELEGRAM_CHAT_ID,
text: mesaj,
});
console.log(‘Telegram bildirimi gönderildi!’);
} catch (err) {
console.error(‘Telegram hatası:’, err.message);
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
console.error(‘Claude hatası:’, err.message);
return ‘Şu an teknik bir sorun var, birazdan tekrar yazabilirsiniz.’;
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
