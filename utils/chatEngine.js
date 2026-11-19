const db = require('../config/db');

async function processChatQuery(message) {
  const text = (message || '').trim().toLowerCase();

  try {
    const idMatch = (message || '').match(/\b(?=[A-Z0-9_-]*\d)([A-Z][A-Z0-9]*(?:[-_][A-Z0-9]+)*)\b/i);

    if (idMatch) {
      const searchId = idMatch[1].toUpperCase();

      // ── Try containers first (set_id) ──
      const [sets] = await db.query(`
        SELECT c.set_id, c.status, c.dispatch_time, l.location_name, c.vehicle_type
        FROM containers c LEFT JOIN locations l ON c.current_location_id = l.id
        WHERE c.set_id = ? LIMIT 1
      `, [searchId]);

      if (sets.length) {
        const s = sets[0];
        const emoji = s.status === 'dispatched' ? '🚚' : s.status === 'assembled' ? '🛠️' : '📍';
        
        // 🎨 STRUCTURED BOT REPLY
        let reply = `${emoji} *SET STATUS: ${s.set_id}*\n`;
        reply += `━━━━━━━━━━━━━━━━━━\n`;
        reply += `📍 *Location:* ${s.location_name || 'Unknown'}\n`;
        reply += `📦 *Status:* ${s.status.toUpperCase()}\n`;
        reply += `🏍️ *Vehicle:* ${s.vehicle_type}\n`;
        if (s.dispatch_time) {
          reply += `⏱️ *Dispatched:* ${new Date(s.dispatch_time).toLocaleString('en-GB')}\n`;
        }
        return reply;
      }

      // ── Try components ──
      const [assets] = await db.query(`
        SELECT c.asset_id, c.type, c.status, c.rfid_tag_id, c.set_id, l.location_name
        FROM components c LEFT JOIN locations l ON c.current_location_id = l.id
        WHERE c.asset_id = ? OR c.rfid_tag_id = ? LIMIT 1
      `, [searchId, searchId]);

      if (assets.length) {
        const a = assets[0];
        
        // 🎨 STRUCTURED BOT REPLY (Cleaned up)
        let reply = `🏷️ *COMPONENT DETAILS*\n`;
        reply += `━━━━━━━━━━━━━━━━━━\n`;
        reply += `🔖 ID: ${a.asset_id}\n`;
        reply += `⚙️ Type: ${a.type}\n`;
        reply += `📡 RFID Tag: ${a.rfid_tag_id}\n`; // No asterisks here, so it renders cleanly
        reply += `📍 Location: ${a.location_name || 'Unknown'}\n`;
        reply += `📊 Status: ${a.status.toUpperCase()}\n`;
        reply += `🔗 In Set: ${a.set_id ? a.set_id : '— (Loose Component)'}\n`;
        return reply;
      }

      return `❌ *Not Found*\n\nSorry, no set or component found matching *${searchId}*.\n\nTry a set ID (FLC-M-8869) or component ID (PAD-TRK-02_B).`;
    }

    // ── Exceptions ──
    if (text.includes('exception') || text.includes('missing')) {
      const [exceptions] = await db.query(`SELECT exception_id, set_id, reason FROM exceptions WHERE status = 'open' LIMIT 10`);
      
      if (!exceptions.length) return "✅ *All Clear!*\n\nThere are currently no open exceptions. Everything is running smoothly! 🎉";
      
      let reply = `🚨 *OPEN EXCEPTIONS (${exceptions.length})*\n`;
      reply += `━━━━━━━━━━━━━━━━━━\n`;
      exceptions.forEach(e => {
        reply += `⚠️ *${e.exception_id}* (Set: ${e.set_id})\n`;
        reply += `📝 _${e.reason}_\n\n`;
      });
      return reply;
    }

    // ── Default ──
    return `🤖 *Unostar RFID Assistant*\n\nI can help you track assets. Try typing:\n\n🔍 1. "Where is FLC-M-8869?"\n📦 2. "Status of PAD0050"\n🚨 3. "Show open exceptions"`;

  } catch (err) {
    console.error('Chat engine error:', err);
    return "⚠️ *System Error*\n\nSorry, I encountered an error querying the database.";
  }
}

module.exports = { processChatQuery };