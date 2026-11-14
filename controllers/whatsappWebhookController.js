// backend/controllers/whatsappWebhookController.js
const { processChatQuery } = require('../utils/chatEngine');

exports.verifyWebhook = (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
};

exports.handleWebhook = async (req, res) => {
  res.sendStatus(200); // Always respond 200 to Meta immediately

  try {
    const entry = req.body.entry?.[0];
    const changes = entry?.changes?.[0];
    const message = changes?.value?.messages?.[0];

    if (message && message.type === 'text') {
      const senderPhone = message.from;
      const userText = message.text.body;

      // Call the EXACT SAME brain used by the frontend
      const replyText = await processChatQuery(userText);

      // Send back to WhatsApp using Native Fetch (No axios needed!)
      await fetch(
        `https://graph.facebook.com/v20.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            to: senderPhone,
            type: 'text',
            text: { body: replyText }
          })
        }
      );
    }
  } catch (err) {
    console.error('WhatsApp Webhook Error:', err);
  }
};