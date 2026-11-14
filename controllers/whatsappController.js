// backend/controllers/whatsappController.js
const { processChatQuery } = require('../utils/chatEngine');

exports.simulateChat = async (req, res) => {
  const reply = await processChatQuery(req.body.message);
  res.json({ reply });
};