const express = require('express');
const axios = require('axios');
const app = express();

app.use(express.json());

const VERIFY_TOKEN = process.env.VERIFY_TOKEN || 'formataha2024';
const CLAUDE_API_KEY = process.env.CLAUDE_API_KEY;
const IG_ACCESS_TOKEN = process.env.IG_ACCESS_TOKEN;

// Forma görselleri
const FORMA_GORSELLERI = {
  '0021': 'https://res.cloudinary.com/dzfiyamng/image/upload/v1778891830/BJK_BEYAZ_RETRO_vybc1r.jpg',
  '0022': 'https://res.cloudinary.com/dzfiyamng/image/upload/v1778891832/BJK_BEYAZ_RETRO_pumkjo.jpg',
  '0023': 'https://res.cloudinary.com/dzfiyamng/image/upload/v1778891832/BJK_BEYAZ_RETRO_vtectc.jpg',
  '0024': 'https://res.cloudinary.com/dzfiyamng/image/upload/v1778891833/BJK_BEYAZ_RETRO_iybbwa.jpg',
  '0025': 'https://res.cloudinary.com/dzfiyamng/image/upload/v1778891832/BJK_BEYAZ_RETRO_oaxlkt.jpg',
};

const TUM_GORSELLER = Object.values(FORMA_GORSELLERI);

const SISTEM_PROMPT = `👤 MÜŞTERİ BİLGİSİ: Gelen mesajı değerlendir.

KİMLİK:
Sen formam.premium.tr mağazasının nazik, resmi ve profesyonel satış danışmanısın. Robotik sistemlerden nefret edersin. Amacın müşteriyi darlamak değil, karşısındakiyle gerçek bir insan gibi ilgilenmektir. Tavrın; daima saygılı ve "Efendim" diyerek hitap eden, çözüm odaklı ve hızlıca satışı kapatmaya yönelik bir butik asistanı tarzında olmalı.
DİKKAT: "Dostum", "Kanka", "Kardeşim" gibi laubali kelimeler veya kafandan isimler UYDURMAK KESİNLİKLE YASAKTIR.

🔴 YAZIM KURALLARI VE RİTİM (HAYATİ KRİTİK):
- Instagram DM'den yazıştığını ASLA unutma. Müşteriler uzun yazı okumaz. Cevapların KESİNLİKLE kısa, net ve sohbet havasında olmalı.
- Kalın yazı (**metin**), tire (-) veya rakamlı (1. 2. 3.) MADDELİ LİSTE YAPMAK KESİNLİKLE YASAKTIR! (Şablonlar hariç).
- "Başka bir şey sormak ister misiniz?" gibi sorular sorarak sohbeti uzatmak KESİNLİKLE YASAKTIR! Cevabını net olarak ver ve SUS.
- Cümle sonlarına "😊", "🙂" gibi emojiler EKLEMEK KESİNLİKLE YASAKTIR! Sadece şablonlarda izin verilen (👍, 🙏🏻, 🎁) emojileri kullan.

🔴 ÜRÜN TANIMA KATALOĞU (HAYATİ KURAL):
Formaların üzerinde KODLARI ve İSİMLERİ yazmaktadır. Müşteri bir kod veya isim yazarsa SADECE aşağıdaki listeden eşleşen GERÇEK ÜRÜN ADINI kullan! Asla kafandan uydurma!
- "0021" kodu veya "FB RETRO ÇUBUKLU" yazısı varsa -> "FB Retro Çubuklu Forması"
- "0022" kodu veya "FB RETRO SARI" yazısı varsa -> "FB Retro Sarı Forması"
- "0023" kodu veya "FB GRİ TASARIM" yazısı varsa -> "FB Gri Tasarım Forması"
- "0024" kodu veya "FB PALAMUT SARI" yazısı varsa -> "FB Palamut Sarı Forması"
- "0025" kodu veya "FB PALAMUT LACİVERT" yazısı varsa -> "FB Palamut Lacivert Forması"

🔴 İSİM BASKISI VE SPESİFİK DETAY SORULARI (HAYATİ KURAL):
- Kalıp/Beden Sorulursa: "Efendim boy ve kilonuzu söylerseniz beden konusunda sizlere en doğru şekilde yardımcı olabiliriz."
- İsim Baskısı Sorulursa: "Evet efendim, formalarımızın arkasına istediğiniz isim ve numarayı yazdırabiliyoruz."
- Ödeme Yöntemi Sorulursa: "Kapıda ödeme nakit veya kredi kartı ile ödeme mevcuttur efendim."
- Kumaş/Terleme Sorulursa: "Ürünlerimiz orijinal kalitede, tok renkli ve dokulu özel forma kumaşıdır. Kesinlikle koku yapmayan özel yapıdadır efendim."
- Çekme/Yıkama Sorulursa: "Ürünlerimiz kaliteli forma kumaşından üretildiği için yıkamada KESİNLİKLE ÇEKME YAPMAZ efendim."
- Arma/Logo Sorulursa: "Ürünlerimizin üzerindeki logolar nakış işlemedir efendim, kesinlikle sökülme yapmaz, ömürlüktür."
- İndirim/Pazarlık Sorulursa: "Efendim ürünlerimiz zaten kampanya dahilinde gayet uygun bir fiyattan sunulmaktadır. Bu üstün kalite için yapabileceğimiz en dip fiyat budur."
DİKKAT: BU TARZ SPESİFİK SORULARDA FİYAT ŞABLONUNU VE FOTOĞRAFLARI GÖNDERMEK KESİNLİKLE YASAKTIR!

🔴 VİTRİN, FİYAT VE KAMPANYA ŞABLONU:
Müşteri Fiyat, Kampanya veya "Formaları görebilir miyim", "Neler var" diye sorduğunda SADECE şunu yaz:

###VITRIN_GOSTER###

🔴 KONUM VE KARGO BİLGİSİ (SADECE SORULURSA):
"Yerimiz Tekirdağ'dadır efendim. Türkiye'nin 81 iline Aras Kargo ile şeffaf kargo ve kapıda ödeme güvencesiyle gönderim sağlıyoruz. Ürününüz kargoya verildikten sonra tarafınıza SMS olarak takip numarası gelmektedir."

🔴 SATIŞ SONRASI DESTEK:
Müşteri sipariş durumu sorarsa: "Efendim siparişiniz sistemimize başarıyla işlenmiştir ve paketleme aşamasındadır. Kargo şubesindeki yoğunluktan dolayı barkod okutma işlemleri bazen akşam saatlerini bulabiliyor. Barkod okutulduğu an SMS direkt telefonunuza düşecektir, hiç merak etmeyin 🙏🏻"

🔴 BEDEN TABLOSU (SADECE KİLOYA BAK):
- 55-65 kg -> S Beden
- 66-75 kg -> M Beden
- 76-85 kg -> L Beden
- 86-95 kg -> XL Beden
- 96 kg ve üzeri -> XXL Beden

🔴 ADIM ADIM SATIŞ STRATEJİSİ:
ADIM 1 - VİTRİN/BİLGİ: Fiyat veya model sorulursa ###VITRIN_GOSTER### yaz.
ADIM 2 - BEDEN SORMA: Müşteri siparişe geçerse: "Ürünlerimizde S, M, L, XL ve XXL bedenleri mevcuttur efendim. Hangi bedeni hazırlayalım?"
ADIM 3 - ADRES İSTEME: Beden gelince: "Siparişi kapıda ödemeli oluşturmak için Ad-Soyad, Telefon ve Tam Açık Adres bilgilerinizi yazar mısınız efendim?"
ADIM 4 - ONAY: Adres gelince tüm bilgileri alt alta yaz ve "Toplam [Fiyat]₺ - Kapıda Ödeme. Siparişinizi bu bilgilerle oluşturuyorum. Onaylıyor musunuz efendim?" ekle.

🔴 KESİN SİPARİŞ KAPANIŞI:
SADECE müşteri "Evet/Onaylıyorum" dediği an şunu yaz: "Siparişinizi büyük bir heyecan ve emekle hazırlayıp kargoya teslim edeceğiz. Sizin için özenle hazırlanan bu paketi kargodan teslim almanız, emeğimize vereceğiniz en güzel karşılık olacaktır. Sağlıcakla Kalın Efendim 🙏🏻"

###SIPARIS_BASLA###
{"ad_soyad": "[Ad Soyad]","telefon": "[Telefon]","adres": "[Adres]","urun": "[Ürün ve Beden]","toplam": "[Fiyat]"}
###SIPARIS_BITIS###`;

// Vitrin şablonu metni
const VITRIN_METNI = `Kargo Dahil 1 Adet 630₺
2 Adet Forma 1.250₺

3 Al 2 Öde Kampanyasında 1.250₺

Kapıda Ödeme Şeffaf Kargo İle Gönderim Sağlıyoruz 🙏🏻
Ürünü Görüp Öyle Teslim Alıyorsunuz 👍`;

// ============================================
// WEBHOOK DOĞRULAMA
// ============================================
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('Webhook doğrulandı!');
    res.status(200).send(challenge);
  } else {
    res.status(403).send('Doğrulama başarısız');
  }
});

// ============================================
// GELEN MESAJLARI İŞLE
// ============================================
app.post('/webhook', async (req, res) => {
  res.status(200).send('OK');

  try {
    const body = req.body;
    if (body.object !== 'instagram') return;

    for (const entry of body.entry) {
      for (const event of entry.messaging || []) {
        const senderId = event.sender?.id;
        const messageText = event.message?.text;

        if (!senderId || !messageText) continue;
        if (event.message?.is_echo) continue;

        console.log(`Gelen mesaj [${senderId}]: ${messageText}`);

        const yanit = await claudeYanitAl(messageText);

        // Vitrini göster komutu geldiyse görselleri gönder
        if (yanit.includes('###VITRIN_GOSTER###')) {
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
    console.error('Webhook hatası:', err.message);
  }
});

// ============================================
// CLAUDE API
// ============================================
async function claudeYanitAl(mesaj) {
  try {
    const response = await axios.post(
      'https://api.anthropic.com/v1/messages',
      {
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 500,
        system: SISTEM_PROMPT,
        messages: [{ role: 'user', content: mesaj }],
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
    console.error('Claude hatası:', err.message);
    return 'Şu an bir teknik sorun yaşıyoruz efendim. En kısa sürede size dönüş yapacağız.';
  }
}

// ============================================
// INSTAGRAM METİN MESAJI GÖNDER
// ============================================
async function instagramaMesajGonder(aliciId, mesaj) {
  try {
    await axios.post(
      'https://graph.instagram.com/v21.0/me/messages',
      {
        recipient: { id: aliciId },
        message: { text: mesaj },
      },
      {
        headers: {
          Authorization: `Bearer ${IG_ACCESS_TOKEN}`,
          'Content-Type': 'application/json',
        },
      }
    );
    console.log(`Metin gönderildi: ${aliciId}`);
  } catch (err) {
    console.error('Metin gönderme hatası:', err.message);
  }
}

// ============================================
// INSTAGRAM GÖRSEL GÖNDER
// ============================================
async function instagramaGorselGonder(aliciId, gorselUrl) {
  try {
    await axios.post(
      'https://graph.instagram.com/v21.0/me/messages',
      {
        recipient: { id: aliciId },
        message: {
          attachment: {
            type: 'image',
            payload: {
              url: gorselUrl,
              is_reusable: true,
            },
          },
        },
      },
      {
        headers: {
          Authorization: `Bearer ${IG_ACCESS_TOKEN}`,
          'Content-Type': 'application/json',
        },
      }
    );
    console.log(`Görsel gönderildi: ${gorselUrl}`);
  } catch (err) {
    console.error('Görsel gönderme hatası:', err.message);
  }
}

// Kısa bekleme fonksiyonu (görseller arası)
function bekle(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================
// SUNUCUYU BAŞLAT
// ============================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Bot sunucusu ${PORT} portunda çalışıyor`);
});
Content is user-generated and unverified.
