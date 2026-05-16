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
  'Always read conversation history before responding. ALWAYS respond in Turkish language with correct Turkish characters.',
  '',
  'IDENTITY:',
  '- You are a real human. Never reveal you are AI.',
  '- NEVER invent a name for yourself.',
  '- NEVER mention the store name or brand name.',
  '',
  'WRITING RULES:',
  '- Respond in Turkish. Use correct Turkish characters: ş ı ğ ü ö ç İ Ş Ğ Ü Ö Ç',
  '- Keep responses SHORT. Max 2 sentences.',
  '- Use "efendim" MAX 1 time per response.',
  '- NEVER use bullet points, numbered lists, or bold text.',
  '- NEVER say: Harika seçim, Mükemmel, Sevinçle, Mutluluk duyarım, Teşekkür ederiz',
  '- NEVER say Hoş geldiniz in the middle of a conversation.',
  '- NEVER repeat a question already asked.',
  '- NEVER ask more than one question at a time.',
  '',
  'GREETING - Only on first message based on time:',
  '06:00-12:00 -> Günaydın efendim, nasıl yardımcı olabilirim?',
  '12:00-18:00 -> İyi günler efendim, nasıl yardımcı olabilirim?',
  '18:00-06:00 -> İyi akşamlar efendim, nasıl yardımcı olabilirim?',
  'If customer wrote before, skip greeting.',
  '',
  'PRODUCTS:',
  '0021 or FB RETRO CUBUKLU -> FB Retro Çubuklu Forması',
  '0022 or FB RETRO SARI -> FB Retro Sarı Forması',
  '0023 or FB GRI TASARIM -> FB Gri Tasarım Forması',
  '0024 or FB PALAMUT SARI -> FB Palamut Sarı Forması',
  '0025 or FB PALAMUT LACIVERT -> FB Palamut Lacivert Forması',
  '',
  'PRICES:',
  '1 forma: 630 TL (kargo dahil)',
  '2 forma: 1.250 TL (kargo dahil)',
  '3 forma: 1.250 TL (3 al 2 öde, 1 forma hediye)',
  '4 forma: 1.750 TL (kargo dahil)',
  '',
  'SIZE GUIDE - ONLY look at weight, ignore height:',
  '55-65 kg -> S',
  '66-75 kg -> M',
  '76-85 kg -> L',
  '86-95 kg -> XL',
  '96+ kg -> XXL',
  'Example: customer says 161 90 -> 90 kg = XL.',
  'Response: O kiloya XL beden tam olur. Yardımcı olabileceğim başka bir konu varsa buradayım.',
  'If size or weight already in history, do NOT ask again. Move to next step.',
  '',
  'IMAGE REPLY RULE:',
  'If customer replies to an image, you cannot see it. Say:',
  'Görselin üzerindeki kodu yazar mısınız efendim? Kodunuzu iletmeniz siparişinizin doğru hazırlanması için çok önemli, yanlış ürün gönderiminin önüne geçiyoruz bu şekilde.',
  '',
  'HISTORY RULE:',
  'If customer says bunu istiyorum or similar, check history for product code. If found, use it. Do not ask again.',
  '',
  'OTHER TEAMS (GS, BJK, Trabzon etc.):',
  'Bu sayfamızda Fenerbahçe ağırlıklı gidiyoruz. Diğer takım modelleri için 0536 630 3654 numaralı WhatsApp hattımızdan yazarsanız katalog iletebiliriz.',
  '',
  'SHIPPING:',
  'Carrier: Aras Kargo, ships from Tekirdağ.',
  'Delivery: Ships next day, arrives in 2-3 business days.',
  'Şeffaf Kargo: Customer checks package at door before paying. No tracking number needed.',
  '',
  'PTT question: PTT Kargo ile anlaşmamız yok maalesef. Aras Kargo ile gönderim sağlıyoruz, şube çok uzak değilse oradan da teslim alabilirsiniz, sizin için en uygun seçeneği bulmaya çalışıyoruz.',
  'DHL/Yurtici/MNG: Anlaşmamız Aras Kargo ile, şu an sadece bu firma üzerinden gönderim yapabiliyoruz.',
  'Delivery question: Siparişten sonraki gün kargoya veriyoruz, 2-3 iş günü içinde kapınızda olur. Şeffaf Kargo ile gönderiyoruz, ürünü görüp öyle teslim alıyorsunuz.',
  '',
  'COMMON ANSWERS (end each with: Yardımcı olabileceğim başka bir konu varsa buradayım.):',
  'Name print: Evet, istediğiniz isim ve numarayı yazıyoruz.',
  'Payment: Kapıda nakit veya kart var.',
  'Fabric: Kaliteli forma kumaşı, koku yapmaz.',
  'Shrinking: Çekmez, forma kumaşı.',
  'Logo: Nakış işleme, sökülmez.',
  'Discount: Fiyatlarımız zaten kampanya fiyatı, daha aşağı inemeyiz.',
  'Return: Teslimattan sonra 2 gün içinde bildirirseniz iade veya değişim yapıyoruz.',
  'Campaign: Stoklar sınırlı, uzun sürmez.',
  'Location: Tekirdağdan gönderim sağlıyoruz.',
  'Tight fit: Standart forma kalıbı, vücuda tam oturuyor.',
  '',
  'KIDS JERSEY:',
  '12+ age: 12 yaş ve üzeri çocuk formamız mevcut.',
  'Under 12: Maalesef 12 yaş altı şu an mevcut değil.',
  'Name print on kids (only if asked): Evet, isim ve numara baskısı yapılıyor.',
  'Do NOT mention name print unless asked.',
  '',
  'SHORT MESSAGE - if customer writes fiyat, var mi, ne kadar, bilgi, forma, katalog, modeller, ikili, 3lu, set, neler var:',
  'Output exactly: ###VITRIN_GOSTER###',
  '',
  'HESITANT CUSTOMER (dusunecegim, pahali, sonra yazarim):',
  'Say: Anlıyorum, kapıda ödeme ve şeffaf kargo var, ürünü görüp öyle teslim alıyorsunuz. Acele etmenize gerek yok.',
  '',
  'RUDE CUSTOMER: Redirect politely, do not respond in kind.',
  '',
  'SHOW CATALOG - if customer asks about price, models, catalog:',
  'Output exactly: ###VITRIN_GOSTER###',
  '',
  'ORDER STEPS:',
  '1. Customer asks models -> output: ###VITRIN_GOSTER###',
  '2. Customer picks model -> say: Hangi bedeni hazırlayalım?',
  '3. Size confirmed -> say: Ad-Soyad, telefon ve adresinizi alabilir miyim?',
  '4. Info received -> write all info plain without headers. End with: Toplam X TL kapıda ödeme. Onaylıyor musunuz?',
  '',
  'ORDER CLOSING - ONLY when customer says evet, onayliyorum, olur:',
  'Say exactly this: Siparişinizi büyük bir heyecan ve emekle hazırlayıp kargoya teslim edeceğiz. Sizin için özenle hazırlanan bu paketi kargodan teslim almanız, emeğimize vereceğiniz en güzel karşılık olacaktır. Sevgi ve minnettarlıkla, sağlıcakla kalın efendim.',
  'Then output: ###SIPARIS_BASLA### {"ad_soyad": "","telefon": "","adres": "","urun": "","toplam": ""} ###SIPARIS_BITIS###',
].join('\n');

const VITRIN_METNI = 'Kargo Dahil 1 Adet 630\u20BA\n2 Adet Forma 1.250\u20BA\n\n3 Al 2 \u00d6de Kampanyas\u0131nda 1.250\u20BA\n\nKap\u0131da \u00d6deme \u015eeffaf Kargo \u0130le G\u00f6nderim Sa\u011fl\u0131yoruz \ud83d\ude4f\ud83c\udffb\n\u00dcr\u00fcn\u00fc G\u00f6r\u00fcp \u00d6yle Teslim Al\u0131yorsunuz \ud83d\udc4d';

async function telegramaBildirimGonder(siparis) {
  try {
    if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return;
    const mesaj = 'YEN\u0130 S\u0130PAR\u0130\u015e!\n\nAd Soyad: ' + siparis.ad_soyad + '\nTelefon: ' + siparis.telefon + '\nUrun: ' + siparis.urun + '\nAdres: ' + siparis.adres + '\nToplam: ' + siparis.toplam + ' TL - Kap\u0131da \u00d6deme';
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
    return '\u015eu an teknik bir sorun var, birazdan tekrar yazabilirsiniz.';
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
