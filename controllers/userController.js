const db = require('../config/db');
const bcrypt = require('bcryptjs');

// 1. Get All Users
exports.getUsers = async (req, res) => {
    try {
        const [users] = await db.query(`
            SELECT u.id, u.username, u.role_id, r.name as role_name, u.created_at 
            FROM users u
            JOIN roles r ON u.role_id = r.id
            ORDER BY u.id ASC
        `);
        res.json(users);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

// 2. Create New User
exports.createUser = async (req, res) => {
    const { username, password, role_id } = req.body;
    
    if (!username || !password || !role_id) {
        return res.status(400).json({ error: 'All fields are required.' });
    }

    try {
        // Check if user exists
        const [existing] = await db.query('SELECT id FROM users WHERE username = ?', [username]);
        if (existing.length > 0) return res.status(400).json({ error: 'Username already exists.' });

        // Hash password
        const salt = await bcrypt.genSalt(10);
        const hash = await bcrypt.hash(password, salt);

        await db.query(
            'INSERT INTO users (username, password_hash, role_id) VALUES (?, ?, ?)',
            [username, hash, role_id]
        );

        res.status(201).json({ success: true, message: 'User created successfully.' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

// 3. Delete User
exports.deleteUser = async (req, res) => {
    const { id } = req.params;
    try {
        // Prevent deleting yourself
        if (parseInt(id) === req.user.id) {
            return res.status(400).json({ error: 'You cannot delete your own account.' });
        }

        // Prevent deleting the original superadmin
        const [targetUser] = await db.query('SELECT username FROM users WHERE id = ?', [id]);
        if (targetUser.length > 0 && targetUser[0].username === 'superadmin') {
            return res.status(400).json({ error: 'Cannot delete the primary system administrator.' });
        }

        await db.query('DELETE FROM users WHERE id = ?', [id]);
        res.json({ success: true, message: 'User deleted.' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

// 4. Update User
exports.updateUser = async (req, res) => {
    const { id } = req.params;
    const { username, password, role_id } = req.body;

    try {
        const [existing] = await db.query('SELECT * FROM users WHERE id = ?', [id]);
        if (existing.length === 0) return res.status(404).json({ error: 'User not found' });

        // Prevent you from changing your own role to something lower
        if (parseInt(id) === req.user.id && role_id !== 1) {
            return res.status(400).json({ error: 'You cannot change your own role.' });
        }

        // Prevent changing the primary superadmin's role
        if (existing[0].username === 'superadmin' && role_id !== 1) {
            return res.status(400).json({ error: 'Cannot change the role of the primary system administrator.' });
        }

        let query = 'UPDATE users SET username = ?, role_id = ?';
        let params = [username, role_id];

        if (password && password.trim() !== '') {
            const bcrypt = require('bcryptjs');
            const salt = await bcrypt.genSalt(10);
            const hash = await bcrypt.hash(password, salt);
            query += ', password_hash = ?';
            params.push(hash);
        }

        query += ' WHERE id = ?';
        params.push(id);

        await db.query(query, params);
        res.json({ success: true, message: 'User updated successfully.' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};