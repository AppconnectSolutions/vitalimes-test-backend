import express from "express";
import pool from "../db.js";
import { sendMail } from "../mailer.js";

const router = express.Router();

router.post("/", async (req, res) => {
  try {
    const { name, email, productId, rating, message } = req.body;

    if (!name || !email || !productId || !rating || !message) {
      return res.status(400).json({ success: false, error: "All fields are required" });
    }

    // 1️⃣ Fetch product name from DB
    const [[product]] = await pool.query(
      "SELECT title FROM products WHERE id = ?", 
      [productId]
    );
    const productName = product ? product.title : "Unknown Product";

    // 2️⃣ Save feedback to DB
    await pool.query(
      `INSERT INTO product_feedback (name, email, product_id, rating, message)
       VALUES (?, ?, ?, ?, ?)`,
      [name, email, productId, rating, message]
    );

    // 3️⃣ Fetch admin emails from DB
    const [admins] = await pool.query(
      "SELECT email FROM admin_users WHERE role IN ('ADMIN','STAFF') AND email IS NOT NULL"
    );
    const adminEmails = admins.map(a => a.email);

    // 4️⃣ Send email to admin
    if (adminEmails.length) {
      const html = `
        <h2>New Product Feedback</h2>
        <p><b>Name:</b> ${name}</p>
        <p><b>Email:</b> ${email}</p>
        <p><b>Product:</b> ${productName}</p>
        <p><b>Rating:</b> ${rating} / 5</p>
        <p><b>Feedback:</b> ${message}</p>
      `;
      await sendMail({
        bcc: adminEmails.join(","),
        subject: `Feedback for ${productName}`,
        html,
      });
    }

    // 5️⃣ Optional: Auto-reply to user
    await sendMail({
      to: email,
      subject: `Thank you for your feedback on ${productName}`,
      html: `
        <p>Hi ${name},</p>
        <p>Thank you for your feedback on <b>${productName}</b>. We appreciate your opinion!</p>
        <p>— Support Team</p>
      `,
    });

    res.json({ success: true, message: "Feedback submitted successfully" });
  } catch (err) {
    console.error("FEEDBACK ERROR:", err);
    res.status(500).json({ success: false, error: "Server error" });
  }
});

router.get("/", async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT pf.id, pf.name AS user_name, pf.message, pf.rating, 
             p.title AS product_name, p.image1 AS product_image
      FROM product_feedback pf
      JOIN products p ON pf.product_id = p.id
      ORDER BY pf.id DESC
      LIMIT 10
    `);

    // If images are stored in backend/uploads/products/
    const updatedRows = rows.map(row => ({
      ...row,
      product_image: `http://localhost:5000/uploads/products/${row.product_image}`
    }));

    res.json({ success: true, feedbacks: updatedRows });
  } catch (err) {
    console.error("FETCH FEEDBACK ERROR:", err);
    res.status(500).json({ success: false, error: "Server error" });
  }
});


export default router;
