// routes/orders.js
import express from "express";
import pool from "../db.js";
import ExcelJS from "exceljs";
import { sendMail }  from "../mailer.js"; // email
import path from "path";
import fs from "fs";
import { generateInvoicePDF } from "../helpers/invoiceGenerator.js";



const router = express.Router();


function buildInvoiceHTML(order, products) {
  let rowsHTML = products.map((p, idx) => `
    <tr>
      <td>${idx + 1}</td>
      <td>${p.title}</td>
      <td>${p.qty}</td>
      <td>₹${p.sale_price || p.price}</td>
      <td>₹${(p.qty * (p.sale_price || p.price)).toFixed(2)}</td>
    </tr>
  `).join("");

  return `
    <h3>Invoice for Order ${order.order_no}</h3>
    <p>Invoice No: ${order.invoice_no || "-"}</p>
    <p>Invoice Date: ${order.invoice_date?.slice(0,10) || "-"}</p>
    <p>Customer: ${order.name}</p>
    <p>Address: ${order.address}, ${order.city}, ${order.state} - ${order.pin}</p>

    <table border="1" cellpadding="5" cellspacing="0" style="border-collapse: collapse;">
      <thead>
        <tr>
          <th>Sl</th>
          <th>Product</th>
          <th>Qty</th>
          <th>Unit Price</th>
          <th>Total</th>
        </tr>
      </thead>
      <tbody>
        ${rowsHTML}
      </tbody>
    </table>

    <p><strong>Total Amount: ₹${order.total_amount}</strong></p>
  `;
}

/* =======================================================
   SEQUENCE HELPERS
======================================================= */
async function getNextNumber(type, defaultBase = 10000) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

const [rows] = await conn.query("SELECT value FROM counters WHERE type = ? FOR UPDATE", [type]);

   

    let current = defaultBase;

    if (rows.length === 0) {
      await conn.query(
        "INSERT INTO counters (type, value) VALUES (?, ?)",
        [type, defaultBase]
      );
    } else {
      current = rows[0].value;
    }

    const nextVal = current + 1;

    await conn.query(
      "UPDATE counters SET value = ? WHERE type = ?",
      [nextVal, type]
    );

    await conn.commit();
    return nextVal;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}


async function generateOrderNo() {
  const next = await getNextNumber("ORDER", 10000);
  return `VITA-${next}`;
}
function generateInvoiceNoFromOrder(orderNo) {
  return orderNo.replace("VITA-", "INV-VITA-"); // e.g., INV-VITA-10030
}



/* =======================================================
   7️⃣ EXPORT MONTHLY ORDERS TO EXCEL
   GET /api/orders/export-excel?year=2025&month=12
======================================================= */
router.get("/export-excel", async (req, res) => {
  try {
    const year = parseInt(req.query.year, 10);
    const month = parseInt(req.query.month, 10); // 1–12

    if (!year || !month || month < 1 || month > 12) {
      return res
        .status(400)
        .json({ success: false, error: "year & month query params required" });
    }

    const startDate = `${year}-${String(month).padStart(2, "0")}-01 00:00:00`;
    const endDateObj = new Date(year, month, 0); // last day of month
    const endDate = `${endDateObj.getFullYear()}-${String(
      endDateObj.getMonth() + 1
    ).padStart(2, "0")}-${String(endDateObj.getDate()).padStart(2, "0")} 23:59:59`;

    console.log("EXPORT EXCEL RANGE:", startDate, endDate);

    await exportOrdersToExcel(
      startDate,
      endDate,
      res,
      `orders-${year}-${String(month).padStart(2, "0")}.xlsx`
    );
  } catch (err) {
    console.error("EXPORT EXCEL ERROR FULL:", err);
    res.status(500).json({ success: false, error: err.message || "Server error" });
  }
});


// ===== EXPORT EXCEL FOR RANGE =====
// routes/orders.js

// ===== EXPORT EXCEL FOR SINGLE MONTH =====
router.get("/export-excel", async (req, res) => {
  try {
    const year = parseInt(req.query.year, 10);
    const month = parseInt(req.query.month, 10); // 1–12

    if (!year || !month || month < 1 || month > 12) {
      return res
        .status(400)
        .json({ success: false, error: "year & month query params required" });
    }

    const startDate = `${year}-${String(month).padStart(2, "0")}-01`;
    const endDateObj = new Date(year, month, 0); // last day of month
    const endDate = endDateObj.toISOString().slice(0, 10);

    await exportOrdersToExcel(startDate, endDate, res, `orders-${year}-${String(month).padStart(2, "0")}.xlsx`);
  } catch (err) {
    console.error("EXPORT EXCEL ERROR:", err);
    res.status(500).json({ success: false, error: "Server error" });
  }
});

// ===== EXPORT EXCEL FOR RANGE =====
router.get("/export-excel-range", async (req, res) => {
  try {
    const { from, to } = req.query; // 'YYYY-MM' format

    if (!from || !to) {
      return res.status(400).json({ success: false, error: "from & to query params required" });
    }

    const startDate = `${from}-01`;
    const endDateObj = new Date(`${to}-01`);
    endDateObj.setMonth(endDateObj.getMonth() + 1);
    endDateObj.setDate(0); // last day of 'to' month
    const endDate = endDateObj.toISOString().slice(0, 10);

    await exportOrdersToExcel(startDate, endDate, res, `orders-${from}-to-${to}.xlsx`);
  } catch (err) {
    console.error("EXPORT EXCEL RANGE ERROR:", err);
    res.status(500).json({ success: false, error: "Server error" });
  }
});

// ===== HELPER FUNCTION TO EXPORT ORDERS =====
async function exportOrdersToExcel(startDate, endDate, res, fileName) {
  const [rows] = await pool.query(
    `SELECT * FROM orders WHERE invoice_date BETWEEN ? AND ? ORDER BY invoice_date ASC, id ASC`,
    [startDate, endDate]
  );

  const workbook = new ExcelJS.Workbook();
  const ws = workbook.addWorksheet("Orders");

  // Columns with separate weight & unit
  ws.columns = [
    { header: "Sl. No", key: "slno", width: 6 },
    { header: "Order No", key: "order_no", width: 15 },
    { header: "Invoice No", key: "invoice_no", width: 15 },
    { header: "Invoice Date", key: "invoice_date", width: 12 },
    { header: "Customer Name", key: "name", width: 20 },
    { header: "Mobile", key: "mobile", width: 14 },
    { header: "City", key: "city", width: 14 },
    { header: "State", key: "state", width: 14 },
    { header: "PIN", key: "pin", width: 10 },
    { header: "Address", key: "address", width: 35 },
    { header: "Product", key: "product_name", width: 20 },
    { header: "HSN", key: "hsn", width: 12 },
    { header: "Weight", key: "weight", width: 10 },
    { header: "Unit", key: "unit", width: 10 },
    { header: "Qty", key: "qty", width: 8 },
    { header: "Unit Price", key: "unit_price", width: 12 },
    { header: "Net Amount (excl. GST)", key: "net_amount", width: 18 },
    { header: "Tax Rate", key: "tax_rate", width: 10 },
    { header: "Tax Amount", key: "tax_amount", width: 14 },
    { header: "Total Amount", key: "total_amount", width: 14 },
  ];

  ws.getRow(1).font = { bold: true };

  const TAX_RATE = 0.05;
  let rowIndex = 1;

  for (const o of rows) {
    let items = [];
    try {
      items = JSON.parse(o.products_json || "[]");
    } catch (e) {
      items = [];
    }

    if (!items.length) {
      items = [
        {
          title: "Items",
          hsn: "",
          weight: "",
          units: "",
          qty: o.quantity || 1,
          price: Number(o.total_amount || 0),
        },
      ];
    }

    for (const p of items) {
      const qty = Number(p.qty || 1);
      const unitPrice = Number(p.sale_price || p.price || 0);
      const netAmount = +(unitPrice / (1 + TAX_RATE)).toFixed(2);
      const taxAmount = +(unitPrice - netAmount).toFixed(2);
      const totalAmount = +(unitPrice * qty).toFixed(2);

      ws.addRow({
        slno: rowIndex,
        order_no: o.order_no,
        invoice_no: o.invoice_no || "",
        invoice_date: o.invoice_date,
        name: o.name,
        mobile: o.mobile,
        city: o.city,
        state: o.state,
        pin: o.pin,
        address: o.address,
        product_name: p.title || "Product",
        hsn: p.hsn || "",
        weight: p.weight || "",
        unit: p.units || "",
        qty,
        unit_price: unitPrice,
        net_amount: netAmount * qty,
        tax_rate: "5%",
        tax_amount: taxAmount * qty,
        total_amount: totalAmount,
      });

      rowIndex++;
    }
  }

  // Format currency columns (optional)
  ["unit_price", "net_amount", "tax_amount", "total_amount"].forEach((colKey) => {
    ws.getColumn(colKey).numFmt = '₹#,##0.00;[Red]-₹#,##0.00';
  });

  res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  );
  res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);

  await workbook.xlsx.write(res);
  res.end();
}




/* =======================================================
   GET ORDER BY ORDER_NO
======================================================= */
router.get("/get/:order_no", async (req, res) => {
  try {
    const { order_no } = req.params;

    const [rows] = await pool.query(
      "SELECT * FROM orders WHERE order_no = ?",
      [order_no]
    );

    if (!rows.length)
      return res.json({ success: false, message: "Order not found" });

    res.json({ success: true, order: rows[0] });
  } catch (err) {
    console.log("Error fetching order:", err);
    res.status(500).json({ success: false, error: "Server error" });
  }
});

/* =======================================================
   CREATE ORDER AS PENDING
====================================================== */
// routes/orders.js
router.post("/create-order-pending", async (req, res) => {
  try {
    const {
      name,
      city,
      state,
      country,
      address,
      pin,
      email,
      mobile,
      quantity,
      total_amount,
      order_date,
      products,
    } = req.body;

    if (!name || !address || !city || !state || !country || !pin || !mobile) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const order_no = await generateOrderNo();
    const invoiceNo = generateInvoiceNoFromOrder(order_no);

    // Fetch HSN for each product
    const productDetails = await Promise.all(
      (products || []).map(async (p) => {
        const [prodRows] = await pool.query(
          "SELECT hsn FROM products WHERE id = ? LIMIT 1",
          [p.id]
        );
        return {
          id: p.id,
          title: p.title,
          qty: p.qty,
          weight: p.weight || null,
          units: p.units || null,
          price: p.price,
          sale_price: p.sale_price || p.price,
          hsn: prodRows[0]?.hsn || null,
          img: p.img || null,
        };
      })
    );

    const productJSON = JSON.stringify(productDetails);

    const sql = `
      INSERT INTO orders (
        order_no,
        name, city, state, country, address, pin,
        email, phone, mobile,
        quantity, weight, units,
        total_amount, order_date,
        products_json,
        status, payment_status,
        razorpay_payment_id, razorpay_order_id,
        invoice_no,
        invoice_date
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
    `;
    const phone = null;
    const values = [
      order_no,
      name,
      city,
      state,
      country,
      address,
      pin,
      email || null,
      phone,
      mobile,
      quantity,
      products[0]?.weight || null,
      products[0]?.units || null,
      total_amount,
      order_date,
      productJSON,
      "PENDING",
      "NOT_PAID",
      null,
      null,
      null,
    ];

    await pool.query(sql, values);

    res.json({
      success: true,
      message: "Order saved as PENDING",
      order_no,
    });
  } catch (err) {
    console.error("ORDER PENDING ERROR:", err);
    res.status(500).json({ error: "Server error" });
  }
});



/* =======================================================
   GET ALL ORDERS (Admin)
======================================================= */
router.get("/all", async (req, res) => {
  try {
    const [rows] = await pool.query(
      "SELECT * FROM orders ORDER BY id DESC"
    );

    res.json({
      success: true,
      orders: rows,
    });
  } catch (err) {
    console.error("FETCH ORDERS ERROR:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// GET single order by ID
router.get("/:id", async (req, res) => {
  try {
    const orderId = req.params.id;

    const [rows] = await pool.query(
      "SELECT * FROM orders WHERE id = ?",
      [orderId]
    );

    if (!rows.length) {
      return res.status(404).json({ success: false, message: "Order not found" });
    }

    const order = rows[0];

    // Parse products_json
    let products = [];
    try {
      products = JSON.parse(order.products_json || "[]");
    } catch (e) {
      console.error("PRODUCTS_JSON PARSE ERROR:", e);
    }

    res.json({
      success: true,
      order: { ...order, products },
    });
  } catch (err) {
    console.error("FETCH ORDER ERROR:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});


/* =======================================================
   UPDATE ORDER STATUS (Auto Invoice)
======================================================= */
router.post("/update-status", async (req, res) => {
  const { order_no, status } = req.body;

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [rows] = await conn.query(
      "SELECT * FROM orders WHERE order_no = ? FOR UPDATE",
      [order_no]
    );

    if (rows.length === 0) {
      await conn.rollback();
      return res.status(404).json({ success: false, error: "Order not found" });
    }

    const order = rows[0];    
    let invoice_no = rows[0].invoice_no;

    if (status === "SHIPPED" && !invoice_no) {
       invoice_no = generateInvoiceNoFromOrder(order.order_no);
    }

    await conn.query(
      "UPDATE orders SET status = ?, invoice_no = ? WHERE order_no = ?",
      [status, invoice_no, order_no]
    );

    await conn.commit();


    let products = [];
    try {
      products = JSON.parse(order.products_json || "[]");
    } catch (e) {
      products = [];
    }
    let attachments = [];
    if (status === "SHIPPED") {
      const invoicePath = path.resolve(await generateInvoicePDF(order, products));

      console.log("Invoice path:", invoicePath);
  console.log("File exists:", fs.existsSync(invoicePath));
      attachments.push({ filename: `${invoice_no}.pdf`, path: invoicePath });
    }

    // Fetch admin emails
    const [admins] = await pool.query(
      "SELECT email FROM admin_users WHERE role IN ('ADMIN','STAFF') AND email IS NOT NULL"
    );
    const adminEmails = admins.map(a => a.email);

    // Send emails
    if (order.email) {
      await sendMail({
        to: order.email,
        subject: `Order ${status}: ${order_no}`,
        html: `<h3>Your order ${order_no} has been ${status}</h3>`,
        attachments
      });
    }

    if (adminEmails.length) {
      await sendMail({
        bcc: adminEmails.join(","),
        subject: `Order ${status}: ${order_no}`,
        html: `<h3>Order ${order_no} status changed to ${status}</h3>`,
        attachments
      });
    }

    res.json({ success: true, message: `Order status updated to ${status}`, invoice_no });

   
  } catch (err) {
    await conn.rollback();
    console.log("STATUS UPDATE ERROR:", err);
    res.status(500).json({ error: "Server error" });
  } finally {
    conn.release();
  }
});

/* =======================================================
   PAYMENT SUCCESS — Update + Reduce Stock
======================================================= */
router.post("/update-payment", async (req, res) => {
  const { order_no, razorpay_payment_id, razorpay_order_id } = req.body;

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

   const [orderRows] = await conn.query(
  "SELECT * FROM orders WHERE order_no = ? LIMIT 1",
  [order_no]
);

if (!orderRows.length) {
  await conn.rollback();
  return res.status(404).json({ success: false, error: "Order not found" });
}

const order = orderRows[0]; // ✅ SAFE
    await conn.query(
      `
      UPDATE orders
      SET payment_status = ?,
          status = ?,
          razorpay_payment_id = ?,
          razorpay_order_id = ?
      WHERE order_no = ?
      `,
      ["PAID", "ORDER_PLACED", razorpay_payment_id, razorpay_order_id, order_no]
    );

    const items = JSON.parse(orderRows[0].products_json || "[]");

    for (const item of items) {
      await conn.query(
        "UPDATE products SET stock = GREATEST(stock - ?, 0) WHERE id = ?",
        [item.qty || 1, item.id]
      );
    }

    await conn.commit();
    // 4️⃣ Send emails to user and admins
    const [admins] = await pool.query(
      "SELECT email FROM admin_users WHERE role IN ('ADMIN','STAFF') AND email IS NOT NULL"
    );
    const adminEmails = admins.map(a => a.email);

    const userHTML = `
      <h2>Payment Confirmed</h2>
      <p>Hi ${order.name},</p>
      <p>Your payment of ₹${order.total_amount} has been successfully received for order <strong>${order_no}</strong>.</p>
      <p>We will notify you when your order is shipped.</p>
      <p><a href="${process.env.FRONTEND_URL}/orders/${order_no}">View Order</a></p>
    `;

    const adminHTML = `
      <h2>New Paid Order</h2>
      <p>Order <strong>${order_no}</strong> has been paid by ${order.name} (₹${order.total_amount}).</p>
      <p><a href="${process.env.FRONTEND_URL}/admin/orders/${order_no}">View Order</a></p>
    `;

    // Send to user
    if (order.email) {
      await sendMail({ to: order.email, subject: `Payment Confirmed: ${order_no}`, html: userHTML });
    }

    // Send to admins
    if (adminEmails.length) {
      await sendMail({ bcc: adminEmails.join(","), subject: `New Paid Order: ${order_no}`, html: adminHTML });
    }

    res.json({
      success: true,
      message: "Payment success — stock reduced and emails sent.",
    });


   
  } catch (err) {
    await conn.rollback();
    console.error("PAYMENT UPDATE ERROR:", err);
    res.status(500).json({ error: "Server error" });
  } finally {
    conn.release();
  }
});

export default router;
