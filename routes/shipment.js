import express from "express";
import pool from "../db.js";

const router = express.Router();

/* ============================================================
   1️⃣ CREATE SHIPMENT
============================================================ */
router.post("/create", async (req, res) => {
  try {
    const data = req.body;

    const sql = `
      INSERT INTO shipments 
      (
        order_no,
        name,
        city,
        state,
        country,
        address,
        pin,
        phone,
        mobile,
        quantity,
        total_amount,
        order_date,
        waybill,
        weight,
        shipment_length,
        shipment_breadth,
        shipment_height,
        payment_mode,
        cod_amount,
        products_desc,
        shipping_mode,
        fragile_item,
        ship_date,
        barcode_value,
        barcode_image
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    await pool.query(sql, [
      data.order_no,
      data.name,
      data.city,
      data.state,
      data.country,
      data.address,
      data.pin,
      data.phone,
      data.mobile,
      data.quantity,
      data.total_amount,
      data.order_date,
      data.waybill,
      data.weight,
      data.shipment_length,
      data.shipment_breadth,
      data.shipment_height,
      data.payment_mode,
      data.cod_amount,
      data.products_desc, // keep description
      data.shipping_mode,
      data.fragile_item,

      // NEW FIELDS
      data.ship_date || null,
      data.barcode_value || null,
      data.barcode_image || null,
    ]);

    res.json({ success: true, message: "Shipment created successfully" });
  } catch (err) {
    console.log(err);
    res
      .status(500)
      .json({ success: false, error: "Failed to create shipment" });
  }
});

/* ============================================================
   2️⃣ FETCH ALL SHIPMENTS
   ✅ NOW JOINING ORDERS TO GET invoice_no, order_date, total_amount
============================================================ */
router.get("/all", async (req, res) => {
  try {
    const [rows] = await pool.query(
      `
      SELECT
        s.*,
        o.invoice_no   AS invoice_no,
        o.order_date   AS order_date,
        o.total_amount AS total_amount
      FROM shipments s
      LEFT JOIN orders o
        ON o.order_no = s.order_no
      ORDER BY s.id DESC
      `
    );

    res.json({ success: true, shipments: rows });
  } catch (err) {
    console.log(err);
    res
      .status(500)
      .json({ success: false, error: "Failed to load shipments" });
  }
});

/* ============================================================
   3️⃣ FETCH SINGLE SHIPMENT by ID
============================================================ */
router.get("/get/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const [rows] = await pool.query("SELECT * FROM shipments WHERE id = ?", [
      id,
    ]);

    if (!rows.length)
      return res.json({ success: false, message: "Shipment not found" });

    res.json({ success: true, shipment: rows[0] });
  } catch (err) {
    console.log(err);
    res
      .status(500)
      .json({ success: false, error: "Failed to fetch shipment" });
  }
});

/* ============================================================
   4️⃣ FETCH SHIPMENT BY ORDER NUMBER
============================================================ */
router.get("/order/:order_no", async (req, res) => {
  try {
    const { order_no } = req.params;

    const [rows] = await pool.query(
      "SELECT * FROM shipments WHERE order_no = ?",
      [order_no]
    );

    if (!rows.length)
      return res.json({ success: false, message: "No shipment found" });

    res.json({ success: true, shipment: rows[0] });
  } catch (err) {
    console.log(err);
    res
      .status(500)
      .json({ success: false, error: "Failed to fetch order shipment" });
  }
});

/* ============================================================
   5️⃣ UPDATE SHIPMENT (FULL)
============================================================ */
router.put("/update/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const data = req.body;

    const sql = `
      UPDATE shipments SET
        waybill = ?,
        weight = ?,
        shipment_length = ?,
        shipment_breadth = ?,
        shipment_height = ?,
        payment_mode = ?,
        cod_amount = ?,
        products_desc = ?,
        shipping_mode = ?,
        fragile_item = ?,
        ship_date = ?,
        barcode_value = ?,
        barcode_image = ?
      WHERE id = ?
    `;

    await pool.query(sql, [
      data.waybill,
      data.weight,
      data.shipment_length,
      data.shipment_breadth,
      data.shipment_height,
      data.payment_mode,
      data.cod_amount,
      data.products_desc,
      data.shipping_mode,
      data.fragile_item,
      data.ship_date,
      data.barcode_value,
      data.barcode_image,
      id,
    ]);

    res.json({ success: true, message: "Shipment updated successfully" });
  } catch (err) {
    console.log(err);
    res
      .status(500)
      .json({ success: false, error: "Failed to update shipment" });
  }
});

/* ============================================================
   6️⃣ DELETE SHIPMENT
============================================================ */
router.delete("/delete/:id", async (req, res) => {
  try {
    const { id } = req.params;

    await pool.query("DELETE FROM shipments WHERE id = ?", [id]);

    res.json({ success: true, message: "Shipment deleted successfully" });
  } catch (err) {
    console.log(err);
    res
      .status(500)
      .json({ success: false, error: "Failed to delete shipment" });
  }
});

export default router;
