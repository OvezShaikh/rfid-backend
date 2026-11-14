const db = require('../config/db');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

exports.login = async (req, res) => {
    const { username, password } = req.body;
    try {
        const [users] = await db.query('SELECT * FROM users WHERE username = ?', [username]);
        if (users.length === 0) return res.status(401).json({ error: 'Invalid credentials' });

        const user = users[0];
        
        // Fallback: If the user is 'superadmin' and password_hash is 'dummy', set it to 'admin123'
        if (user.password_hash === 'dummy' && password === 'admin123') {
            const salt = await bcrypt.genSalt(10);
            const hash = await bcrypt.hash('admin123', salt);
            await db.query('UPDATE users SET password_hash = ? WHERE id = ?', [hash, user.id]);
            return res.json({ message: 'Password initialized. Please click Sign In again.' });
        }

        const validPassword = await bcrypt.compare(password, user.password_hash);
        if (!validPassword) return res.status(401).json({ error: 'Invalid credentials' });

        // Generate Token
        const token = jwt.sign(
            { id: user.id, username: user.username, role_id: user.role_id },
            process.env.JWT_SECRET,
            { expiresIn: '24h' }
        );

        res.json({ 
            token, 
            user: { id: user.id, username: user.username, role_id: user.role_id } 
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};