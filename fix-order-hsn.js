// scripts/fix-orders-hsn.js
import pool from "../db.js"; // adjust path if needed

async function fixOrdersHSN() {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // Fetch all orders
    const [orders] = await conn.query("SELECT id, products_json FROM orders");

    for (const order of orders) {
      let products = [];
      try {
        products = JSON.parse(order.products_json || "[]");
      } catch (e) {
        console.error(`Order ${order.id} products_json parse error:`, e);
        continue;
      }

      // Skip if products already have HSN
      const hasHSN = products.some((p) => p.hsn);
      if (hasHSN) continue;

      // Fetch HSN for each product
      const updatedProducts = await Promise.all(
        products.map(async (p) => {
          const [prodRows] = await conn.query(
            "SELECT hsn FROM products WHERE id = ? LIMIT 1",
            [p.id]
          );
          return {
            ...p,
            hsn: prodRows[0]?.hsn || null,
          };
        })
      );

      // Update order with new products_json
      await conn.query(
        "UPDATE orders SET products_json = ? WHERE id = ?",
        [JSON.stringify(updatedProducts), order.id]
      );

      console.log(`Order ${order.id} updated with HSN.`);
    }

    await conn.commit();
    console.log("All orders updated successfully.");
  } catch (err) {
    await conn.rollback();
    console.error("Error updating orders:", err);
  } finally {
    conn.release();
    process.exit(0);
  }
}

fixOrdersHSN();
