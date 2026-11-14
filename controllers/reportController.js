const db = require('../config/db');

// 1. Turnaround Time (Filtered by Date)
exports.getTurnaroundTime = async (req, res) => {
    try {
        const [rows] = await db.query(`
            SELECT 
                c.set_id,
                l.location_name as customer_location,
                c.dispatch_time,
                c.returned_at,
                -- Calculate in SECONDS, then divide by 3600 for exact decimal hours
                (TIMESTAMPDIFF(SECOND, c.dispatch_time, c.returned_at) / 3600.0) as hours_out
            FROM containers c
            LEFT JOIN locations l ON c.current_location_id = l.id
            WHERE c.status = 'returned' 
              AND c.returned_at IS NOT NULL 
              AND c.dispatch_time IS NOT NULL 
            ORDER BY c.returned_at DESC
            LIMIT 100
        `);
        
        const totalHours = rows.reduce((sum, row) => sum + parseFloat(row.hours_out || 0), 0);
        
        // Format to 4 decimal places
        const averageHours = rows.length > 0 ? (totalHours / rows.length).toFixed(4) : 0;

        res.json({ data: rows, averageHours });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

// 2. Exception Rate (Filtered by Date)
exports.getExceptionRate = async (req, res) => {
    const { startDate, endDate } = req.query;
    try {
        let query = `
            SELECT DATE(created_at) as date, COUNT(*) as exception_count
            FROM exceptions
            WHERE 1=1
        `;
        let params = [];

        if (startDate && endDate) {
            query += ` AND created_at >= ? AND created_at <= ?`;
            params.push(`${startDate} 00:00:00`, `${endDate} 23:59:59`);
        } else {
            // Default to last 30 days
            query += ` AND created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)`;
        }

        query += ` GROUP BY DATE(created_at) ORDER BY date ASC`;

        const [rows] = await db.query(query, params);
        res.json(rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
};

// 3. Location-wise Stock (Breakdown by Component Type)
exports.getLocationStock = async (req, res) => {
    try {
        // Break down by location and component type
        const [components] = await db.query(`
            SELECT l.location_name, c.type as component_type, COUNT(c.id) as quantity
            FROM components c
            JOIN locations l ON c.current_location_id = l.id
            GROUP BY l.id, c.type
            ORDER BY l.location_name, quantity DESC
        `);

        const [containers] = await db.query(`
            SELECT l.location_name, COUNT(c.id) as total_sets
            FROM containers c
            JOIN locations l ON c.current_location_id = l.id
            GROUP BY l.id
        `);

        res.json({ components, containers });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};