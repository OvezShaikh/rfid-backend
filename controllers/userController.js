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

// 5. Update OWN Profile (For the logged-in user)
exports.updateOwnProfile = async (req, res) => {
    const { username } = req.body;
    const userId = req.user.id;

    if (!username || username.trim() === '') {
        return res.status(400).json({ error: 'Username cannot be empty.' });
    }

    try {
        // Check if the new username is already taken by someone else
        const [existing] = await db.query('SELECT id FROM users WHERE username = ? AND id != ?', [username, userId]);
        if (existing.length > 0) return res.status(400).json({ error: 'Username is already taken.' });

        await db.query('UPDATE users SET username = ? WHERE id = ?', [username, userId]);
        
        // Fetch updated user data to send back to frontend
        const [updatedUser] = await db.query(`
            SELECT u.id, u.username, u.role_id, r.name as role_name 
            FROM users u JOIN roles r ON u.role_id = r.id 
            WHERE u.id = ?
        `, [userId]);

        res.json({ success: true, message: 'Profile updated', user: updatedUser[0] });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

// 6. Change OWN Password (For the logged-in user)
exports.updateOwnPassword = async (req, res) => {
    const { currentPassword, newPassword } = req.body;
    const userId = req.user.id;

    if (!currentPassword || !newPassword) {
        return res.status(400).json({ error: 'Please provide current and new passwords.' });
    }

    if (newPassword.length < 6) {
        return res.status(400).json({ error: 'New password must be at least 6 characters.' });
    }

    try {
        const [users] = await db.query('SELECT password_hash FROM users WHERE id = ?', [userId]);
        if (users.length === 0) return res.status(404).json({ error: 'User not found.' });

        // Verify current password
        const isMatch = await bcrypt.compare(currentPassword, users[0].password_hash);
        if (!isMatch) return res.status(400).json({ error: 'Incorrect current password.' });

        // Hash and save new password
        const salt = await bcrypt.genSalt(10);
        const hash = await bcrypt.hash(newPassword, salt);

        await db.query('UPDATE users SET password_hash = ? WHERE id = ?', [hash, userId]);
        
        res.json({ success: true, message: 'Password updated successfully.' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};