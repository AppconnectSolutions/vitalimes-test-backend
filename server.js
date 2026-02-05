import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import multer from "multer";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import productRoutes from "./routes/products.js";
import categoryRoutes from "./routes/categories.js";
import orderRoutes from "./routes/orders.js";
import paymentRoutes from "./routes/payment.js";
import shipmentRoutes from "./routes/shipment.js";
import authRoutes from "./routes/auth.js";
import dashboardRoutes from "./routes/dashboard.js";
import axios from "axios";

dotenv.config();

const app = express();

/* =========================================================
   TRUST PROXY (IMPORTANT FOR DOKPLOY / TRAEFIK)
========================================================= */
app.set("trust proxy", 1);

/* =========================================================
   CORS CONFIG (PRODUCTION SAFE)
========================================================= */
const corsOptions = {
  origin: "https://vitalimes.com", // ONLY frontend
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  exposedHeaders: ["Authorization"]
};

app.use(cors(corsOptions));

/* =========================================================
   HANDLE PREFLIGHT REQUESTS (CRITICAL FIX)
========================================================= */
app.use((req, res, next) => {
  if (req.method === "OPTIONS") {
    res.header("Access-Control-Allow-Origin", "https://vitalimes.com");
    res.header("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
    res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.header("Access-Control-Allow-Credentials", "true");
    return res.sendStatus(204);
  }
  next();
});

/* =========================================================
   BODY PARSERS
========================================================= */
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

/* =========================================================
   MULTER (MEMORY STORAGE)
========================================================= */
const upload = multer({ storage: multer.memoryStorage() });

/* =========================================================
   MINIO / S3 CLIENT
========================================================= */
const s3 = new S3Client({
  endpoint: process.env.MINIO_ENDPOINT,
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
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

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

    res.json({
      message: "Upload successful",
      url: fileUrl,
    });
  } catch (err) {
    console.error("Upload error:", err);
    res.status(500).json({ error: "Upload failed" });
  }
});

/* =========================================================
   IMAGE PROXY (MINIO → EXPRESS)
========================================================= */
app.get("/images/:filename", async (req, res) => {
  try {
    const filename = decodeURIComponent(req.params.filename);
    const minioUrl = `${process.env.MINIO_PUBLIC_URL}/${process.env.MINIO_BUCKET}/${filename}`;

    const response = await axios.get(minioUrl, { responseType: "stream" });
    res.setHeader("Content-Type", response.headers["content-type"]);
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

