// routes/dashboard.js
import express from "express";
import pool from "../db.js";

const router = express.Router();

router.get("/", async (req, res) => {
  try {
    // Revenue
    let revenue = 0;
    try {
      const [rows] = await pool.query(
        `SELECT IFNULL(SUM(total_amount),0) AS total_revenue 
         FROM orders 
         WHERE payment_status='PAID'`
      );
      revenue = rows?.[0]?.total_revenue || 0;
    } catch (err) {
      console.error("Revenue query failed:", err.message);
    }

    // Orders count
    let ordersCount = { total: 0, pending: 0, delivered: 0 };
    try {
      const [rows] = await pool.query(
        `SELECT 
           COUNT(*) AS total_orders,
           SUM(CASE WHEN status='PENDING' THEN 1 ELSE 0 END) AS pending_orders,
           SUM(CASE WHEN status IN ('SHIPPED','DELIVERED') THEN 1 ELSE 0 END) AS delivered_orders
         FROM orders`
      );
      ordersCount = {
        total: rows?.[0]?.total_orders || 0,
        pending: rows?.[0]?.pending_orders || 0,
        delivered: rows?.[0]?.delivered_orders || 0,
      };
    } catch (err) {
      console.error("Orders count query failed:", err.message);
    }

    // Products count
    let productsCount = 0;
    try {
      const [rows] = await pool.query(
        `SELECT COUNT(*) AS total_products 
         FROM products 
         WHERE status='Active'`
      );
      productsCount = rows?.[0]?.total_products || 0;
    } catch (err) {
      console.error("Products count query failed:", err.message);
    }

    // Monthly revenue
    let monthlyRevenue = [];
    try {
      const [rows] = await pool.query(
        `SELECT DATE_FORMAT(invoice_date,'%b %Y') AS month, 
                IFNULL(SUM(total_amount),0) AS revenue
         FROM orders
         WHERE payment_status='PAID'
           AND invoice_date >= DATE_SUB(CURDATE(), INTERVAL 12 MONTH)
         GROUP BY YEAR(invoice_date), MONTH(invoice_date)
         ORDER BY YEAR(invoice_date), MONTH(invoice_date)`
      );
      monthlyRevenue = rows;
    } catch (err) {
      console.error("Monthly revenue query failed:", err.message);
    }

    // Monthly orders
    let monthlyOrders = [];
    try {
      const [rows] = await pool.query(
        `SELECT DATE_FORMAT(invoice_date,'%b %Y') AS month,
                COUNT(*) AS orders
         FROM orders
         WHERE invoice_date >= DATE_SUB(CURDATE(), INTERVAL 12 MONTH)
         GROUP BY YEAR(invoice_date), MONTH(invoice_date)
         ORDER BY YEAR(invoice_date), MONTH(invoice_date)`
      );
      monthlyOrders = rows;
    } catch (err) {
      console.error("Monthly orders query failed:", err.message);
    }

    res.json({
      success: true,
      revenue,
      ordersCount,
      productsCount,
      monthlyRevenue,
      monthlyOrders,
    });
  } catch (err) {
    console.error("Dashboard API Error:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;

