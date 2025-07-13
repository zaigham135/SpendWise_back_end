const express = require("express");
const bodyParser = require("body-parser");
const mysql = require("mysql2");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(bodyParser.json());

// MySQL connection setup
// const db = mysql.createConnection({
//   host: "localhost", // or your MySQL host
//   user: "root",      // your MySQL username
//   password: "admin", // your MySQL password
//   database: "todolist",  // your database name
// });
const db = mysql.createConnection({
  host: "bmeptlaonyp4rdlpgoy9-mysql.services.clever-cloud.com", // or your MySQL host
  user: "uzdltu6roacm8wmd",      // your MySQL username
  password: "N8siWLoN4YK3kTtNLIDX", // your MySQL password
  database: "bmeptlaonyp4rdlpgoy9",  // your database name
});




db.connect((err) => {
  if (err) {
    console.error("Error connecting to MySQL:", err);
    return;
  }
  console.log("Connected to MySQL database.");
});

// Get all items
app.get("/items", (req, res) => {
  db.query("SELECT * FROM infodata", (err, results) => {
    if (err) {
      console.error("Database query error:", err);
      res.status(500).json({ error: "Failed to fetch items." });
    } else {
      // Format the date to dd-mm-yyyy
      const formattedResults = results.map(item => {
        let formattedDate;

        // Check if item.date is a string or a Date object
        if (typeof item.date === 'string') {
          const [year, month, day] = item.date.split('-'); // Split the date string
          formattedDate = `${day}-${month}-${year}`; // Convert to 'dd-mm-yyyy'
        } else if (item.date instanceof Date) {
          // If it's a Date object, format it
          const day = String(item.date.getDate()).padStart(2, '0');
          const month = String(item.date.getMonth() + 1).padStart(2, '0'); // Months are zero-based
          const year = item.date.getFullYear();
          formattedDate = `${day}-${month}-${year}`; // Convert to 'dd-mm-yyyy'
        } else {
          // Handle unexpected types
          formattedDate = item.date; // Fallback to original value
        }

        return {
          ...item,
          date: formattedDate // Use the formatted date
        };
      });
      res.json(formattedResults);
    }
  });
});

// Update an item
app.put("/items/:id", (req, res) => {
    const { id } = req.params;
    const { title, value, date,section } = req.body;

    // Parse the date from DD-MM-YYYY to YYYY-MM-DD
    let formattedDate;
    if (date) {
        const [day, month, year] = date.split('-');
        formattedDate = `${year}-${month}-${day}`; // Convert to 'YYYY-MM-DD'
    }

    const query = "UPDATE infodata SET title = ?, value = ?, date = ?, section = ? WHERE id = ?";
    db.query(query, [title, value, formattedDate,section, id], (err, results) => {
        if (err) {
            console.error(err);
            res.status(500).json({ error: "Failed to update item." });
        } else {
            res.json({ message: "Item updated successfully." });
        }
    });
});

// Add a new item
app.post("/List", (req, res) => {
  const { title, value, date, section } = req.body;

  // Log the incoming data for debugging
  console.log("Incoming data:", req.body);
  let formattedDate;
  if (date) {
      const [day, month, year] = date.split('-');
      formattedDate = `${year}-${month}-${day}`; // Convert to 'YYYY-MM-DD'
  }
  // Check if any required fields are missing
  if (!title || !value || !date || !section) {
    return res.status(400).json({ error: "All fields are required." });
  }

  const query = "INSERT INTO infodata (title, value, date, section) VALUES (?, ?, ?, ?)";
  
  db.query(query, [title, value, formattedDate, section], (err, results) => {
    if (err) {
      console.error("Database insert error:", err); // Log the error
      res.status(500).json({ error: "Failed to add item." });
    } else {
      res.json({ message: "Item added successfully.", id: results.insertId });
    }
  });
});

// Function to generate a unique ID (you can customize this)
const generateUniqueId = () => {
  return Math.random().toString(36).substr(2, 9); // Simple unique ID generator
};

// Delete an item
app.delete("/items/:id", (req, res) => {
  const { id } = req.params;

  const query = "DELETE FROM infodata WHERE id = ?";
  db.query(query, [id], (err, results) => {
    if (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to delete item." });
    } else {
      res.json({ message: "Item deleted successfully." });
    }
  });
});

const PORT = 5000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
