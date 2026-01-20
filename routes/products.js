import express from "express";
import db from "../db.js";

import multer from "multer";

import { minioClient, MINIO_BUCKET } from "../config/minio.js";






const router = express.Router();

/* ---------------- Helpers ---------------- */
const PORT = process.env.PORT || 5000;
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, "");


const MINIO_PUBLIC_URL = (process.env.MINIO_PUBLIC_URL || process.env.MINIO_ENDPOINT || "").replace(/\/$/, "");

function encodeKeyForPath(key) {
  return String(key)
    .split("/")
    .map(encodeURIComponent)
    .join("/");
}

const upload = multer({ storage: multer.memoryStorage() });

function toProxyUrl(key) {
  // serve through backend (recommended if your website is https)
  return `${PUBLIC_BASE_URL}/uploads/${encodeKeyForPath(key)}`;
}

function toMinioUrl(key) {
  // direct from MinIO public bucket
  return `${MINIO_PUBLIC_URL}/${MINIO_BUCKET}/${encodeKeyForPath(key)}`;
}

function normalizeImageValue(val) {
  if (!val) return null;
  const s = String(val).trim();

  // Already a full URL
  if (/^http?:\/\//i.test(s)) return s;

  // If stored like "uploads/xxx.png" keep it.
  // If stored like "xxx.png" also allow it (still in uploads folder)
  const key = s.startsWith("uploads/") ? s : `uploads/${s}`;

  // Choose ONE:
  // 1) If you want to avoid SSL/mixed-content issues in production => use proxyUrl
  return toProxyUrl(key);

  // 2) If you ONLY want direct MinIO public URL, use below instead:
  // return toMinioUrl(key);
}

function normalizeForStorage(val) {
  // store only the object key in DB (recommended)
  if (!val) return null;
  const s = String(val).trim();

  // if frontend sends full MinIO url like http://host:9000/bucket/uploads/xxx.png
  if (s.includes(`/${MINIO_BUCKET}/`)) {
    const idx = s.indexOf(`/${MINIO_BUCKET}/`);
    return s.slice(idx + (`/${MINIO_BUCKET}/`).length); // returns key: uploads/xxx.png
  }

  // if frontend sends proxy url like http://api/uploads/uploads/xxx.png
  if (s.includes(`/uploads/`)) {
    const idx = s.indexOf(`/uploads/`);
    return decodeURIComponent(s.slice(idx + `/uploads/`.length)); // returns key
  }

  // else assume it is key or filename
  return s.startsWith("uploads/") ? s : `uploads/${s}`;
}



router.post("/upload", upload.single("file"), async (req, res) => {
  try {
    const bucket = process.env.MINIO_BUCKET;
    const objectName = `uploads/${Date.now()}-${req.file.originalname}`;

    await minioClient.putObject(bucket, objectName, req.file.buffer);

    res.json({ success: true, key: objectName });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ==================================================
   GET ALL PRODUCTS
================================================== */
router.get("/", async (req, res) => {
  try {
    const status = req.query.status || "Active";
    const [products] = await db.query(`SELECT * FROM products WHERE status = ?`, [status]);

    for (const p of products) {
      const [variants] = await db.query(`SELECT * FROM product_variants WHERE product_id = ?`, [p.id]);
      p.variants = variants;

      // Convert images to URLs for UI
      p.image1 = normalizeImageValue(p.image1);
      p.image2 = normalizeImageValue(p.image2);
      p.image3 = normalizeImageValue(p.image3);
      p.image4 = normalizeImageValue(p.image4);
      p.image5 = normalizeImageValue(p.image5);
      p.image6 = normalizeImageValue(p.image6);
    }

    res.json({ success: true, products });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ==================================================
   GET SINGLE PRODUCT
================================================== */
router.get("/:id", async (req, res) => {
  try {
    const [[product]] = await db.query(`SELECT * FROM products WHERE id = ?`, [req.params.id]);
    if (!product) return res.status(404).json({ error: "Product not found" });

    const [variants] = await db.query(`SELECT * FROM product_variants WHERE product_id = ?`, [req.params.id]);
    product.variants = variants;

    product.image1 = normalizeImageValue(product.image1);
    product.image2 = normalizeImageValue(product.image2);
    product.image3 = normalizeImageValue(product.image3);
    product.image4 = normalizeImageValue(product.image4);
    product.image5 = normalizeImageValue(product.image5);
    product.image6 = normalizeImageValue(product.image6);

    res.json({ product });
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

    // store keys in DB (not full URL)
    const storedImages = (Array.isArray(images) ? images : []).map(normalizeForStorage);

    const imageList = Array(6).fill(null);
    storedImages.forEach((v, idx) => {
      if (idx < 6) imageList[idx] = v;
    });

    const [result] = await connection.query(
      `INSERT INTO products
      (title, description, category, hsn, status, units,
       image1, image2, image3, image4, image5, image6, video, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
      [title, description, category, hsn, status, units, ...imageList, video]
    );

    const productId = result.insertId;

    const variantList = typeof variants === "string" ? JSON.parse(variants) : variants || [];
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

    const [[product]] = await connection.query(`SELECT * FROM products WHERE id = ?`, [productId]);
    const [productVariants] = await connection.query(`SELECT * FROM product_variants WHERE product_id = ?`, [productId]);
    product.variants = productVariants;

    // return URLs to UI
    product.image1 = normalizeImageValue(product.image1);
    product.image2 = normalizeImageValue(product.image2);
    product.image3 = normalizeImageValue(product.image3);
    product.image4 = normalizeImageValue(product.image4);
    product.image5 = normalizeImageValue(product.image5);
    product.image6 = normalizeImageValue(product.image6);

    res.json({ success: true, product });
  } catch (err) {
    await connection.rollback();
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

    const storedImages = (Array.isArray(images) ? images : []).map(normalizeForStorage);
    const imageList = Array(6).fill(null);
    storedImages.forEach((v, idx) => {
      if (idx < 6) imageList[idx] = v;
    });

    await connection.query(
      `UPDATE products SET
       title = ?, description = ?, category = ?, hsn = ?, status = ?, units = ?,
       image1 = ?, image2 = ?, image3 = ?, image4 = ?, image5 = ?, image6 = ?, video = ?
       WHERE id = ?`,
      [title, description, category, hsn, status, units, ...imageList, video, req.params.id]
    );

    // Delete old variants
    await connection.query(`DELETE FROM product_variants WHERE product_id = ?`, [req.params.id]);

    // Insert new variants
    const variantList = typeof variants === "string" ? JSON.parse(variants) : variants || [];
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

    const [[product]] = await connection.query(`SELECT * FROM products WHERE id = ?`, [req.params.id]);
    const [productVariants] = await connection.query(`SELECT * FROM product_variants WHERE product_id = ?`, [req.params.id]);
    product.variants = productVariants;

    product.image1 = normalizeImageValue(product.image1);
    product.image2 = normalizeImageValue(product.image2);
    product.image3 = normalizeImageValue(product.image3);
    product.image4 = normalizeImageValue(product.image4);
    product.image5 = normalizeImageValue(product.image5);
    product.image6 = normalizeImageValue(product.image6);

    res.json({ success: true, product });
  } catch (err) {
    await connection.rollback();
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

    await connection.query(`DELETE FROM product_variants WHERE product_id = ?`, [req.params.id]);
    const [result] = await connection.query(`DELETE FROM products WHERE id = ?`, [req.params.id]);

    await connection.commit();

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "Product not found" });
    }

    res.json({ success: true, message: "Product deleted successfully" });
  } catch (err) {
    await connection.rollback();
    res.status(500).json({ error: err.message });
  } finally {
    connection.release();
  }
});


export default router;
