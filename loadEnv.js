import dotenv from "dotenv";
dotenv.config();

console.log("Loaded ENV:", {
  key: process.env.RAZORPAY_KEY_ID,
  secret: process.env.RAZORPAY_KEY_SECRET ? "present" : "missing",
});
