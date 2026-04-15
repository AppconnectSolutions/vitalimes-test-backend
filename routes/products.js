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
   HELPERS (❌ DO NOT CHANGE)
================================ */
function encodeKeyForPath(key) {
  return String(key).split("/").map(encodeURIComponent).join("/");
}

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

/* 🔥 REQUIRED FOR FORM DATA (FIX) */
const productUpload = upload.fields([
  { name: "image1", maxCount: 1 },
  { name: "image2", maxCount: 1 },
  { name: "image3", maxCount: 1 },
  { name: "image4", maxCount: 1 },
  { name: "image5", maxCount: 1 },
  { name: "image6", maxCount: 1 },
  { name: "video", maxCount: 1 },
]);

/* ===============================
   UPLOAD IMAGE (UNCHANGED)
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
    res.status(500).json({ error: err.message });
  }
});

/* ==================================================
   GET ALL PRODUCTS (UNCHANGED)
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
    res.status(500).json({ error: err.message });
  }
});

/* ==================================================
   GET SINGLE PRODUCT (UNCHANGED)
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
   ADD PRODUCT (✅ FIXED)
================================================== */
router.post("/", productUpload, async (req, res) => {
  const connection = await db.getConnection();

  // helper: safe JSON parse
  const parseJson = (v, def) => {
    try {
      if (!v) return def;
      if (typeof v === "string") return JSON.parse(v);
      return v; // already object/array
    } catch {
      return def;
    }
  };

  try {
    // ✅ accept both title and name
    const title = String(req.body.title || req.body.name || "").trim();
    const category = String(req.body.category || req.body.category_id || "").trim();

    const description = req.body.description ?? null;
    const hsn = req.body.hsn ?? null;
    const status = req.body.status || "Active";
    const units = req.body.units ?? null;

    if (!title || !category) {
      return res.status(400).json({ success: false, error: "Title & category required" });
    }

    await connection.beginTransaction();

    // ✅ upload only provided files
    const imageList = Array(6).fill(null);

    for (let i = 1; i <= 6; i++) {
      const file = req.files?.[`image${i}`]?.[0];
      if (file) {
        const key = `uploads/${Date.now()}-${file.originalname}`;
        await minioClient.putObject(
          MINIO_BUCKET,
          key,
          file.buffer,
          file.size,
          { "Content-Type": file.mimetype }
        );
        imageList[i - 1] = key; // store key in DB
      }
    }

    const [result] = await connection.query(
      `INSERT INTO products
       (title, description, category, hsn, status, units,
        image1,image2,image3,image4,image5,image6, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,NOW())`,
      [title, description, category, hsn, status, units, ...imageList]
    );

    const productId = result.insertId;

    // ✅ if variants insert fails, whole product will rollback
    const variantList = parseJson(req.body.variants, []);

    for (const v of variantList) {
      await connection.query(
        `INSERT INTO product_variants
         (product_id, weight, price, sale_price, offer_percent,
          tax_percent, tax_amount, stock)
         VALUES (?,?,?,?,?,?,?,?)`,
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
    return res.json({ success: true, productId });
  } catch (err) {
    // ✅ ALWAYS log full error (this is what you need)
    console.error("🔥 ADD PRODUCT ERROR:", {
      message: err.message,
      code: err.code,
      errno: err.errno,
      sqlMessage: err.sqlMessage,
      sql: err.sql,
    });

    try { await connection.rollback(); } catch {}

    return res.status(500).json({
      success: false,
      error: err.sqlMessage || err.message,
    });
  } finally {
    connection.release();
  }
});

/* ==================================================
   UPDATE PRODUCT (✅ FIXED)
================================================== */
router.put("/:id", productUpload, async (req, res) => {
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
    } = req.body;

    const imageList = Array(6).fill(null);

    for (let i = 1; i <= 6; i++) {
      const file = req.files?.[`image${i}`]?.[0];
      if (file) {
        const key = `uploads/${Date.now()}-${file.originalname}`;
        await minioClient.putObject(
          MINIO_BUCKET,
          key,
          file.buffer,
          file.size,
          { "Content-Type": file.mimetype }
        );
        imageList[i - 1] = key;
      }
    }

    await connection.query(
      `UPDATE products SET
       title=?, description=?, category=?, hsn=?, status=?, units=?,
       image1=?, image2=?, image3=?, image4=?, image5=?, image6=?
       WHERE id=?`,
      [
        title,
        description,
        category,
        hsn || null,
        status,
        units || null,
        ...imageList,
        req.params.id,
      ]
    );

    await connection.query(
      `DELETE FROM product_variants WHERE product_id=?`,
      [req.params.id]
    );

    const variantList = JSON.parse(variants || "[]");

    for (const v of variantList) {
      await connection.query(
        `INSERT INTO product_variants
        (product_id, weight, price, sale_price,
         offer_percent, tax_percent, tax_amount, stock)
         VALUES (?,?,?,?,?,?,?,?)`,
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
    res.status(500).json({ error: err.message });
  } finally {
    connection.release();
  }
});

/* ==================================================
   DELETE PRODUCT (UNCHANGED)
================================================== */
router.delete("/:id", async (req, res) => {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();

    await connection.query(
      `DELETE FROM product_variants WHERE product_id=?`,
      [req.params.id]
    );
    await connection.query(`DELETE FROM products WHERE id=?`, [
      req.params.id,
    ]);

    await connection.commit();
    res.json({ success: true });
  } catch (err) {
    await connection.rollback();
    res.status(500).json({ error: err.message });
  } finally {
    connection.release();
  }
});

export default router;
