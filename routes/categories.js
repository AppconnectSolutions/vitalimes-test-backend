// backend/routes/categories.js
import express from "express";
import multer from "multer";
import crypto from "crypto";
import path from "path";
import db from "../db.js";
import { minioClient, MINIO_BUCKET } from "../config/minio.js";

const router = express.Router();

/**
 * ✅ Multer memory storage (NO disk usage)
 */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB
  },
});

/**
 * ✅ helpers
 */
function sanitizeFilename(name = "file") {
  return String(name)
    .replace(/\s+/g, "_")
    .replace(/[^a-zA-Z0-9._-]/g, "");
}

function pickCategoryName(body) {
  return (body.category_name || body.categoryName || "").trim();
}

function pickStatus(body) {
  return body.status || "Active";
}

function pickDate(body) {
  return body.date ? body.date : null;
}

function buildObjectKey(originalname) {
  const ext = path.extname(originalname || "").toLowerCase() || ".png";
  const base = path.basename(originalname || "image", ext);
  const safeBase = sanitizeFilename(base).slice(0, 50) || "image";
  const uuid = crypto.randomUUID();
  // ✅ store under uploads/categories/
  return `uploads/categories/${Date.now()}-${uuid}-${safeBase}${ext}`;
}

// Extract a minio key from DB stored value
// supports: "uploads/xxx.png" OR "vitalimes-images/uploads/xxx.png" OR "/uploads/xxx.png" OR "xxx.png"
function extractMinioKey(val) {
  if (!val) return null;
  const s = String(val).trim();
  if (!s) return null;

  const idx = s.indexOf("uploads/");
  if (idx >= 0) return s.slice(idx);

  // if filename only, assume uploads/
  if (!s.includes("/") && s.includes(".")) return `uploads/${s}`;

  return null;
}

async function uploadToMinio(file) {
  if (!file) return null;

  const objectKey = buildObjectKey(file.originalname);
  const metaData = {
    "Content-Type": file.mimetype || "application/octet-stream",
  };

  // putObject(bucket, objectName, stream/buffer, size, meta)
  await minioClient.putObject(
    MINIO_BUCKET,
    objectKey,
    file.buffer,
    file.size,
    metaData
  );

  return objectKey;
}

async function safeRemoveFromMinio(key) {
  if (!key) return;
  try {
    await minioClient.removeObject(MINIO_BUCKET, key);
  } catch (e) {
    // do not fail request because cleanup failed
    console.warn("⚠️ MinIO removeObject failed:", e.message);
  }
}

/**
 * =======================
 * GET ALL CATEGORIES
 * =======================
 */
router.get("/", async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT id, category_name, date, status, image_url, created_at
       FROM categories
       ORDER BY created_at DESC`
    );
    res.json(rows);
  } catch (err) {
    console.error("Error fetching categories:", err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * =======================
 * GET SINGLE CATEGORY BY ID
 * =======================
 */
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

/**
 * =======================
 * CREATE CATEGORY (MinIO Upload)
 * =======================
 */
router.post("/", upload.single("image"), async (req, res) => {
  try {
    const categoryName = pickCategoryName(req.body);
    const status = pickStatus(req.body);
    const date = pickDate(req.body);

    if (!categoryName) {
      return res
        .status(400)
        .json({ success: false, error: "category_name is required" });
    }

    // ✅ Upload to MinIO (store key in DB)
    let image_url = null;
    if (req.file) {
      image_url = await uploadToMinio(req.file);
    }

    const [result] = await db.query(
      `INSERT INTO categories
        (category_name, date, status, image_url, created_at)
       VALUES (?, ?, ?, ?, NOW())`,
      [categoryName, date, status, image_url]
    );

    res.json({
      success: true,
      category: {
        id: result.insertId,
        category_name: categoryName,
        date,
        status,
        image_url, // ✅ this is MinIO key like uploads/categories/...
      },
    });
  } catch (err) {
    console.error("Error adding category:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * =======================
 * UPDATE CATEGORY (MinIO Upload)
 * =======================
 */
router.put("/:id", upload.single("image"), async (req, res) => {
  try {
    const { id } = req.params;

    const categoryName = pickCategoryName(req.body);
    const status = pickStatus(req.body);
    const date = pickDate(req.body);

    if (!categoryName) {
      return res
        .status(400)
        .json({ success: false, error: "category_name is required" });
    }

    // Get old image key
    const [rows] = await db.query(
      `SELECT image_url FROM categories WHERE id = ?`,
      [id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ success: false, error: "Category not found" });
    }

    const oldImageVal = rows[0].image_url;
    const oldKey = extractMinioKey(oldImageVal);

    let image_url = oldImageVal;

    // ✅ If new image selected, upload to MinIO and optionally delete old object
    if (req.file) {
      const newKey = await uploadToMinio(req.file);
      image_url = newKey;

      // cleanup old if it was a key
      if (oldKey && oldKey !== newKey) {
        await safeRemoveFromMinio(oldKey);
      }
    }

    await db.query(
      `UPDATE categories SET
        category_name = ?,
        date = ?,
        status = ?,
        image_url = ?
       WHERE id = ?`,
      [categoryName, date, status, image_url, id]
    );

    res.json({
      success: true,
      category: {
        id,
        category_name: categoryName,
        date,
        status,
        image_url, // ✅ MinIO key
      },
    });
  } catch (err) {
    console.error("Error updating category:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * =======================
 * DELETE CATEGORY (optional MinIO cleanup)
 * =======================
 */
router.delete("/:id", async (req, res) => {
  try {
    const { id } = req.params;

    // fetch image_url first (for cleanup)
    const [rows] = await db.query(
      `SELECT image_url FROM categories WHERE id = ?`,
      [id]
    );

    if (rows.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "Category not found" });
    }

    const key = extractMinioKey(rows[0].image_url);

    const [result] = await db.query("DELETE FROM categories WHERE id = ?", [id]);

    if (result.affectedRows === 0) {
      return res
        .status(404)
        .json({ success: false, message: "Category not found" });
    }

    // cleanup image in MinIO (safe)
    if (key) await safeRemoveFromMinio(key);

    res.json({ success: true });
  } catch (err) {
    console.error("Error deleting category:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
