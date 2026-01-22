import express from "express";
import db from "../db.js";
import multer from "multer";
import { minioClient, MINIO_BUCKET } from "../config/minio.js";

const router = express.Router();

/* ===============================
   ENV
================================ */
const MINIO_PUBLIC_URL = (
  process.env.MINIO_PUBLIC_URL ||
  process.env.MINIO_ENDPOINT ||
  ""
).replace(/\/$/, "");

if (!MINIO_PUBLIC_URL) {
  console.warn("⚠️ MINIO_PUBLIC_URL is not set");
}

/* ===============================
   HELPERS
================================ */
function encodeKeyForPath(key) {
  return String(key)
    .split("/")
    .map(encodeURIComponent)
    .join("/");
}

/**
 * DB → API
 * Always return DIRECT MinIO URL (public images)
 * ⚠️ DO NOT CHANGE (image logic fixed & working)
 */
function normalizeImageValue(val) {
  if (!val) return null;

  let s = String(val).trim();

  if (/^https?:\/\//i.test(s)) return s;

  if (s.includes(`/${MINIO_BUCKET}/`)) {
    s = s.split(`/${MINIO_BUCKET}/`)[1];
  }

  if (!s.startsWith("uploads/")) {
    s = `uploads/${s}`;
  }

  return `${MINIO_PUBLIC_URL}/${MINIO_BUCKET}/${encodeKeyForPath(s)}`;
}

/**
 * API → DB
 * Store ONLY object key
 */
function normalizeForStorage(val) {
  if (!val) return null;

  let s = String(val).trim();

  if (s.includes(`/${MINIO_BUCKET}/`)) {
    return s.split(`/${MINIO_BUCKET}/`)[1];
  }

  if (s.includes("/uploads/")) {
    return decodeURIComponent(s.split("/uploads/")[1]);
  }

  return s.startsWith("uploads/") ? s : `uploads/${s}`;
}

/* ===============================
   MULTER
================================ */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

/* ===============================
   UPLOAD IMAGE
================================ */
router.post("/upload", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    const objectName = `uploads/${Date.now()}-${req.file.originalname}`;

    await minioClient.putObject(
      MINIO_BUCKET,
      objectName,
      req.file.buffer,
      req.file.size,
      { "Content-Type": req.file.mimetype }
    );

    res.json({
      success: true,
      key: objectName,
      url: `${MINIO_PUBLIC_URL}/${MINIO_BUCKET}/${encodeKeyForPath(objectName)}`,
    });
  } catch (err) {
    console.error("Upload error:", err);
    res.status(500).json({ error: err.message });
  }
});

/* ==================================================
   GET ALL PRODUCTS (Products + Featured)
================================================== */
router.get("/", async (req, res) => {
  try {
    const status = req.query.status || "Active";

    const [products] = await db.query(
      `SELECT * FROM products WHERE status = ?`,
      [status]
    );

    for (const p of products) {
      const [variants] = await db.query(
        `SELECT * FROM product_variants WHERE product_id = ?`,
        [p.id]
      );
      p.variants = variants;

      for (let i = 1; i <= 6; i++) {
        p[`image${i}`] = normalizeImageValue(p[`image${i}`]);
      }
    }

    res.json({ success: true, products });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

/* ==================================================
   GET SINGLE PRODUCT
================================================== */
router.get("/:id", async (req, res) => {
  try {
    const [[product]] = await db.query(
      `SELECT * FROM products WHERE id = ?`,
      [req.params.id]
    );

    if (!product) {
      return res.status(404).json({ error: "Product not found" });
    }

    const [variants] = await db.query(
      `SELECT * FROM product_variants WHERE product_id = ?`,
      [req.params.id]
    );
    product.variants = variants;

    for (let i = 1; i <= 6; i++) {
      product[`image${i}`] = normalizeImageValue(product[`image${i}`]);
    }

    res.json({ success: true, product });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ==================================================
   ADD PRODUCT
================================================== */
router.post("/", async (req, res) => {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();

    const {
      title,
      description,
      category,
      hsn,
      status,
      units,
      variants,
      images = [],
      video = null,
    } = req.body;

    // ✅ sanitize optional fields
    const cleanHsn = hsn || null;
    const cleanUnits = units || null;
    const cleanVideo = video || null;

    // ✅ safe images
    const storedImages = Array.isArray(images)
      ? images.map(normalizeForStorage)
      : [];

    const imageList = Array(6).fill(null);
    storedImages.slice(0, 6).forEach((img, idx) => {
      imageList[idx] = img;
    });

    const [result] = await connection.query(
      `INSERT INTO products
       (title, description, category, hsn, status, units,
        image1, image2, image3, image4, image5, image6, video, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
      [
        title,
        description,
        category,
        cleanHsn,
        status,
        cleanUnits,
        ...imageList,
        cleanVideo,
      ]
    );

    const productId = result.insertId;

    // ✅ safe variants
    let variantList = [];
    try {
      variantList =
        typeof variants === "string"
          ? JSON.parse(variants || "[]")
          : Array.isArray(variants)
          ? variants
          : [];
    } catch {
      return res.status(400).json({ error: "Invalid variants format" });
    }

    for (const v of variantList) {
      await connection.query(
        `INSERT INTO product_variants
         (product_id, weight, price, sale_price, offer_percent,
          tax_percent, tax_amount, stock)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          productId,
          v.weight,
          v.price,
          v.sale_price || 0,
          v.offer_percent || 0,
          v.tax_percent || 0,
          v.tax_amount || 0,
          v.stock || 0,
        ]
      );
    }

    await connection.commit();

    res.json({ success: true, productId });
  } catch (err) {
    await connection.rollback();
    console.error("ADD PRODUCT ERROR:", err);
    res.status(500).json({ error: err.message });
  } finally {
    connection.release();
  }
});

/* ==================================================
   UPDATE PRODUCT
================================================== */
router.put("/:id", async (req, res) => {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();

    const {
      title,
      description,
      category,
      hsn,
      status,
      units,
      variants,
      images = [],
      video = null,
    } = req.body;

    const cleanHsn = hsn || null;
    const cleanUnits = units || null;
    const cleanVideo = video || null;

    const storedImages = Array.isArray(images)
      ? images.map(normalizeForStorage)
      : [];

    const imageList = Array(6).fill(null);
    storedImages.slice(0, 6).forEach((img, idx) => {
      imageList[idx] = img;
    });

    await connection.query(
      `UPDATE products SET
       title=?, description=?, category=?, hsn=?, status=?, units=?,
       image1=?, image2=?, image3=?, image4=?, image5=?, image6=?, video=?
       WHERE id=?`,
      [
        title,
        description,
        category,
        cleanHsn,
        status,
        cleanUnits,
        ...imageList,
        cleanVideo,
        req.params.id,
      ]
    );

    await connection.query(
      `DELETE FROM product_variants WHERE product_id = ?`,
      [req.params.id]
    );

    let variantList = [];
    try {
      variantList =
        typeof variants === "string"
          ? JSON.parse(variants || "[]")
          : Array.isArray(variants)
          ? variants
          : [];
    } catch {
      return res.status(400).json({ error: "Invalid variants format" });
    }

    for (const v of variantList) {
      await connection.query(
        `INSERT INTO product_variants
         (product_id, weight, price, sale_price, offer_percent,
          tax_percent, tax_amount, stock)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          req.params.id,
          v.weight,
          v.price,
          v.sale_price || 0,
          v.offer_percent || 0,
          v.tax_percent || 0,
          v.tax_amount || 0,
          v.stock || 0,
        ]
      );
    }

    await connection.commit();

    res.json({ success: true });
  } catch (err) {
    await connection.rollback();
    console.error("UPDATE PRODUCT ERROR:", err);
    res.status(500).json({ error: err.message });
  } finally {
    connection.release();
  }
});

/* ==================================================
   DELETE PRODUCT
================================================== */
router.delete("/:id", async (req, res) => {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();

    await connection.query(
      `DELETE FROM product_variants WHERE product_id = ?`,
      [req.params.id]
    );

    const [result] = await connection.query(
      `DELETE FROM products WHERE id = ?`,
      [req.params.id]
    );

    await connection.commit();

    if (!result.affectedRows) {
      return res.status(404).json({ error: "Product not found" });
    }

    res.json({ success: true });
  } catch (err) {
    await connection.rollback();
    res.status(500).json({ error: err.message });
  } finally {
    connection.release();
  }
});

export default router;
