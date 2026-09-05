// ============================================================
// auth.js — JWT in an httpOnly cookie + guards.
// ============================================================
import jwt from "jsonwebtoken";
import { Users } from "./db.js";

const SECRET = process.env.JWT_SECRET || "dev-insecure-secret-change-me";
const COOKIE = "mk_token";
const MAX_AGE = 1000 * 60 * 60 * 24 * 30; // 30 days

export function issueCookie(res, user) {
  const token = jwt.sign({ uid: user.id, role: user.role }, SECRET, { expiresIn: "30d" });
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: MAX_AGE,
    path: "/",
  });
}

export function clearCookie(res) {
  res.clearCookie(COOKIE, { path: "/" });
}

// Populate req.user from the cookie when present (never throws).
export function attachUser(req, _res, next) {
  const token = req.cookies?.[COOKIE];
  if (token) {
    try {
      const { uid } = jwt.verify(token, SECRET);
      const u = Users.byId(uid);
      if (u) req.user = u;
    } catch { /* invalid/expired token → treated as logged out */ }
  }
  next();
}

export function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: "Not authenticated" });
  next();
}

export function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== "admin") return res.status(403).json({ error: "Admin only" });
  next();
}

export const isValidEmail = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
