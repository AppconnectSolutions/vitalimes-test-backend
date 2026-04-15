// routes/auth.js
import express from "express";
import pool from "../db.js";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";

const router = express.Router();

// ✅ JWT SECRET KEY
const JWT_SECRET = "VITALIMES_SECRET_KEY_2025";

/* =========================================
   🔹 SIGNUP (Create user / admin)
   POST /api/auth/signup
========================================= */
router.post("/signup", async (req, res) => {
  try {
    const { name, email, password, role } = req.body;

    if (!name || !email || !password) {
      return res
        .status(400)
        .json({ success: false, message: "Name, email, password required" });
    }

    // 1) Check if email already exists
    const [existing] = await pool.query(
      "SELECT id FROM admin_users WHERE email = ? LIMIT 1",
      [email]
    );

    if (existing.length > 0) {
      return res
        .status(400)
        .json({ success: false, message: "Email already registered" });
    }

    // 2) Hash password
    const hashed = await bcrypt.hash(password, 10);

    // 3) Decide role – default normal user
    const finalRole = role || "USER";

    // 4) Insert row
    const [result] = await pool.query(
      "INSERT INTO admin_users (name, email, password, role) VALUES (?, ?, ?, ?)",
      [name, email, hashed, finalRole]
    );

    return res.json({
      success: true,
      message: "Account created successfully",
      user: {
        id: result.insertId,
        name,
        email,
        role: finalRole,
      },
    });
  } catch (err) {
    console.error("SIGNUP ERROR:", err);
    return res
      .status(500)
      .json({ success: false, message: "Server error during signup" });
  }
});

/* =========================================
   🔹 LOGIN
   POST /api/auth/login
========================================= */
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    const [rows] = await pool.query(
      "SELECT * FROM admin_users WHERE email = ? LIMIT 1",
      [email]
    );

    if (!rows.length)
      return res.json({ success: false, message: "Invalid Email" });

    const admin = rows[0];

    const validPass = await bcrypt.compare(password, admin.password);
    if (!validPass)
      return res.json({ success: false, message: "Invalid Password" });

    const token = jwt.sign(
      {
        id: admin.id,
        email: admin.email,
        name: admin.name,
        role: admin.role || "ADMIN", // keep role in token
      },
      JWT_SECRET,
      { expiresIn: "30d" }
    );

    return res.json({
      success: true,
      token,
      admin: {
        id: admin.id,
        email: admin.email,
        name: admin.name,
        role: admin.role || "ADMIN",
      },
    });
  } catch (err) {
    console.error("LOGIN ERROR:", err);
    return res
      .status(500)
      .json({ success: false, message: "Server Error during login" });
  }
});

/* =========================================
   🔹 VERIFY TOKEN
   GET /api/auth/verify
========================================= */
router.get("/verify", (req, res) => {
  try {
    const token = req.headers.authorization?.split(" ")[1];

    if (!token) return res.json({ valid: false });

    jwt.verify(token, JWT_SECRET, (err, decoded) => {
      if (err) return res.json({ valid: false });

      return res.json({ valid: true, admin: decoded });
    });
  } catch (err) {
    console.error("VERIFY ERROR:", err);
    return res.json({ valid: false });
  }
});

/* =========================================
   🔹 GET ALL USERS (with roles)
   GET /api/auth/users
========================================= */
router.get("/users", async (req, res) => {
  try {
    const [rows] = await pool.query(
      "SELECT id, name, email, role FROM admin_users ORDER BY id DESC"
    );

    return res.json({ success: true, users: rows });
  } catch (err) {
    console.error("USERS LIST ERROR:", err);
    return res
      .status(500)
      .json({ success: false, message: "Error loading users" });
  }
});

/* =========================================
   🔹 ADD / UPDATE ROLE
   POST /api/auth/add-role
   body: { id, role }   (role: 'ADMIN' | 'STAFF' | 'USER')
========================================= */
router.post("/add-role", async (req, res) => {
  try {
    const { id, role } = req.body;

    if (!id || !role) {
      return res
        .status(400)
        .json({ success: false, message: "User id and role are required" });
    }

    const allowed = ["ADMIN", "STAFF", "USER"];
    if (!allowed.includes(role)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid role value" });
    }

    const [result] = await pool.query(
      "UPDATE admin_users SET role = ? WHERE id = ?",
      [role, id]
    );

    if (result.affectedRows === 0) {
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }

    return res.json({ success: true, message: "Role updated successfully" });
  } catch (err) {
    console.error("ADD ROLE ERROR:", err);
    return res
      .status(500)
      .json({ success: false, message: "Error updating role" });
  }
});

/* =========================================
   🔹 REMOVE ADMIN ACCESS
   POST /api/auth/remove-role
   body: { id }  -> set role back to 'USER'
========================================= */
router.post("/remove-role", async (req, res) => {
  try {
    const { id } = req.body;

    if (!id) {
      return res
        .status(400)
        .json({ success: false, message: "User id is required" });
    }

    const [result] = await pool.query(
      "UPDATE admin_users SET role = 'USER' WHERE id = ?",
      [id]
    );

    if (result.affectedRows === 0) {
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }

    return res.json({
      success: true,
      message: "Admin access removed (role set to USER)",
    });
  } catch (err) {
    console.error("REMOVE ROLE ERROR:", err);
    return res
      .status(500)
      .json({ success: false, message: "Error removing role" });
  }
});

export default router;
