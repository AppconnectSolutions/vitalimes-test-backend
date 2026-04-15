// routes/dashboard.js
import express from "express";
import pool from "../db.js";

const router = express.Router();

/* =======================================================
   GET DASHBOARD DATA
======================================================= */
router.get("/", async (req, res) => {
  try {
    // 1️⃣ Total Revenue (only PAID orders)
    const [revenueRows] = await pool.query(
      `SELECT IFNULL(SUM(total_amount),0) AS total_revenue 
       FROM orders 
       WHERE payment_status='PAID'`
    );
    const revenue = revenueRows[0].total_revenue;

    // 2️⃣ Orders count
    const [ordersRows] = await pool.query(
      `SELECT 
         COUNT(*) AS total_orders,
         SUM(CASE WHEN status='PENDING' THEN 1 ELSE 0 END) AS pending_orders,
         SUM(CASE WHEN status IN ('SHIPPED','DELIVERED') THEN 1 ELSE 0 END) AS delivered_orders
       FROM orders`
    );
    const ordersCount = {
      total: ordersRows[0].total_orders,
      pending: ordersRows[0].pending_orders,
      delivered: ordersRows[0].delivered_orders
    };

    // 3️⃣ Products count
    const [productsRows] = await pool.query(
      `SELECT COUNT(*) AS total_products 
       FROM products 
       WHERE status='Active'`
    );
    const productsCount = productsRows[0].total_products;

    // 4️⃣ Revenue per month (last 12 months)
    const [monthlyRevenue] = await pool.query(
      `SELECT DATE_FORMAT(invoice_date,'%b %Y') AS month, 
              IFNULL(SUM(total_amount),0) AS revenue
       FROM orders
       WHERE payment_status='PAID'
         AND invoice_date >= DATE_SUB(CURDATE(), INTERVAL 12 MONTH)
       GROUP BY YEAR(invoice_date), MONTH(invoice_date)
       ORDER BY YEAR(invoice_date), MONTH(invoice_date)`
    );

    // 5️⃣ Orders per month (last 12 months)
    const [monthlyOrders] = await pool.query(
      `SELECT DATE_FORMAT(invoice_date,'%b %Y') AS month,
              COUNT(*) AS orders
       FROM orders
       WHERE invoice_date >= DATE_SUB(CURDATE(), INTERVAL 12 MONTH)
       GROUP BY YEAR(invoice_date), MONTH(invoice_date)
       ORDER BY YEAR(invoice_date), MONTH(invoice_date)`
    );

    res.json({
      success: true,
      revenue,
      ordersCount,
      productsCount,
      monthlyRevenue,
      monthlyOrders
    });
  } catch (err) {
    console.error("Dashboard API Error:", err);
    res.status(500).json({ success: false, error: "Server error" });
  }
});

export default router;
