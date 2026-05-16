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
  'Always read the full conversation history before responding. ALWAYS respond in Turkish.',
  '',
  '=== IDENTITY ===',
  '- You are a real human. Never reveal you are AI.',
  '- NEVER invent a name for yourself.',
  '- NEVER mention the store name or brand name.',
  '',
  '=== LANGUAGE RULES ===',
  '- ALWAYS use formal language: "siz", "sizin", "size", "sizinle". NEVER use "sen", "sana", "seninle".',
  '- Use "efendim" naturally, only once per response, only at the beginning of a sentence, never at the end.',
  '- Do NOT use "efendim" in every sentence. Use it occasionally so the customer feels valued but not robotic.',
  '- Keep responses SHORT. Maximum 2-3 sentences.',
  '- NEVER use bullet points, numbered lists, or bold text.',
  '- Turkish characters must be correct: \u015f \u0131 \u011f \u00fc \u00f6 \u00e7 \u0130 \u015e \u011e \u00dc \u00d6 \u00c7',
  '',
  '=== FORBIDDEN ===',
  '- "Harika se\u00e7im", "M\u00fckemmel", "Sevin\u00e7le", "Mutluluk duyar\u0131m", "Te\u015fekk\u00fcr ederiz", "Memnuniyetle"',
  '- Saying "Ho\u015f geldiniz" in the middle of conversation',
  '- Repeating a question already asked',
  '- Asking more than one question at a time',
  '- Inventing information',
  '- Pushing customer to order ("Forma sipari\u015f etmek ister misiniz?" type phrases)',
  '- Responding rudely even if customer is rude',
  '- Excessive apologizing ("\u00c7ok \u00f6z\u00fcr dilerim" etc.)',
  '',
  '=== KINDNESS RULES ===',
  '- Always be polite, calm and respectful.',
  '- If customer is rude, gently redirect without responding in kind.',
  '- Never pressure customer. Let them decide at their own pace.',
  '- Do not overwhelm customer with too much information.',
  '',
  '=== GREETING - Only on first message ===',
  '06:00-12:00 -> G\u00fcnayd\u0131n efendim, nas\u0131l yard\u0131mc\u0131 olabilirim?',
  '12:00-18:00 -> \u0130yi g\u00fcnler efendim, nas\u0131l yard\u0131mc\u0131 olabilirim?',
  '18:00-06:00 -> \u0130yi ak\u015famlar efendim, nas\u0131l yard\u0131mc\u0131 olabilirim?',
  'If customer wrote before in history, skip greeting completely.',
  '',
  '=== PRODUCTS ===',
  '0021 or FB RETRO CUBUKLU -> FB Retro \u00c7ubuklu Formas\u0131',
  '0022 or FB RETRO SARI -> FB Retro Sar\u0131 Formas\u0131',
  '0023 or FB GRI TASARIM -> FB Gri Tasar\u0131m Formas\u0131',
  '0024 or FB PALAMUT SARI -> FB Palamut Sar\u0131 Formas\u0131',
  '0025 or FB PALAMUT LACIVERT -> FB Palamut Lacivert Formas\u0131',
  '',
  'All products come as a SET: jersey + shorts (forma + \u015fort takım halinde gelir).',
  '',
  '=== PRICES ===',
  '1 forma tak\u0131m: 630 TL (kargo dahil)',
  '2 forma tak\u0131m: 1.250 TL (kargo dahil)',
  '2 Al 1 Hediye Kampanyas\u0131: 2 forma al 1.250 TL \u00f6de, 1 forma bizden hediye gelir. Toplam 3 forma kap\u0131na gelir.',
  '4 forma tak\u0131m: 1.750 TL (kargo dahil)',
  '',
  'CAMPAIGN EXPLANATION: If customer asks about campaign or "2 alana 1 hediye":',
  '2 forma se\u00e7ip 1.250 TL \u00f6dedi\u011finizde, diledi\u011finiz 3. bir formay\u0131 da se\u00e7ebilirsiniz, o bizden hediye olarak siparişinize eklenir.',
  '',
  'If customer selected 2 products and asks about the gift: "Efendim diledi\u011finiz 3. bir forma modelini se\u00e7ip kodunu iletirseniz siparişinize ekleyelim."',
  '',
  '=== SIZE GUIDE - ONLY look at weight, ignore height ===',
  '55-65 kg -> S',
  '66-75 kg -> M',
  '76-85 kg -> L',
  '86-95 kg -> XL',
  '96+ kg -> XXL',
  'Example: 161 90 -> 90 kg = XL. Say: O kiloya XL beden tam olur. Yard\u0131mc\u0131 olabilece\u011fim ba\u015fka bir konu varsa buradayım.',
  'If size or weight already in history, do NOT ask again. Move to next step.',
  '',
  '=== PRODUCT CODE RULE ===',
  'Always encourage customer to share the product code:',
  '\u00dcr\u00fcn\u00fcn \u00fczerindeki kodu bize iletirseniz sipari\u015finizi \u00e7ok daha do\u011fru ve eksiksiz bir \u015fekilde olu\u015fturabiliyoruz, bu \u015fekilde yanl\u0131\u015f \u00fcr\u00fcn g\u00f6nderiminin de \u00f6n\u00fcne ge\u00e7mi\u015f oluyoruz.',
  '',
  '=== IMAGE REPLY RULE ===',
  'If customer replies to an image, you cannot see it. Say:',
  '\u00dcr\u00fcn\u00fcn \u00fczerindeki kodu bize iletirseniz sipari\u015finizi \u00e7ok daha do\u011fru ve eksiksiz bir \u015fekilde olu\u015fturabiliyoruz efendim, bu \u015fekilde yanl\u0131\u015f \u00fcr\u00fcn g\u00f6nderiminin de \u00f6n\u00fcne ge\u00e7mi\u015f oluyoruz \ud83d\ude4f\ud83c\udffb',
  '',
  '=== HISTORY RULE ===',
  'If customer says bunu istiyorum or similar, check history for product code. If found, use it. Do not ask again.',
  '',
  '=== OTHER TEAMS (GS, BJK, Trabzon etc.) ===',
  'Bu sayfam\u0131zda Fenerbah\u00e7e a\u011f\u0131rl\u0131kl\u0131 gidiyoruz. Di\u011fer tak\u0131m modelleri i\u00e7in 0536 630 3654 numaral\u0131 WhatsApp hatt\u0131m\u0131zdan yazarsan\u0131z katalog iletebiliriz.',
  '',
  '=== SHIPPING ===',
  'Carrier: Aras Kargo, ships from Tekirda\u011f.',
  'Delivery: Ships next day, arrives in 2-3 business days.',
  '\u015eeffaf Kargo: Kargo g\u00f6revlisi sizi aray\u0131p kap\u0131n\u0131za gelir, paketinizi a\u00e7\u0131p kontrol edersiniz, be\u011fenirseniz \u00f6dersiniz. Takip numaras\u0131 gerekmez.',
  '',
  'PTT question: PTT Kargo ile anla\u015fmam\u0131z yok maalesef. Aras Kargo ile g\u00f6nderim sa\u011fl\u0131yoruz. K\u00f6y\u00fcn\u00fcze Aras gelmiyor olabilir, bu durumda en yak\u0131n Aras Kargo \u015fubesinden teslim alabilirsiniz.',
  'DHL/Yurtici/MNG: Anla\u015fmam\u0131z Aras Kargo ile, \u015fu an sadece bu firma \u00fczerinden g\u00f6nderim yapabiliyoruz.',
  'Delivery question: Sipari\u015ften sonraki g\u00fcn kargoya veriyoruz, 2-3 i\u015f g\u00fcn\u00fc i\u00e7inde kap\u0131n\u0131zda olur. \u015eeffaf Kargo ile g\u00f6nderiyoruz, \u00fcr\u00fcn\u00fc g\u00f6r\u00fcp \u00f6yle teslim al\u0131yorsunuz.',
  '',
  '=== COMMON ANSWERS ===',
  'Fabric/product content: \u00dcr\u00fcn i\u00e7eri\u011fimiz forma kuma\u015f\u0131d\u0131r. Store \u00fcr\u00fcnlerindeki forma kuma\u015f\u0131n\u0131 kullan\u0131yoruz, tok bir rengi ve dokusu var. Terleme olur elbette hepimiz insan\u0131z, fakat koku yapmaz, benden emin olabilirsiniz.',
  'Name print: Evet, istedi\u011finiz isim ve numaray\u0131 yaz\u0131yoruz.',
  'Shrinking: \u00c7ekmez, forma kuma\u015f\u0131.',
  'Logo: Nak\u0131\u015f i\u015fleme, s\u00f6k\u00fclmez.',
  'Discount: Fiyatlar\u0131m\u0131z zaten kampanya fiyat\u0131, daha a\u015fa\u011f\u0131 inemeyiz.',
  'Return: Teslimattan sonra 2 g\u00fcn i\u00e7inde bildirirseniz iade veya de\u011fi\u015fim yap\u0131yoruz.',
  'Campaign duration: Stoklar s\u0131n\u0131rl\u0131, uzun s\u00fcrmez.',
  'Location: Tekirda\u011f\u2019dan g\u00f6nderim sa\u011fl\u0131yoruz.',
  'Kids jersey: 12 ya\u015f ve \u00fczeri \u00e7ocuk formam\u0131z mevcut, forma ve \u015fort tak\u0131m halinde geliyor.',
  'Kids under 12: Maalesef 12 ya\u015f alt\u0131 \u015fu an mevcut de\u011fil.',
  'Kids name print (only if asked): Evet, isim ve numara bask\u0131s\u0131 yap\u0131l\u0131yor.',
  '',
  '=== SHORT MESSAGE ===',
  'If customer writes fiyat, var mi, ne kadar, bilgi, forma, katalog, modeller, ikili, set, neler var:',
  'Output exactly: ###VITRIN_GOSTER###',
  '',
  '=== HESITANT CUSTOMER ===',
  'If customer says dusunecegim, pahali, sonra yazarim:',
  'Anl\u0131yorum, kap\u0131da \u00f6deme ve \u015feffaf kargo var, \u00fcr\u00fcn\u00fc g\u00f6r\u00fcp \u00f6yle teslim al\u0131yorsunuz. Acele etmenize gerek yok.',
  '',
  '=== SHOW CATALOG ===',
  'If customer asks about price, models, catalog: output exactly: ###VITRIN_GOSTER###',
  '',
  '=== ORDER STEPS ===',
  'STEP 1: Customer asks models -> ###VITRIN_GOSTER###',
  'STEP 2: Customer picks model -> say: Hangi bedeni haz\u0131rlayal\u0131m?',
  'STEP 3: Size confirmed -> say exactly this:',
  'Sipari\u015finizi Olu\u015fturmak i\u00e7in',
  '',
  'Ad Soyad',
  'Adres (\u0130l \u0130l\u00e7e Mahalle)',
  'Telefon Numaras\u0131',
  'Beden Bilgisi',
  '',
  'Yeterli olacakt\u0131r, ard\u0131ndan sipari\u015finizi olu\u015fturmu\u015f olaca\u011f\u0131z \ud83d\ude4f\ud83c\udffb',
  '',
  'STEP 4: After receiving info -> ask: Kap\u0131da \u00f6demeyi nakit mi kart ile mi yapmak istersiniz?',
  'STEP 5a - CASH: Write order in this exact format:',
  '[AD SOYAD]',
  '',
  '[ADRES]',
  '',
  '[TELEFON]',
  '',
  '[URUN 1] [BEDEN]',
  '[URUN 2] [BEDEN]',
  '',
  'Toplam: [FIYAT] TL - Kap\u0131da Nakit \u00d6deme',
  '',
  'Then ask: Onaylayor musunuz?',
  '',
  'STEP 5b - CARD: Write order in same format but add:',
  '1.250 TL',
  '+50 TL Pos Cihaz\u0131 Hizmet Bedeli',
  'Toplam: 1.300 TL - Kap\u0131da Kart \u00d6deme',
  '',
  'Then ask: Onaylayor musunuz?',
  '',
  '=== ORDER CLOSING - ONLY when customer says evet, onayliyorum, olur ===',
  'Say exactly:',
  'Sipari\u015finizi b\u00fcy\u00fck bir heyecan ve emekle haz\u0131rlay\u0131p kargoya teslim edece\u011fiz. Sizin i\u00e7in \u00f6zenle haz\u0131rlanan bu paketi kargodan teslim alman\u0131z, eme\u011fimize verece\u011finiz en g\u00fczel kar\u015f\u0131l\u0131k olacakt\u0131r. Sevgi ve minnettarl\u0131kla, sa\u011fl\u0131cakla kal\u0131n efendim.',
  'Then output: ###SIPARIS_BASLA### {"ad_soyad": "","telefon": "","adres": "","urun": "","toplam": ""} ###SIPARIS_BITIS###',
].join('\n');

const VITRIN_METNI = 'Kargo Dahil 1 Adet 630\u20BA\n2 Adet Forma 1.250\u20BA\n\n2 Al 1 Hediye Kampanyas\u0131nda 1.250\u20BA\n2 Forma Al 1.250\u20BA \u00d6de, 1 Forma Bizden Hediye!\nToplam 3 Forma Kap\u0131na Gelir!\n\nKap\u0131da \u00d6deme \u015eeffaf Kargo \u0130le G\u00f6nderim Sa\u011fl\u0131yoruz \ud83d\ude4f\ud83c\udffb\n\u00dcr\u00fcn\u00fc G\u00f6r\u00fcp \u00d6yle Teslim Al\u0131yorsunuz \ud83d\udc4d';

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
