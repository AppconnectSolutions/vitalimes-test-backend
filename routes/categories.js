// backend/routes/categories.js
import express from "express";
import multer from "multer";
import db from "../db.js";

const router = express.Router();

// Multer setup – files in /uploads
const upload = multer({ dest: "uploads/" });

// =======================
// GET ALL CATEGORIES
// =======================
router.get("/", async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT id, category_name, date, status, image_url, created_at
         FROM categories
         ORDER BY created_at DESC`
    );
    res.json(rows); // <-- pure JSON array
  } catch (err) {
    console.error("Error fetching categories:", err);
    res.status(500).json({ error: err.message });
  }
});

// =======================
// GET SINGLE CATEGORY BY ID
// =======================
router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const [rows] = await db.query(
      `SELECT id, category_name, date, status, image_url, created_at
         FROM categories
         WHERE id = ?`,
      [id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: "Category not found" });
    }

    res.json(rows[0]);
  } catch (err) {
    console.error("Error fetching category:", err);
    res.status(500).json({ error: err.message });
  }
});

// =======================
// CREATE CATEGORY
// =======================
router.post("/", upload.single("image"), async (req, res) => {
  try {
    const { categoryName, date, status } = req.body;
    const image_url = req.file ? req.file.filename : null;

    const [result] = await db.query(
      `INSERT INTO categories
        (category_name, date, status, image_url, created_at)
       VALUES (?, ?, ?, ?, NOW())`,
      [categoryName, date || null, status, image_url]
    );

    const newCategory = {
      id: result.insertId,
      category_name: categoryName,
      date,
      status,
      image_url,
    };

    res.json({ success: true, category: newCategory });
  } catch (err) {
    console.error("Error adding category:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// =======================
// UPDATE CATEGORY
// =======================
router.put("/:id", upload.single("image"), async (req, res) => {
  try {
    const { id } = req.params;
    const { categoryName, date, status } = req.body;

    // If new image, use it; otherwise keep old image
    let image_url;
    if (req.file) {
      image_url = req.file.filename;
    } else {
      const [rows] = await db.query(
        "SELECT image_url FROM categories WHERE id = ?",
        [id]
      );
      if (rows.length === 0) {
        return res.status(404).json({ error: "Category not found" });
      }
      image_url = rows[0].image_url;
    }

    await db.query(
      `UPDATE categories SET
        category_name = ?,
        date = ?,
        status = ?,
        image_url = ?
       WHERE id = ?`,
      [categoryName, date || null, status, image_url, id]
    );

    res.json({
      success: true,
      category: {
        id,
        category_name: categoryName,
        date,
        status,
        image_url,
      },
    });
  } catch (err) {
    console.error("Error updating category:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// =======================
// DELETE CATEGORY
// =======================
router.delete("/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const [result] = await db.query("DELETE FROM categories WHERE id = ?", [
      id,
    ]);

    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: "Category not found" });
    }

    res.json({ success: true });
  } catch (err) {
    console.error("Error deleting category:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
