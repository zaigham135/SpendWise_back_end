const express = require("express");
const router = express.Router();
const fs = require("fs");
const multer = require("multer");
const path = require("path");

const verifyToken = require("../middleware/authMiddleware"); // Import auth middleware
const { pool } = require("../db"); // Import pool from db.js
const { BASE_URL } = require("../config"); // Import BASE_URL

// Multer configuration for profile photo uploads
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        const uploadDir = 'uploads';
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir);
        }
        cb(null, uploadDir + '/');
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, 'profile-' + uniqueSuffix + path.extname(file.originalname));
    }
});
const fileFilter = (req, file, cb) => {
    if (!file.originalname.match(/\.(jpg|jpeg|png|gif)$/)) {
        return cb(new Error('Only image files are allowed!'), false);
    }
    cb(null, true);
};
const upload = multer({
    storage: storage,
    fileFilter: fileFilter,
    limits: { fileSize: 5 * 1024 * 1024 } // 5MB limit
});

// Helper to get start/end dates for various summary periods
const getPeriodDates = (period) => {
    const endDate = new Date();
    let startDate = new Date();

    endDate.setHours(23, 59, 59, 999); // End of today

    switch (period) {
        case 'thisMonth':
            startDate = new Date(endDate.getFullYear(), endDate.getMonth(), 1);
            startDate.setHours(0, 0, 0, 0); // Start of the current month
            break;
        case 'last3Months':
            startDate = new Date(endDate.getFullYear(), endDate.getMonth() - 2, 1); // Start of 3 months ago
            startDate.setHours(0, 0, 0, 0);
            break;
        case 'last6Months':
            startDate = new Date(endDate.getFullYear(), endDate.getMonth() - 5, 1); // Start of 6 months ago
            startDate.setHours(0, 0, 0, 0);
            break;
        case 'last12Months':
            startDate = new Date(endDate.getFullYear() - 1, endDate.getMonth(), 1); // Start of 12 months ago
            startDate.setHours(0, 0, 0, 0);
            break;
        default: // Default to a broad range or handle as an error if no period/dates are given
            // If no period is specified, and no fromDate/toDate, default to a very broad range (e.g., last 10 years)
            startDate = new Date(endDate.getFullYear() - 10, endDate.getMonth(), endDate.getDate());
            startDate.setHours(0, 0, 0, 0);
            break;
    }
    return {
        startDate: startDate.toISOString().split('T')[0],
        endDate: endDate.toISOString().split('T')[0]
    };
};


// GET /profile - Fetch user profile data
router.get("/", verifyToken, async (req, res) => {
    const userId = req.user.userId;

    if (!userId) {
        console.error("Error: userId is undefined in /profile GET route.");
        return res.status(401).json({ error: "User ID not found in token payload." });
    }

    let connection;
    try {
        connection = await pool.promise().getConnection();
        const [userRows] = await connection.query('SELECT id, first_name, last_name, email, phone_number, profile_photo FROM users WHERE id = ?', [userId]);

        if (userRows.length === 0) {
            return res.status(404).json({ error: "User not found." });
        }

        const userProfile = userRows[0];
        console.log(`Backend: Fetched profile for user ${userId}:`, userProfile);
        res.json(userProfile);

    } catch (err) {
        console.error("Error fetching user profile:", err);
        res.status(500).json({ error: "Failed to fetch user profile.", details: err.message });
    } finally {
        if (connection) connection.release();
    }
});


router.get("/all-transactions", verifyToken, async (req, res) => {
    const userId = req.user.userId;

    if (!userId) {
        return res.status(401).json({ error: "User ID not found in token payload." });
    }

    let connection;
    try {
        connection = await pool.promise().getConnection();
        // Fetch all items (expenses and incomes) for the user
        const [transactions] = await connection.query(
            `SELECT id, title, value, date, section, payment_mode, notes
             FROM infodata
             WHERE user_id = ?
             ORDER BY date DESC;`, // Order by date to get recent ones
            [userId]
        );

        const formattedTransactions = transactions.map(row => ({
            id: String(row.id),
            name: row.title,
            amount: parseFloat(row.value).toFixed(2),
            date: new Date(row.date).toISOString(), // Keep date in ISO string for frontend flexibility
            section: row.section,
            payment_mode: row.payment_mode,
            notes: row.notes,
            type: row.section === 'Income' ? 'income' : 'expense' // Determine type here
        }));

        res.json({ allTransactions: formattedTransactions });

    } catch (err) {
        console.error("Error fetching all transactions for recent activities:", err);
        res.status(500).json({ error: "Failed to fetch all transactions for recent activities." });
    } finally {
        if (connection) connection.release();
    }
});
// PUT /profile - Update User Profile API
router.put("/", verifyToken, upload.single('profile_photo'), async (req, res) => {
    const userId = req.user.userId;
    const { first_name, last_name, phone_number, email } = req.body;

    let connection;
    try {
        connection = await pool.promise().getConnection();
        await connection.beginTransaction(); // Start transaction

        if (email) {
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!emailRegex.test(email)) {
                if (req.file) fs.unlinkSync(req.file.path); // Clean up uploaded file on error
                await connection.rollback();
                return res.status(400).json({ error: "Invalid email format" });
            }
            const [emailExists] = await connection.query(
                "SELECT id FROM users WHERE email = ? AND id != ?", [email, userId]
            );
            if (emailExists.length > 0) {
                if (req.file) fs.unlinkSync(req.file.path);
                await connection.rollback();
                return res.status(400).json({ error: "Email already in use" });
            }
        }

        if (phone_number) {
            const [phoneExists] = await connection.query(
                "SELECT id FROM users WHERE phone_number = ? AND id != ?", [phone_number, userId]
            );
            if (phoneExists.length > 0) {
                if (req.file) fs.unlinkSync(req.file.path);
                await connection.rollback();
                return res.status(400).json({ error: "Phone number already in use" });
            }
        }

        let profile_photo_url = undefined;
        if (req.file) {
            profile_photo_url = `${BASE_URL}/uploads/${req.file.filename}`;
            // Delete old profile photo if it exists
            const [oldPhotoRows] = await connection.query(
                "SELECT profile_photo FROM users WHERE id = ?", [userId]
            );
            if (oldPhotoRows.length > 0 && oldPhotoRows[0].profile_photo) {
                const oldPhotoPath = oldPhotoRows[0].profile_photo.replace(BASE_URL + '/', '');
                if (fs.existsSync(oldPhotoPath)) {
                    fs.unlinkSync(oldPhotoPath);
                }
            }
        }

        const updateFields = [];
        const values = [];

        if (first_name !== undefined) { updateFields.push("first_name = ?"); values.push(first_name); }
        if (last_name !== undefined) { updateFields.push("last_name = ?"); values.push(last_name); }
        if (phone_number !== undefined) { updateFields.push("phone_number = ?"); values.push(phone_number); }
        if (email !== undefined) { updateFields.push("email = ?"); values.push(email); }
        if (profile_photo_url !== undefined) { updateFields.push("profile_photo = ?"); values.push(profile_photo_url); }

        if (updateFields.length === 0) {
            await connection.rollback();
            return res.status(400).json({ error: "No fields to update" });
        }

        const updateQuery = `
            UPDATE users
            SET ${updateFields.join(", ")}
            WHERE id = ?
        `;
        values.push(userId);

        const [result] = await connection.query(updateQuery, values);

        if (result.affectedRows === 0) {
            await connection.rollback();
            return res.status(404).json({ error: "User not found or no changes made." });
        }

        await connection.commit(); // Commit transaction

        const [updatedUserRows] = await connection.query(
            "SELECT id, first_name, last_name, email, phone_number, profile_photo FROM users WHERE id = ?", [userId]
        );

        console.log(`Backend: Profile updated for user ${userId}.`);
        res.json({ message: "Profile updated successfully", user: updatedUserRows[0] });

    } catch (error) {
        if (connection) await connection.rollback();
        console.error("Profile update error:", error);
        if (req.file) fs.unlinkSync(req.file.path); // Clean up uploaded file on error
        res.status(500).json({ error: "Failed to update profile", details: error.message });
    } finally {
        if (connection) connection.release();
    }
});



// GET /profile/balance - Get user's current bank balance
router.get("/balance", verifyToken, async (req, res) => {
    const userId = req.user.userId;

    if (!userId) {
        console.error("Error: userId is undefined in /profile/balance GET route.");
        return res.status(401).json({ error: "User ID not found in token payload." });
    }

    let connection;
    try {
        connection = await pool.promise().getConnection();
        // Fetch balance
        const [userRows] = await connection.query('SELECT balance FROM users WHERE id = ?', [userId]);

        if (userRows.length === 0) {
            return res.json({ balance: 0, lastIncomeTransaction: null });
        }

        const balance = parseFloat(userRows[0].balance) || 0;

        // Fetch the most recent income transaction
        const [incomeRows] = await connection.query(
            `SELECT id, title, value, date, section, payment_mode, notes
             FROM infodata
             WHERE user_id = ? AND section = 'Income'
             ORDER BY date DESC, id DESC
             LIMIT 1`,
            [userId]
        );

        const lastIncomeTransaction = incomeRows.length > 0 ? {
            id: String(incomeRows[0].id),
            name: incomeRows[0].title,
            amount: parseFloat(incomeRows[0].value).toFixed(2),
            date: new Date(incomeRows[0].date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: 'numeric', hour12: true }),
            section: incomeRows[0].section,
            payment_mode: incomeRows[0].payment_mode,
            notes: incomeRows[0].notes,
            type: 'income'
        } : null;

        console.log(`Backend: Fetched balance for user ${userId}: ${balance}, lastIncomeTransaction: ${JSON.stringify(lastIncomeTransaction)}`);
        res.json({ balance, lastIncomeTransaction });

    } catch (err) {
        console.error("Error fetching bank balance:", err);
        res.status(500).json({ error: "Failed to fetch bank balance.", details: err.message });
    } finally {
        if (connection) connection.release();
    }
});

// NEW API: GET /profile/income-transactions - Get all income transactions for a user
router.get("/income-transactions", verifyToken, async (req, res) => {
    const userId = req.user.userId;

    if (!userId) {
        console.error("Error: userId is undefined in /profile/income-transactions GET route.");
        return res.status(401).json({ error: "User ID not found in token payload." });
    }

    let connection;
    try {
        connection = await pool.promise().getConnection();
        const [incomeRows] = await connection.query(
            `SELECT id, title, value, date, section, payment_mode, notes
             FROM infodata
             WHERE user_id = ? AND section = 'Income'
             ORDER BY date DESC, id DESC;`,
            [userId]
        );

        const incomeTransactions = incomeRows.map((row) => ({
            id: String(row.id),
            name: row.title,
            amount: parseFloat(row.value).toFixed(2),
            date: new Date(row.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: 'numeric', hour12: true }),
            section: row.section,
            payment_mode: row.payment_mode,
            notes: row.notes,
            type: 'income' // Explicitly set type for frontend display
        }));

        console.log(`Backend: Fetched ${incomeTransactions.length} income transactions for user ${userId}.`);
        res.json({ incomeTransactions });

    } catch (err) {
        console.error("Error fetching all income transactions:", err);
        res.status(500).json({ error: "Failed to fetch income transactions.", details: err.message });
    } finally {
        if (connection) connection.release();
    }
});

// server/routes/income-transactions.js
router.delete("/income-transactions/delete/:id", verifyToken, async (req, res) => {
    const userId = req.user.userId;
    const transactionId = req.params.id;

    if (!userId) {
        console.error("Error: userId is undefined in /income-transactions/delete DELETE route.");
        return res.status(401).json({ error: "User ID not found in token payload." });
    }

    let connection;
    try {
        connection = await pool.promise().getConnection();
        await connection.beginTransaction();

        // Check if the transaction belongs to the user and is an 'Income' type
        const [transactionRows] = await connection.query(
            'SELECT value FROM infodata WHERE id = ? AND user_id = ? AND section = \'Income\'',
            [transactionId, userId]
        );

        if (transactionRows.length === 0) {
            await connection.rollback();
            return res.status(404).json({ error: "Transaction not found or unauthorized." });
        }

        const amountToDeduct = parseFloat(transactionRows[0].value);

        // Delete the transaction
        await connection.query(
            'DELETE FROM infodata WHERE id = ? AND user_id = ?',
            [transactionId, userId]
        );

        // Update user balance
        const [userRows] = await connection.query(
            'SELECT balance FROM users WHERE id = ? FOR UPDATE', // Use FOR UPDATE for pessimistic locking
            [userId]
        );
        if (userRows.length > 0) {
            const currentBalance = parseFloat(userRows[0].balance) || 0;
            const newBalance = currentBalance - amountToDeduct;
            await connection.query(
                'UPDATE users SET balance = ? WHERE id = ?',
                [newBalance, userId]
            );
        }

        await connection.commit();
        console.log(`Backend: Deleted income transaction ${transactionId} for user ${userId}. New balance updated.`);
        res.json({ message: "Deposit entry deleted successfully." });
    } catch (err) {
        if (connection) await connection.rollback();
        console.error("Error deleting income transaction:", err);
        res.status(500).json({ error: "Failed to delete deposit entry.", details: err.message });
    } finally {
        if (connection) connection.release();
    }
});

// POST /profile/balance/add - Add balance to user's account
router.post("/balance/add", verifyToken, async (req, res) => {
    const userId = req.user.userId;
    const { amount } = req.body;

    if (!userId) {
        console.error("Error: userId is undefined in /profile/balance/add POST route.");
        return res.status(401).json({ error: "User ID not found in token payload." });
    }

    if (typeof amount !== 'number' || amount <= 0) {
        return res.status(400).json({ error: "Invalid amount. Must be a positive number." });
    }

    let connection;
    try {
        connection = await pool.promise().getConnection();
        await connection.beginTransaction();

        // Get current balance
        const [userRows] = await connection.query('SELECT balance FROM users WHERE id = ? FOR UPDATE', [userId]);
        if (userRows.length === 0) {
            await connection.rollback();
            return res.status(404).json({ error: "User not found." });
        }
        const currentBalance = parseFloat(userRows[0].balance) || 0;
        const newBalance = currentBalance + amount;

        // Update balance
        await connection.query('UPDATE users SET balance = ? WHERE id = ?', [newBalance, userId]);

        // Log the addition as an income transaction in infodata table
        const currentDate = new Date();
        await connection.query(
            `INSERT INTO infodata (user_id, target, title, value, date, section, payment_mode, notes)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [userId, 0, 'Balance Addition', amount, currentDate, 'Income', 'Digital', `Added ${amount} to balance`] // Added default 'Digital' for payment_mode and null for target for income
        );

        await connection.commit();
        console.log(`Backend: Added ${amount} to user ${userId}'s balance. New balance: ${newBalance}`);
        res.json({ newBalance });

    } catch (err) {
        if (connection) await connection.rollback();
        console.error("Error adding balance:", err);
        res.status(500).json({ error: "Failed to add balance.", details: err.message });
    } finally {
        if (connection) connection.release();
    }
});

module.exports = router;


