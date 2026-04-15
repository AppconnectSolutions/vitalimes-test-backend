import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import multer from "multer";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import axios from "axios";

import productRoutes from "./routes/products.js";
import categoryRoutes from "./routes/categories.js";
import orderRoutes from "./routes/orders.js";
import paymentRoutes from "./routes/payment.js";
import shipmentRoutes from "./routes/shipment.js";
import authRoutes from "./routes/auth.js";
import dashboardRoutes from "./routes/dashboard.js";
import feedbackRoutes from "./routes/feedback.js";

dotenv.config();

const app = express();

/* =========================================================
   TRUST PROXY (IMPORTANT FOR DOKPLOY / TRAEFIK)
========================================================= */
app.set("trust proxy", 1);

/* =========================================================
   BODY PARSERS
========================================================= */
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

/* =========================================================
   CORS CONFIG (PRODUCTION SAFE)
========================================================= */
const allowedOrigins = new Set([
  "https://vitalimes.com",
  "https://appconnect.cloud",
  "https://vitalimes-frontend-sbwube-c11f73-72-61-237-203.traefik.me",
  "http://localhost:5173",
  "http://localhost:5174",
]);

const corsOptions = {
  origin: (origin, cb) => {
    if (!origin) return cb(null, true);
    if (allowedOrigins.has(origin)) return cb(null, true);
    return cb(new Error(`CORS blocked for origin: ${origin}`));
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: [
    "content-type",
    "authorization",
    "cache-control",
    "pragma",
    "x-requested-with",
  ],
  exposedHeaders: ["authorization"],
  optionsSuccessStatus: 204,
};


app.use(cors(corsOptions));

/**
 * ✅ Express 5 fix:
 * app.options("*", ...) breaks in path-to-regexp v6
 * Use regex instead
 */
app.options(/.*/, cors(corsOptions));

/* =========================================================
   MULTER (MEMORY STORAGE)
========================================================= */
const upload = multer({ storage: multer.memoryStorage() });

/* =========================================================
   MINIO / S3 CLIENT
========================================================= */
const s3 = new S3Client({
  endpoint: process.env.MINIO_ENDPOINT, // e.g. http://vitalimes-minio-tluja8:9000
  region: "us-east-1",
  credentials: {
    accessKeyId: process.env.MINIO_ACCESS_KEY,
    secretAccessKey: process.env.MINIO_SECRET_KEY,
  },
  forcePathStyle: true,
});

/* =========================================================
   FILE UPLOAD API
========================================================= */
app.post("/api/uploads", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });

    const safeName = req.file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, "_");
    const fileName = `uploads/product-${Date.now()}-${safeName}`;

    await s3.send(
      new PutObjectCommand({
        Bucket: process.env.MINIO_BUCKET,
        Key: fileName,
        Body: req.file.buffer,
        ContentType: req.file.mimetype,
      })
    );

    const fileUrl = `${process.env.MINIO_PUBLIC_URL}/${process.env.MINIO_BUCKET}/${fileName}`;

    return res.json({ message: "Upload successful", url: fileUrl });
  } catch (err) {
    console.error("Upload error:", err);
    return res.status(500).json({ error: "Upload failed" });
  }
});

/* =========================================================
   IMAGE PROXY (MINIO → EXPRESS)
   ✅ Express 5 safe: use REGEX, not "/images/*"
   URL example: /images/uploads/about_banner.png
========================================================= */
app.get(/^\/images\/(.+)/, async (req, res) => {
  try {
    const key = decodeURIComponent(req.params[0]); // "uploads/about_banner.png"
    const minioUrl = `${process.env.MINIO_PUBLIC_URL}/${process.env.MINIO_BUCKET}/${key}`;

    const response = await axios.get(minioUrl, { responseType: "stream" });

    res.setHeader(
      "Content-Type",
      response.headers["content-type"] || "application/octet-stream"
    );
    res.setHeader("Cache-Control", "public, max-age=86400");

    response.data.pipe(res);
  } catch (error) {
    console.error("Image fetch error:", error.message);
    res.status(404).send("Image not found");
  }
});

/* =========================================================
   API ROUTES
========================================================= */
app.use("/api/products", productRoutes);
app.use("/api/categories", categoryRoutes);
app.use("/api/orders", orderRoutes);
app.use("/api/payment", paymentRoutes);
app.use("/api/shipments", shipmentRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/feedback", feedbackRoutes);

/* =========================================================
   ROOT
========================================================= */
app.get("/", (req, res) => {
  res.send("Backend running ✔");
});

/* =========================================================
   SERVER START
========================================================= */
const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});
