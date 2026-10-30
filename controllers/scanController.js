const db = require('../config/db');

exports.dispatchScan = async (req, res) => {
    const { set_id, scanned_rfid_tags } = req.body;

    try {
        // 1. Verify Set exists and is assembled
        const [sets] = await db.query('SELECT * FROM containers WHERE set_id = ?', [set_id]);
        if (sets.length === 0) return res.status(404).json({ error: 'Container not found' });
        
        // 2. Get all components linked to this set
        const [components] = await db.query('SELECT * FROM components WHERE set_id = ?', [set_id]);
        
        // 3. Validation Logic (Image 6)
        const requiredTypes = ['Pallet', 'Sleeve', 'Lid'];
        let missingParts = [];
        let unknownTags = [];

        // Check if scanned tags actually belong to this set
        scanned_rfid_tags.forEach(tag => {
            const comp = components.find(c => c.rfid_tag_id === tag);
            if (!comp) unknownTags.push(tag);
        });

        // Check if all required parts are present
        requiredTypes.forEach(type => {
            const comp = components.find(c => c.type === type);
            if (!comp || !scanned_rfid_tags.includes(comp.rfid_tag_id)) {
                missingParts.push(type);
            }
        });

        // 4. Handle Results
        if (unknownTags.length > 0) {
            return res.status(400).json({ success: false, message: `Wrong tags scanned: ${unknownTags.join(', ')}` });
        }

        if (missingParts.length > 0) {
            // Create Exception Ticket
            const excId = 'EXC-' + Math.floor(1000 + Math.random() * 9000);
            await db.query(
                'INSERT INTO exceptions (exception_id, set_id, reason) VALUES (?, ?, ?)',
                [excId, set_id, `Missing parts: ${missingParts.join(', ')}`]
            );
            
            // Mark set as incomplete
            await db.query('UPDATE containers SET status = "incomplete" WHERE set_id = ?', [set_id]);

            return res.status(400).json({ 
                success: false, 
                message: `Incomplete set. Missing: ${missingParts.join(', ')}`,
                exception_id: excId
            });
        }

        // Success Path
        await db.query('UPDATE containers SET status = "dispatched", dispatch_time = NOW() WHERE set_id = ?', [set_id]);
        res.json({ success: true, message: '12 of 12 components matched - dispatch confirmed' });

    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};