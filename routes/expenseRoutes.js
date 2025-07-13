// routes/expenseRoutes.js
const express = require("express");
const router = express.Router();

const verifyToken = require("../middleware/authMiddleware"); // Import auth middleware
const { pool, retryOperation } = require("../db"); // Import pool and retryOperation

// Get all items for a user
// In your backend file (e.g., total_expense_app/routes/expenseRoutes.js)

// GET all items for the authenticated user with filters and pagination
router.get("/", verifyToken, (req, res) => {
    const userId = req.user.userId;

    if (!userId) {
      console.error("Error: userId is undefined in /items GET route.");
      return res.status(401).json({ error: "User ID not found in token payload." });
    }

    // Pagination parameters
    const page = parseInt(req.query._page ) || 1; // Default to page 1
    const limit = parseInt(req.query._limit) || 10; // Default to 10 items per page
    const offset = (page - 1) * limit;

    // Filter parameters
    const category = req.query.category;
    const fromDate = req.query.fromDate; // YYYY-MM-DD
    const toDate = req.query.toDate;     // YYYY-MM-DD

    let query = `
    SELECT 
        i.id, i.title, i.value, i.date, i.section, i.target, i.payment_mode, i.notes, i.user_id,
        c.iconName, c.iconColor,c.iconLibrary
    FROM infodata i
    LEFT JOIN categories c
        ON i.section = c.label AND c.user_id = i.user_id
    WHERE i.user_id = ?
`;
let countQuery = "SELECT COUNT(*) AS total FROM infodata i WHERE i.user_id = ?";
const queryParams = [userId];
const countQueryParams = [userId];

    if (category && category !== 'All') { // Assuming 'All' is a special client-side value
        query += " AND section = ?";
        countQuery += " AND section = ?";
        queryParams.push(category);
        countQueryParams.push(category);
    }
    if (fromDate) {
        query += " AND date >= ?";
        countQuery += " AND date >= ?";
        queryParams.push(fromDate);
        countQueryParams.push(fromDate);
    }
    if (toDate) {
        query += " AND date <= ?";
        countQuery += " AND date <= ?";
        queryParams.push(toDate);
        countQueryParams.push(toDate);
    }

    query += " ORDER BY date DESC, id DESC LIMIT ? OFFSET ?"; // Order by date descending, then ID for stable sort
    queryParams.push(limit, offset);

    pool.query(countQuery, countQueryParams, (err, countResults) => {
        if (err) {
            console.error("Error fetching item count:", err);
            return res.status(500).json({ error: "Failed to fetch item count." });
        }
        const totalItems = (countResults )[0].total; // Get total count

        pool.query(query, queryParams, (err, results) => {
            if (err) {
                console.error("Error fetching items:", err);
                return res.status(500).json({ error: "Failed to fetch items." });
            }
            // Send both the items and a total count for pagination
            res.json(results); // For now, sending just results, as frontend `hasMore` is based on `limit`.
                               // If you want more robust pagination, you'd send { data: results, total: totalItems }
        });
    });
});

// (Assuming you have a verifyToken middleware and pool setup)


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
        // Add more cases for 'thisWeek', 'lastWeek', etc., if needed for other summary types
        default: // Default to a broad range or handle as an error if no period/dates are given
            // If no period is specified, and no fromDate/toDate, default to a reasonable range
            // For this summary, if period is not given, we'll rely on fromDate/toDate or provide a very broad default
            // For now, if no period and no dates, it will fetch all data for the user.
            break;
    }
    return {
        startDate: startDate.toISOString().split('T')[0],
        endDate: endDate.toISOString().split('T')[0]
    };
};


router.get("/summary", verifyToken, async (req, res) => {
    const userId = req.user.userId;

    if (!userId) {
        console.error("Error: userId is undefined in /items/summary GET route.");
        return res.status(401).json({ error: "User ID not found in token payload." });
    }

    // Filter parameters from query
    const category = req.query.category;
    let fromDate = req.query.fromDate; // YYYY-MM-DD
    let toDate = req.query.toDate;     // YYYY-MM-DD
    const period = req.query.period;   // New: e.g., 'thisMonth', 'last3Months'

    // If a 'period' is specified, override fromDate and toDate
    if (period) {
        const periodDates = getPeriodDates(period);
        fromDate = periodDates.startDate;
        toDate = periodDates.endDate;
    }

    let query = `
        SELECT
            SUM(CASE WHEN section != 'Income' THEN value ELSE 0 END) AS total_expenses,
            COUNT(id) AS total_count
        FROM infodata
        WHERE user_id = ?
    `;
    const queryParams = [userId];

    if (category && category !== 'All') {
        query += " AND section = ?";
        queryParams.push(category);
    }
    if (fromDate) {
        query += " AND date >= ?";
        queryParams.push(fromDate);
    }
    if (toDate) {
        query += " AND date <= ?";
        queryParams.push(toDate);
    }

    let connection;
    try {
        connection = await pool.promise().getConnection();
        const [rows] = await connection.query(query, queryParams);

        const totalExpenses = parseFloat(rows[0].total_expenses) || 0;
        const totalCount = rows[0].total_count || 0;

        console.log(`Backend: Fetched summary for user ${userId} - Total Expenses: ${totalExpenses}, Total Count: ${totalCount}`);
        res.json({ totalExpenses, totalCount });

    } catch (err) {
        if (connection) await connection.rollback(); // Note: rollback should only be used within a transaction
        console.error("Error fetching items summary:", err);
        res.status(500).json({ error: "Failed to fetch items summary.", details: err.message });
    } finally {
        if (connection) connection.release();
    }
});

// Helper function to get period dates (assuming it exists)



// Assuming you have 'router' and 'pool' defined and imported,
// and 'verifyToken' middleware is available.
// Example:
// const express = require('express');
// const router = express.Router();
// const pool = require('../config/db'); // Your database connection pool
// const verifyToken = require('../middleware/authMiddleware'); // Your authentication middleware

// GET /items/category-summary - Get summary of expenses per category for the authenticated user
router.get("/category-summary", verifyToken, async (req, res) => {
    const userId = req.user.userId; // Get userId from the authenticated token

    if (!userId) {
        console.error("Error: userId is undefined in /items/category-summary GET route.");
        return res.status(401).json({ error: "User ID not found in token payload." });
    }

    const query = `
        SELECT
            section,
            SUM(value) AS total_expenses
        FROM infodata
        WHERE user_id = ?
        GROUP BY section
        ORDER BY section ASC;
    `;
    const queryParams = [userId];

    try {
        const [rows] = await pool.promise().query(query, queryParams);

        // Map the results to a cleaner format if needed, though direct use is fine
        const categorySummaries = rows.map((row) => ({
            section: row.section,
            total_expenses: parseFloat(row.total_expenses) || 0 // Ensure it's a number, default to 0
        }));

        console.log(`Backend: Fetched category summaries for user ${userId}:`, categorySummaries);
        res.json(categorySummaries);

    } catch (err) {
        console.error("Error fetching category summary:", err);
        res.status(500).json({ error: "Failed to fetch category summary.", details: err.message });
    }
});


 // Adjust path as per your project structure

// GET /items/summary/monthly - Get monthly summary of expenses for the authenticated user
router.get("/summary/monthly", verifyToken, async (req, res) => {
    const userId = req.user.userId;
    const months = parseInt(req.query.months) || 6; // Default to last 6 months

    if (!userId) {
        console.error("Error: userId is undefined in /items/summary/monthly GET route.");
        return res.status(401).json({ error: "User ID not found in token payload." });
    }

    // Calculate the start date for the query (e.g., 6 months ago from the current month's start)
    const today = new Date();
    const startDate = new Date(today.getFullYear(), today.getMonth() - (months - 1), 1); // Start of the Nth month ago

    // Generate month labels for the last 'months' period
    const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const monthLabels = [];
    for (let i = 0; i < months; i++) {
        const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
        monthLabels.unshift(monthNames[d.getMonth()]); // Add to the beginning to keep chronological order
    }

    const query = `
        SELECT
            DATE_FORMAT(date, '%b') AS month,
            SUM(CASE WHEN section != 'Income' THEN value ELSE 0 END) AS total_expenses
        FROM infodata
        WHERE user_id = ? AND date >= ?
        GROUP BY month
        ORDER BY MIN(date) ASC;
    `;
    const queryParams = [userId, startDate.toISOString().split('T')[0]]; // Use YYYY-MM-DD format for date comparison

    let connection;
    try {
        connection = await pool.promise().getConnection();
        const [rows] = await connection.query(query, queryParams);

        // Create a map for quick lookup of fetched data
        const fetchedDataMap = new Map();
        rows.forEach((row) => {
            fetchedDataMap.set(row.month, parseFloat(row.total_expenses) || 0);
        });

        // Combine with all month labels to ensure all months are present, even if no expenses
        const monthlySummaries = monthLabels.map(monthLabel => ({
            month: monthLabel,
            total_expenses: fetchedDataMap.get(monthLabel) || 0
        }));

        console.log(`Backend: Fetched monthly summaries for user ${userId} (last ${months} months):`, monthlySummaries);
        res.json(monthlySummaries);

    } catch (err) {
        console.error("Error fetching monthly summary:", err);
        res.status(500).json({ error: "Failed to fetch monthly summary.", details: err.message });
    } finally {
        if (connection) connection.release();
    }
});

// NEW: GET /items/summary/weekly - Get weekly summary of expenses for the authenticated user
router.get("/summary/weekly", verifyToken, async (req, res) => {
    const userId = req.user.userId;
    const weeks = parseInt(req.query.weeks) || 4; // Default to last 4 weeks

    if (!userId) {
        console.error("Error: userId is undefined in /items/summary/weekly GET route.");
        return res.status(401).json({ error: "User ID not found in token payload." });
    }

    let connection;
    try {
        connection = await pool.promise().getConnection();

        const weeklySummaries = [];
        const today = new Date();

        for (let i = 0; i < weeks; i++) {
            // Calculate the start and end date for each week, going backwards from today
            const endDate = new Date(today.getFullYear(), today.getMonth(), today.getDate() - (i * 7));
            const startDate = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate() - 6); // 7 days including endDate

            const formattedStartDate = startDate.toISOString().split('T')[0];
            const formattedEndDate = endDate.toISOString().split('T')[0];

            const query = `
                SELECT
                    SUM(CASE WHEN section != 'Income' THEN value ELSE 0 END) AS total_expenses
                FROM infodata
                WHERE user_id = ? AND date BETWEEN ? AND ?;
            `;
            const queryParams = [userId, formattedStartDate, formattedEndDate];

            const [rows] = await connection.query(query, queryParams);
            const totalExpenses = parseFloat(rows[0].total_expenses) || 0;

            // Determine a label for the week (e.g., "Wk X" or "Start Date - End Date")
            weeklySummaries.unshift({ // Add to the beginning to keep chronological order
                week: weeks - i, // Week number (e.g., 1 for oldest, 4 for most recent)
                total_expenses: totalExpenses
            });
        }

        console.log(`Backend: Fetched weekly summaries for user ${userId} (last ${weeks} weeks):`, weeklySummaries);
        res.json(weeklySummaries);

    } catch (err) {
        if (connection) await connection.rollback();
        console.error("Error fetching weekly summary:", err);
        res.status(500).json({ error: "Failed to fetch weekly summary.", details: err.message });
    } finally {
        if (connection) connection.release();
    }
});

// GET /items/summary/daily - Get daily summary of expenses for a given date range for the authenticated user
router.get("/summary/daily", verifyToken, async (req, res) => {
    const userId = req.user.userId;
    const { startDate, endDate } = req.query; // Expect YYYY-MM-DD format

    if (!userId) {
        console.error("Error: userId is undefined in /items/summary/daily GET route.");
        return res.status(401).json({ error: "User ID not found in token payload." });
    }

    if (!startDate || !endDate) {
        return res.status(400).json({ error: "startDate and endDate are required for daily summary." });
    }

    // Validate date formats (simple check)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
        return res.status(400).json({ error: "Date format must be YYYY-MM-DD." });
    }

    const query = `
        SELECT
            DATE_FORMAT(date, '%Y-%m-%d') AS date,
            SUM(CASE WHEN section != 'Income' THEN value ELSE 0 END) AS total_expenses
        FROM infodata
        WHERE user_id = ? AND date BETWEEN ? AND ?
        GROUP BY date
        ORDER BY date ASC;
    `;
    const queryParams = [userId, startDate, endDate];

    let connection;
    try {
        connection = await pool.promise().getConnection();
        const [rows] = await connection.query(query, queryParams);

        // Create a map for quick lookup of fetched data
        const fetchedDataMap = new Map();
        rows.forEach((row) => {
            fetchedDataMap.set(row.date, parseFloat(row.total_expenses) || 0);
        });

        // Generate all dates within the range and combine with fetched data
        const dailySummaries = [];
        let currentDate = new Date(startDate);
        const endDt = new Date(endDate);

        while (currentDate <= endDt) {
            const formattedDate = currentDate.toISOString().split('T')[0];
            dailySummaries.push({
                date: formattedDate,
                total_expenses: fetchedDataMap.get(formattedDate) || 0
            });
            currentDate.setDate(currentDate.getDate() + 1); // Move to the next day
        }

        console.log(`Backend: Fetched daily summaries for user ${userId} from ${startDate} to ${endDate}:`, dailySummaries);
        res.json(dailySummaries);

    } catch (err) {
        if (connection) await connection.rollback(); // Rollback in case of error
        console.error("Error fetching daily summary:", err);
        res.status(500).json({ error: "Failed to fetch daily summary.", details: err.message });
    } finally {
        if (connection) connection.release();
    }
});

// Don't forget to export the router if this is a separate module:
// module.exports = router;

// GET total expenses for a specific category for the authenticated user
router.get("/total-by-category", verifyToken, async (req, res) => {
    const { category } = req.query;
    // Use req.user.userId, as confirmed by your verifyToken middleware
    const userId = req.user.userId; // <--- CONFIRMED: USE userId

    if (!userId) {
        console.error("Error: userId is undefined in /total-by-category route.");
        return res.status(401).json({ error: "User ID not found in token payload." });
    }

    if (!category) {
        return res.status(400).json({ error: "Category query parameter is required." });
    }

    try {
        const query = `
            SELECT SUM(value) AS total_spent
            FROM infodata
            WHERE user_id = ? AND section = ?;
        `;
        const [rows] = await pool.promise().query(query, [userId, category]);

        const totalSpent = rows[0].total_spent || 0;
        console.log(`Backend: Fetched total for category '${category}' for user ${userId}: ${totalSpent}`); // Backend log
        res.json({ category, totalSpent });

    } catch (err) {
        console.error("Error fetching total expenses by category:", err);
        res.status(500).json({ error: "Internal server error." });
    }
});
router.get("/custom-categories", verifyToken, async (req, res) => {
    const userId = req.user.userId;

    try {
        const defaultCategories = ["Travel", "Food", "Petrol", "Clothes", "Rent", "Groceries"];

        const query = `
            SELECT id,label, iconName, iconColor, target
            FROM categories
            WHERE user_id = ? AND label NOT IN (?) 
        `;
        const [rows] = await pool.promise().query(query, [userId, defaultCategories]);

        res.json(rows);
    } catch (err) {
        console.error("Error fetching custom categories:", err);
        res.status(500).json({ error: "Internal server error." });
    }
});

router.get("/category-target", verifyToken, async (req, res) => {
    const { category } = req.query;
    const userId = req.user.userId;

    if (!category) return res.status(400).json({ error: "Category is required." });

    const defaultCategories = ["Travel", "Food", "Petrol", "Clothes", "Rent", "Groceries"];
    try {
        let query, params;

        if (defaultCategories.includes(category)) {
            query = `
    SELECT target 
    FROM infodata 
    WHERE section = ? AND user_id = ? 
    ORDER BY id DESC 
    LIMIT 1
`;

            params = [category, userId];
        } else {
            query = `SELECT target FROM categories WHERE label = ? AND user_id = ? LIMIT 1`;
            params = [category, userId];
        }

        const [rows] = await pool.promise().query(query, params);
        const target = rows.length > 0 ? rows[0].target : 0;

        res.json({ target });
    } catch (err) {
        console.error("Error fetching category target:", err);
        res.status(500).json({ error: "Internal server error." });
    }
});

// Add a new item
// In your backend file (e.g., total_expense_app/routes/expenseRoutes.js)
// POST new custom category
router.post("/custom-categories", verifyToken, async (req, res) => {
    const { label, iconName, iconColor, target } = req.body;
    const userId = req.user.userId;
  
    if (!label || !iconName || !iconColor) {
      return res.status(400).json({ error: "Missing required fields." });
    }
  
    try {
        const query = `
        INSERT INTO infodata (title, section, iconName, iconColor, target, user_id)
        VALUES (?, ?, ?, ?, ?, ?);
      `;
      await pool.promise().query(query, [
        label,                  // Use category label as title (or something else)
        label,
        iconName,
        iconColor,
        target || null,
        userId
      ]);
      
  
      console.log(`Backend: Added custom category '${label}' for user ${userId}`);
      res.status(201).json({ message: "Custom category added successfully!" });
  
    } catch (err) {
      console.error("Error adding custom category:", err);
      res.status(500).json({ error: "Internal server error." });
    }
  });


router.post("/add-category", verifyToken, async (req, res) => {
    const userId = req.user.userId;
    const { label, iconName, iconColor, target,iconLibrary} = req.body;

    if (!label || !iconLibrary) return res.status(400).json({ error: "Category label is required." });

    try {
        const query = `
            INSERT INTO categories (label, iconName, iconColor, target, user_id,iconLibrary)
            VALUES (?, ?, ?, ?, ?, ?);
        `;
        const [result] = await pool.promise().query(query, [label, iconName, iconColor, target || 0, userId,iconLibrary]);

        res.status(201).json({
            message: "Category added successfully!",
            categoryId: result.insertId,
        });
    } catch (err) {
        console.error("Error adding category:", err);
        res.status(500).json({ error: "Internal server error." });
    }
});

  // PUT /items/update-category-target
// PUT /items/update-category-target
router.put("/update-category-target", verifyToken, async (req, res) => {
    const { category, target } = req.body;
    const userId = req.user.userId;

    if (!category || target === undefined) {
        return res.status(400).json({ error: "Missing category or target." });
    }

    const defaultCategories = ["Travel", "Food", "Petrol", "Clothes", "Rent", "Groceries"];

    try {
        let query, result;

        if (defaultCategories.includes(category)) {
            // Update infodata for default categories
            query = `
                UPDATE infodata
                SET target = ?
                WHERE section = ? AND user_id = ?;
            `;
            [result] = await pool.promise().query(query, [target, category, userId]);

            if (result.affectedRows === 0) {
                return res.status(404).json({ error: "No expenses found for this category." });
            }

            console.log(`Updated target in infodata for default category '${category}' to ${target} for user ${userId}.`);
            res.json({ message: "Target updated successfully in infodata!" });

        } else {
            // Update categories table for custom categories
            query = `
                UPDATE categories
                SET target = ?
                WHERE label = ? AND (user_id = ? OR user_id IS NULL);
            `;
            [result] = await pool.promise().query(query, [target, category, userId]);

            if (result.affectedRows === 0) {
                return res.status(404).json({ error: "Category not found." });
            }

            console.log(`Updated target in categories for custom category '${category}' to ${target} for user ${userId}.`);
            res.json({ message: "Target updated successfully in categories!" });
        }

    } catch (err) {
        console.error("Error updating category target:", err);
        res.status(500).json({ error: "Internal server error." });
    }
});

router.delete("/custom-categories/:id", verifyToken, async (req, res) => {
    const categoryId = req.params.id; // The ID of the category to delete
    const userId = req.user.userId;

    if (!userId) {
        console.error("Error: userId is undefined in /custom-categories DELETE route.");
        return res.status(401).json({ error: "User ID not found in token payload." });
    }

    if (!categoryId) {
        return res.status(400).json({ error: "Category ID is required." });
    }

    let connection;
    try {
        connection = await pool.promise().getConnection();
        await connection.beginTransaction(); // Start a transaction for atomicity

        // 1. Get the label of the category to be deleted
        // This label is needed to identify and delete associated transactions in `infodata`.
        const [categoryRows] = await connection.query(
            `SELECT label FROM categories WHERE id = ? AND user_id = ?`,
            [categoryId, userId]
        );

        if (categoryRows.length === 0) {
            await connection.rollback(); // Rollback if category not found or unauthorized
            return res.status(404).json({ error: "Custom category not found or not authorized for this user." });
        }

        const deletedCategoryLabel = categoryRows[0].label;

        // 2. DELETE all infodata entries that used this category for the current user
        const [deleteInfodataResult] = await connection.query(
            `DELETE FROM infodata WHERE user_id = ? AND section = ?`,
            [userId, deletedCategoryLabel]
        );
        console.log(`Backend: Deleted ${deleteInfodataResult.affectedRows} infodata entries associated with '${deletedCategoryLabel}'.`);


        // 3. Delete the custom category from the categories table
        const [deleteCategoryResult] = await connection.query(
            `DELETE FROM categories WHERE id = ? AND user_id = ?`,
            [categoryId, userId]
        );

        if (deleteCategoryResult.affectedRows === 0) {
            await connection.rollback(); // Rollback if category couldn't be deleted (e.g., already gone)
            return res.status(404).json({ error: "Custom category not found or could not be deleted from categories table." });
        }

        await connection.commit(); // Commit the transaction if all operations succeed

        console.log(`Backend: Custom category '${deletedCategoryLabel}' (ID: ${categoryId}) and all its associated transactions deleted for user ${userId}.`);
        res.status(200).json({ 
            message: `Custom category "${deletedCategoryLabel}" and ${deleteInfodataResult.affectedRows} associated transactions deleted successfully.`,
            deletedTransactionsCount: deleteInfodataResult.affectedRows 
        });

    } catch (err) {
        if (connection) await connection.rollback(); // Rollback on any error during the transaction
        console.error("Error deleting custom category and associated infodata:", err);
        res.status(500).json({ error: "Internal server error. Failed to delete custom category and associated transactions.", details: err.message });
    } finally {
        if (connection) connection.release(); // Always release the connection
    }
});

// POST new expense
router.post("/", verifyToken, async (req, res) => {
    const { title, value, date, section, target, payment_mode, notes } = req.body;
    const userId = req.user.userId;

    if (!userId) {
        console.error("Error: userId is undefined in /items POST route. Cannot add expense.");
        return res.status(401).json({ error: "User ID not found in token payload. Cannot add expense." });
    }

    if (!title || value === undefined || !date || !section || !payment_mode) {
        return res.status(400).json({ error: "Missing required fields." });
    }

    // Use the date as provided (already in "YYYY-MM-DD HH:mm:ss" format from frontend)
    const formattedDate = date; // No additional conversion needed

    try {
        const query = `
            INSERT INTO infodata (title, value, date, section, target, payment_mode, notes, user_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?);
        `;
        const [result] = await pool.promise().query(query, [
            title,
            value,
            formattedDate,
            section,
            target,
            payment_mode,
            notes,
            userId
        ]);

        console.log(`Backend: Added expense '${title}' for user ${userId} to category '${section}' with date ${formattedDate}.`);
        res.status(201).json({
            message: "Expense added successfully!",
            expenseId: result.insertId,
        });

    } catch (err) {
        console.error("Error adding expense:", err);
        res.status(500).json({ error: "Internal server error." });
    }
});

// Delete an item
router.delete("/:id", verifyToken, (req, res) => {
  const { id } = req.params;
  const userId = req.user.userId;
  pool.query(
    "DELETE FROM infodata WHERE id = ? AND user_id = ?",
    [id, userId],
    (err) => {
      if (err) {
        console.error("Error deleting item:", err);
        return res.status(500).json({ error: "Failed to delete item." });
      }
      res.json({ message: "Item deleted successfully" });
    }
  );
});


// Update an item
router.put("/:id", verifyToken, async (req, res) => {
  const { id } = req.params;
  const { title, value, date, section, target, payment_mode, notes } = req.body;
  const userId = req.user.userId;

  const numericValue = parseFloat(value);
  if (isNaN(numericValue)) return res.status(400).json({ error: "Value must be a valid number." });

  const numericTarget = target !== undefined ? parseFloat(target) : 0;
  if (isNaN(numericTarget)) return res.status(400).json({ error: "Target must be a valid number." });

  const formattedDate = new Date(date).toISOString().split('T')[0];

  let connection;
  try {
    connection = await retryOperation(async () => {
      const conn = await pool.promise().getConnection();
      await conn.beginTransaction();
      return conn;
    });

    if (target !== undefined) {
      await retryOperation(async () => {
        await connection.query(
          "UPDATE infodata SET target = ? WHERE section = ? AND user_id = ?",
          [numericTarget, section, userId]
        );
      });
    }

    await retryOperation(async () => {
      await connection.query(
        `UPDATE infodata SET title = ?, value = ?, date = ?, section = ?, payment_mode = ?, notes = ? WHERE id = ? AND user_id = ?`,
        [title, numericValue, formattedDate, section, payment_mode || null, notes || null, id, userId]
      );
    });

    await connection.commit();

    const [updatedItems] = await retryOperation(async () => {
      return await pool.promise().query(
        "SELECT id, title, value, date, section, target, payment_mode, notes, user_id FROM infodata WHERE section = ? AND user_id = ?",
        [section, userId]
      );
    });

    res.json({
      message: "Items updated successfully",
      updatedItem: {
        id: parseInt(id), title, value: numericValue, date: formattedDate,
        section, target: numericTarget, payment_mode: payment_mode || null,
        notes: notes || null, user_id: userId
      },
      sectionItems: updatedItems
    });

  } catch (error) {
    if (connection) await connection.rollback();
    console.error("Error updating items:", error);
    res.status(500).json({ error: "Failed to update items", details: error.message });
  } finally {
    if (connection) connection.release();
  }
});


module.exports = router;