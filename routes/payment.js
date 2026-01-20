import express from "express";
import Razorpay from "razorpay";
import dotenv from "dotenv";

dotenv.config();

const router = express.Router();

// 🔥 Razorpay instance
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

// TEST ROUTE
router.get("/test", (req, res) => {
  res.send("Payment route working ✔️");
});

// CREATE PAYMENT
router.post("/create-payment", async (req, res) => {
  try {
    const { amount } = req.body;

    const order = await razorpay.orders.create({
      amount: amount * 100,
      currency: "INR",
      receipt: "VTL-" + Date.now(),
    });

    return res.json({
      success: true,
      order,
      key: process.env.RAZORPAY_KEY_ID,
    });
  } catch (err) {
    console.error("Razorpay Error:", err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
