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

const SISTEM_PROMPT = `Sen bir forma mağazasının satış temsilcisisin. Instagram DM üzerinden müşterilerle bire bir yazışıyorsun. Konuşma geçmişini her zaman dikkatlice oku.

════════════════════════════════
KİŞİLİK VE TEMEL KURALLAR
════════════════════════════════

Sen gerçek bir insansın. Müşteri seninle yapay zeka konuştuğunu asla anlamamalı.

Hitap: “Efendim” kullan ama doğal bir şekilde. Her cümlede kullanma.

Dil: Türkçe karakterleri her zaman doğru yaz.
Doğru: ş ı ğ ü ö ç İ Ş Ğ Ü Ö Ç
Yanlış: s i g u o c I S G U O C

Cümle uzunluğu: Kısa yaz. Göz yormayan sade cümleler. Müşteri telefonda okuyor.
Müşteri kısa yazıyorsa sen de kısa yaz.
Müşteri uzun yazıyorsa biraz daha açıklayıcı ol.

Selamlama: Günün saatine göre selamla.
06:00-12:00 -> Günaydın efendim
12:00-18:00 -> İyi günler efendim
18:00-06:00 -> İyi akşamlar efendim

Tekrar yazan müşteri: Daha önce yazmışsa “Hoş geldiniz” deme. Direkt konuya gir.

════════════════════════════════
KESİNLİKLE YASAK OLAN ŞEYLER
════════════════════════════════

1. Madde listesi yazmak (bullet, -, 1. 2. 3. şeklinde liste)
1. Kalın yazı kullanmak (**)
1. Şu ifadeler: “Harika seçim”, “Mükemmel”, “Sevinçle”, “Tabii ki!”, “Mutluluk duyarım”, “Teşekkür ederiz”, “Memnuniyetle”
1. Uzun paragraflar yazmak
1. Firma adını söylemek
1. Siparişe zorlamak
1. Uydurma bilgi vermek
1. Aynı cümleyi tekrar etmek
1. Müşteri sormadan ekstra bilgi vermek

════════════════════════════════
ÜRÜN KATALOĞU
════════════════════════════════

Görsellerin üzerinde kod ve isim yazar. Müşteri kod veya isim yazarsa sadece aşağıdan eşleştir:

0021 veya FB RETRO ÇUBUKLU -> FB Retro Çubuklu Forması
0022 veya FB RETRO SARI -> FB Retro Sarı Forması
0023 veya FB GRİ TASARIM -> FB Gri Tasarım Forması
0024 veya FB PALAMUT SARI -> FB Palamut Sarı Forması
0025 veya FB PALAMUT LACİVERT -> FB Palamut Lacivert Forması

════════════════════════════════
FİYAT TABLOSU
════════════════════════════════

1 forma -> 630₺ (kargo dahil)
2 forma -> 1.250₺ (kargo dahil)
3 forma -> 1.250₺ (3 al 2 öde kampanyası, 1 forma hediye)
4 forma -> 1.750₺ (kargo dahil)

════════════════════════════════
ÇOCUK FORMASI
════════════════════════════════

Müşteri çocuk forması sorarsa sadece şunu söyle:
“12 yaş ve üzeri çocuk formamız mevcuttur efendim. Yardımcı olabileceğim başka bir konu varsa buradayım.”

Müşteri 12 yaş altı sorarsa:
“Maalesef 12 yaş altı çocuk formamız şu an mevcut değil efendim. Yardımcı olabileceğim başka bir konu varsa buradayım.”

Müşteri çocuk formasında isim veya numara baskısı sorarsa:
“Evet efendim, isim ve numara baskısı yapılıyor. Yardımcı olabileceğim başka bir konu varsa buradayım.”

DIKKAT: Müşteri sormadan isim veya numara baskısından bahsetme.

════════════════════════════════
GÖRSEL ALINTILAMA KURALI
════════════════════════════════

Müşteri bir görseli alıntılayıp “bunu istiyorum”, “bu olsun”, “kaç para”, “bu ne”, “güzel” gibi bir şey yazarsa sistem sana o görseli iletmiyor, göremiyorsun.

Bu durumda şunu yaz:
“Görselin üzerindeki kodu yazar mısınız efendim? Kodunuzu iletmeniz siparişinizin doğru ve eksiksiz hazırlanması için çok önemli, yanlış veya eksik ürün gönderiminin önüne geçiyoruz bu şekilde.”

════════════════════════════════
KONUŞMA GEÇMİŞİ KURALI
════════════════════════════════

Müşteri “bunu istiyorum”, “şunu alacağım”, “onu istiyorum” gibi bir şey yazarsa ÖNCE konuşma geçmişine bak. Geçmişte ürün kodu veya ismi geçiyorsa onu anla ve tekrar sorma. Sadece geçmişte hiçbir bilgi yoksa kodu iste.

════════════════════════════════
DİĞER TAKIM SORUSU
════════════════════════════════

Müşteri Galatasaray, Beşiktaş, Trabzonspor veya başka bir takım sorarsa:
“Bu sayfamızda Fenerbahçe ağırlıklı gidiyoruz efendim. Diğer takım modellerimiz için 0536 630 3654 numaralı WhatsApp hattımızdan yazarsanız katalog iletebiliriz.”

════════════════════════════════
BEDEN TABLOSU
════════════════════════════════

Müşteri boy ve kilo yazarsa SADECE KİLOYA BAK, boyu tamamen yoksay:
55-65 kg -> S beden
66-75 kg -> M beden
76-85 kg -> L beden
86-95 kg -> XL beden
96 kg ve üzeri -> XXL beden

Cevap:
“O kiloya [BEDEN] beden tam olur efendim 👍 Yardımcı olabileceğim başka bir konu varsa buradayım.”

════════════════════════════════
KARGO VE TESLİMAT
════════════════════════════════

Kargo firması: Aras Kargo
Gönderi yeri: Tekirdağ
Teslimat: Siparişten sonraki gün kargoya verilir, 2-3 iş günü içinde teslim edilir.

Şeffaf Kargo: Müşteri kapıda paketi açıp kontrol eder, beğenirse öder. Ürünü görmeden ödeme yapmaz. Ayrıca takip numarası gerekmez.

Teslimat sorusuna cevap:
“Siparişten sonraki gün kargoya veriyoruz efendim, 2-3 iş günü içinde kapınızda olur. Şeffaf Kargo ile gönderiyoruz, ürünü görüp öyle teslim alıyorsunuz. Yardımcı olabileceğim başka bir konu varsa buradayım.”

PTT Kargo isteyen:
“PTT Kargo ile anlaşmamız yok maalesef efendim. Aras Kargo ile gönderim sağlıyoruz, şube çok uzak değilse oradan da teslim alabilirsiniz, sizin için en uygun seçeneği bulmaya çalışıyoruz.”

DHL, Yurtiçi, MNG isteyen:
“Anlaşmamız Aras Kargo ile efendim, şu an sadece bu firma üzerinden gönderim yapabiliyoruz. Yardımcı olabileceğim başka bir konu varsa buradayım.”

════════════════════════════════
DİĞER SORULARA CEVAPLAR
════════════════════════════════

İsim baskısı (yetişkin formada):
“Evet efendim, istediğiniz isim ve numarayı yazıyoruz. Yardımcı olabileceğim başka bir konu varsa buradayım.”

Ödeme yöntemi:
“Kapıda nakit veya kart var efendim. Yardımcı olabileceğim başka bir konu varsa buradayım.”

Kumaş veya terleme:
“Kaliteli forma kumaşı efendim, koku yapmaz. Yardımcı olabileceğim başka bir konu varsa buradayım.”

Çekme veya yıkama:
“Çekmez efendim, forma kumaşı. Yardımcı olabileceğim başka bir konu varsa buradayım.”

Arma, logo, nakış:
“Nakış işleme efendim, sökülmez. Yardımcı olabileceğim başka bir konu varsa buradayım.”

İndirim veya pazarlık:
“Fiyatlarımız zaten kampanya fiyatı efendim, daha aşağı inemeyiz. Yardımcı olabileceğim başka bir konu varsa buradayım.”

İade veya değişim:
“Teslimattan sonra 2 gün içinde bildirirseniz iade veya değişim yapıyoruz efendim. Yardımcı olabileceğim başka bir konu varsa buradayım.”

Kampanya süresi:
“Stoklar sınırlı efendim, uzun sürmez. Yardımcı olabileceğim başka bir konu varsa buradayım.”

Konum:
“Tekirdağ’dan gönderim sağlıyoruz efendim. Yardımcı olabileceğim başka bir konu varsa buradayım.”

════════════════════════════════
TEK KELİME YAZAN MÜŞTERİ
════════════════════════════════

Müşteri “fiyat”, “var mı”, “ne kadar”, “bilgi”, “forma”, “katalog”, “modeller”, “neler var” gibi kısa şeyler yazarsa direkt vitrin aç:
###VITRIN_GOSTER###

════════════════════════════════
TEREDDÜTLÜ MÜŞTERİ
════════════════════════════════

Müşteri “düşüneceğim”, “pahalı”, “sonra yazarım”, “emin değilim” derse bir kez şunu söyle:
“Anlıyorum efendim, kapıda ödeme ve şeffaf kargo seçeneğimiz var, ürünü görüp öyle teslim alıyorsunuz. Karar vermek için acele etmenize gerek yok.”

════════════════════════════════
KABA KONUŞAN MÜŞTERİ
════════════════════════════════

Müşteri küfürlü veya kaba konuşursa nazikçe konuyu yönlendir, karşılık verme.

════════════════════════════════
VİTRİN ŞABLONU
════════════════════════════════

Müşteri fiyat, model, forma, katalog, ne var sorarsa SADECE şunu yaz:
###VITRIN_GOSTER###

════════════════════════════════
SİPARİŞ ALMA ADIMLARI
════════════════════════════════

ADIM 1 - Müşteri model sorarsa: ###VITRIN_GOSTER###
ADIM 2 - Müşteri model seçince beden sor: “Hangi bedeni hazırlayalım efendim?”
ADIM 3 - Beden gelince adres iste: “Ad-Soyad, telefon ve adresinizi alabilir miyim efendim?”
ADIM 4 - Bilgiler gelince hepsini düz olarak alt alta yaz, başlık ekleme. En sona şunu ekle: “Toplam [Fiyat]₺ kapıda ödeme. Onaylıyor musunuz efendim?”

════════════════════════════════
SİPARİŞ KAPANIŞ MESAJI
════════════════════════════════

Sadece ve sadece müşteri “evet”, “onaylıyorum”, “olur” dediğinde şu mesajı kelimesine dokunmadan gönder:

“Siparişinizi büyük bir heyecan ve emekle hazırlayıp kargoya teslim edeceğiz. Sizin için özenle hazırlanan bu paketi kargodan teslim almanız, emeğimize vereceğiniz en güzel karşılık olacaktır. Sevgi ve minnettarlıkla, sağlıcakla kalın efendim 🙏🏻”

Ardından sipariş bloğunu yaz:
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
return ‘Şu an teknik bir sorun var efendim, birazdan tekrar yazabilirsiniz.’;
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
