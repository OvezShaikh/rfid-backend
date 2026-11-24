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
            SELECT l.location_name, c.type as component_type, COUNT(c.asset_id) as quantity
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


// 4. Stuck in Transit (Delayed Dispatches)
exports.getStuckInTransit = async (req, res) => {
    try {
        const [rows] = await db.query(`
            SELECT 
                dc.challan_no, 
                dc.vehicle_no, 
                l.location_name as destination,
                dc.created_at as dispatch_time,
                TIMESTAMPDIFF(HOUR, dc.created_at, NOW()) as hours_stuck
            FROM delivery_challans dc
            LEFT JOIN locations l ON dc.to_location_id = l.id
            WHERE dc.status = 'dispatched' 
              AND dc.from_location_id != dc.to_location_id -- ✅ EXCLUDE SAME LOCATION TRANSFERS
              AND dc.created_at < NOW() - INTERVAL 24 HOUR
            ORDER BY dc.created_at ASC
        `);
        res.json(rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
};

// 5. Daily Movement (Scan Logs Summary)
exports.getDailyMovement = async (req, res) => {
    const { startDate, endDate } = req.query;
    try {
        let query = `
            SELECT 
                DATE(created_at) as date,
                action_type,
                COUNT(DISTINCT tag_id) as unique_tags,
                COUNT(DISTINCT vehicle_no) as vehicles
            FROM scan_logs 
            WHERE 1=1
        `;
        let params = [];
        if (startDate && endDate) {
            query += ` AND created_at >= ? AND created_at <= ?`;
            params.push(`${startDate} 00:00:00`, `${endDate} 23:59:59`);
        } else {
            query += ` AND created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)`;
        }
        query += ` GROUP BY DATE(created_at), action_type ORDER BY date ASC`;
        
        const [rows] = await db.query(query, params);
        res.json(rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
};

// 6. Operator Overrides / Exceptions (Audit Logs)
exports.getAuditExceptions = async (req, res) => {
    const { startDate, endDate } = req.query;
    try {
        let query = `
            SELECT 
                al.action_type, 
                al.entity_id as challan_no, -- ✅ Alias so frontend still works
                al.details, 
                al.created_at,
                COALESCE(u.username, 'System') as operator_name
            FROM audit_logs al
            LEFT JOIN users u ON al.user_id = u.id
            WHERE 1=1
        `;
        let params = [];
        if (startDate && endDate) {
            query += ` AND al.created_at >= ? AND al.created_at <= ?`;
            params.push(`${startDate} 00:00:00`, `${endDate} 23:59:59`);
        } else {
            query += ` AND al.created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)`;
        }
        query += ` ORDER BY al.created_at DESC LIMIT 100`;
        
        const [rows] = await db.query(query, params);
        
        // Since details is JSON, let's parse it for the frontend so it doesn't show [object Object]
        const parsedRows = rows.map(r => ({
            ...r,
            details: typeof r.details === 'string' ? JSON.parse(r.details)?.message || r.details : r.details?.message || JSON.stringify(r.details)
        }));

        res.json(parsedRows);
    } catch (err) { res.status(500).json({ error: err.message }); }
};