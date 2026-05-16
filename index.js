const express = require('express');
const axios = require('axios');
const app = express();

app.use(express.json());

const VERIFY_TOKEN = process.env.VERIFY_TOKEN || 'formataha2024';
const CLAUDE_API_KEY = process.env.CLAUDE_API_KEY;
const IG_ACCESS_TOKEN = process.env.IG_ACCESS_TOKEN;

const FORMA_GORSELLERI = {
  '0021': 'https://res.cloudinary.com/dzfiyamng/image/upload/v1778891830/BJK_BEYAZ_RETRO_vybc1r.jpg',
  '0022': 'https://res.cloudinary.com/dzfiyamng/image/upload/v1778891832/BJK_BEYAZ_RETRO_pumkjo.jpg',
  '0023': 'https://res.cloudinary.com/dzfiyamng/image/upload/v1778891832/BJK_BEYAZ_RETRO_vtectc.jpg',
  '0024': 'https://res.cloudinary.com/dzfiyamng/image/upload/v1778891833/BJK_BEYAZ_RETRO_iybbwa.jpg',
  '0025': 'https://res.cloudinary.com/dzfiyamng/image/upload/v1778891832/BJK_BEYAZ_RETRO_oaxlkt.jpg',
};

const TUM_GORSELLER = Object.values(FORMA_GORSELLERI);

const SISTEM_PROMPT = `Sen formam.premium.tr magazasinin nazik, resmi ve profesyonel satis danismanisın. Robotik sistemlerden nefret edersin. Tavrin; daima saygili ve Efendim diyerek hitap eden, cozum odakli bir butik asistani tarzinda olmali. Dustum, Kanka gibi laubali kelimeler YASAKTIR.

YAZIM KURALLARI:
- Instagram DM yazistigini unutma. Cevaplar kisa ve net olmali.
- Kalin yazi, madde listesi YASAKTIR.
- Sohbeti uzatan sorular YASAKTIR. Cevabini ver ve sus.
- Izin verilen emojiler: 👍 🙏🏻 🎁

URUN KATALOGU:
- 0021 veya FB RETRO CUBUKLU -> FB Retro Cubuklu Formasi
- 0022 veya FB RETRO SARI -> FB Retro Sari Formasi
- 0023 veya FB GRI TASARIM -> FB Gri Tasarim Formasi
- 0024 veya FB PALAMUT SARI -> FB Palamut Sari Formasi
- 0025 veya FB PALAMUT LACIVERT -> FB Palamut Lacivert Formasi

SPESIFIK SORULAR:
- Beden sorulursa: Boy ve kilonuzu soyleyin, beden onereyim.
- Isim baskisi: Evet efendim, istediginiz isim ve numarayi yazdirabiliriz.
- Odeme: Kapida odeme nakit veya kredi karti mevcuttur efendim.
- Kumas: Orijinal kalitede forma kumasi, koku yapmaz efendim.
- Cekme: Kesinlikle cekmez efendim.
- Arma/Logo: Nakis isleme, sokulme yapmaz efendim.
- Indirim: En dip fiyat budur efendim.

VITRIN SABLON - Musteri fiyat veya model sorarsa SADECE su komutu yaz:
###VITRIN_GOSTER###

KARGO (sadece sorulursa): Yerimiz Tekirdag'dadir efendim. 81 ile Aras Kargo ile seffaf kargo ve kapida odeme ile gonderim sagliyoruz.

BEDEN TABLOSU (sadece kiloya bak):
- 55-65 kg -> S
- 66-75 kg -> M
- 76-85 kg -> L
- 86-95 kg -> XL
- 96+ kg -> XXL

SATIS ADIMLARI:
1. Vitrin: ###VITRIN_GOSTER### yaz
2. Beden sor: S M L XL XXL hangi beden efendim?
3. Adres iste: Ad-Soyad, Telefon ve Tam Adres yazar misiniz efendim?
4. Onay: Bilgileri alt alta yaz, Toplam X TL Kapida Odeme. Onayliyor musunuz efendim?

SIPARIS KAPANIS (sadece Evet/Onayliyorum dediginde):
Siparisınizi buyuk bir heyecanla hazirlayip kargoya teslim edecegiz. Sagligla Kalin Efendim 🙏🏻

###SIPARIS_BASLA###
{"ad_soyad": "","telefon": "","adres": "","urun": "","toplam": ""}
###SIPARIS_BITIS###`;

const VITRIN_METNI = `Kargo Dahil 1 Adet 630TL
2 Adet Forma 1.250TL

3 Al 2 Ode Kampanyasinda 1.250TL

Kapida Odeme Seffaf Kargo Ile Gonderim Sagliyoruz 🙏🏻
Urunu Gorup Oyle Teslim Aliyorsunuz 👍`;

app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    res.status(200).send(challenge);
  } else {
    res.status(403).send('Hatali token');
  }
});

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
        const yanit = await claudeYanitAl(messageText);
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
    console.error('Hata:', err.message);
  }
});

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
    return 'Su an teknik sorun yasiyoruz efendim. En kisa surede donus yapacagiz.';
  }
}

async function instagramaMesajGonder(aliciId, mesaj) {
  try {
    await axios.post(
      'https://graph.instagram.com/v21.0/me/messages',
      { recipient: { id: aliciId }, message: { text: mesaj } },
      { headers: { Authorization: `Bearer ${IG_ACCESS_TOKEN}`, 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    console.error('Mesaj hatasi:', err.message);
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
      { headers: { Authorization: `Bearer ${IG_ACCESS_TOKEN}`, 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    console.error('Gorsel hatasi:', err.message);
  }
}

function bekle(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Bot ${PORT} portunda calisiyor`));
