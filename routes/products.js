import express from "express";
import db from "../db.js";
import multer from "multer";
import { minioClient, MINIO_BUCKET } from "../config/minio.js";

const router = express.Router();

/* ===============================
   ENV
================================ */
const MINIO_PUBLIC_URL =
  (process.env.MINIO_PUBLIC_URL || "").replace(/\/$/, "");

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
 * Convert stored key → public MinIO URL
 */
function normalizeImageValue(val) {
  if (!val) return null;

  const s = String(val).trim();

  // Already full URL
  if (/^https?:\/\//i.test(s)) return s;

  const key = s.startsWith("uploads/") ? s : `uploads/${s}`;

  return `${MINIO_PUBLIC_URL}/${MINIO_BUCKET}/${encodeKeyForPath(key)}`;
}

/**
 * API → DB
 * Always store only object key
 */
function normalizeForStorage(val) {
  if (!val) return null;

  const s = String(val).trim();

  // Full MinIO URL
  if (s.includes(`/${MINIO_BUCKET}/`)) {
    return s.split(`/${MINIO_BUCKET}/`)[1];
  }

  // Already key
  if (s.startsWith("uploads/")) return s;

  // Filename only
  return `uploads/${s}`;
}

/* ===============================
   MULTER (memory)
================================ */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
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

/* ===============================
   GET ALL PRODUCTS
================================ */
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

/* ===============================
   GET SINGLE PRODUCT
================================ */
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

/* ===============================
   ADD PRODUCT
================================ */
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

    const storedImages = images.map(normalizeForStorage);

    const imageList = Array(6).fill(null);
    storedImages.slice(0, 6).forEach((v, i) => (imageList[i] = v));

    const [result] = await connection.query(
      `INSERT INTO products
      (title, description, category, hsn, status, units,
       image1, image2, image3, image4, image5, image6,
       video, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
      [
        title,
        description,
        category,
        hsn,
        status,
        units,
        ...imageList,
        video,
      ]
    );

    const productId = result.insertId;

    const variantList =
      typeof variants === "string" ? JSON.parse(variants) : variants || [];

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

    const [[product]] = await db.query(
      `SELECT * FROM products WHERE id = ?`,
      [productId]
    );

    const [productVariants] = await db.query(
      `SELECT * FROM product_variants WHERE product_id = ?`,
      [productId]
    );

    product.variants = productVariants;

    for (let i = 1; i <= 6; i++) {
      product[`image${i}`] = normalizeImageValue(product[`image${i}`]);
    }

    res.json({ success: true, product });
  } catch (err) {
    await connection.rollback();
    res.status(500).json({ error: err.message });
  } finally {
    connection.release();
  }
});

/* ===============================
   UPDATE PRODUCT
================================ */
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

    const storedImages = images.map(normalizeForStorage);
    const imageList = Array(6).fill(null);
    storedImages.slice(0, 6).forEach((v, i) => (imageList[i] = v));

    await connection.query(
      `UPDATE products SET
       title=?, description=?, category=?, hsn=?, status=?, units=?,
       image1=?, image2=?, image3=?, image4=?, image5=?, image6=?, video=?
       WHERE id=?`,
      [
        title,
        description,
        category,
        hsn,
        status,
        units,
        ...imageList,
        video,
        req.params.id,
      ]
    );

    await connection.query(
      `DELETE FROM product_variants WHERE product_id=?`,
      [req.params.id]
    );

    const variantList =
      typeof variants === "string" ? JSON.parse(variants) : variants || [];

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

    res.json({ success: true, message: "Product updated successfully" });
  } catch (err) {
    await connection.rollback();
    res.status(500).json({ error: err.message });
  } finally {
    connection.release();
  }
});

/* ===============================
   DELETE PRODUCT
================================ */
router.delete("/:id", async (req, res) => {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();

    await connection.query(
      `DELETE FROM product_variants WHERE product_id=?`,
      [req.params.id]
    );

    const [result] = await connection.query(
      `DELETE FROM products WHERE id=?`,
      [req.params.id]
    );

    await connection.commit();

    if (!result.affectedRows) {
      return res.status(404).json({ error: "Product not found" });
    }

    res.json({ success: true, message: "Product deleted" });
  } catch (err) {
    await connection.rollback();
    res.status(500).json({ error: err.message });
  } finally {
    connection.release();
  }
});

export default router;
