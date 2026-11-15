// Phone + one-time-code login.
// With KAVENEGAR_API_KEY + KAVENEGAR_TEMPLATE set, the code is sent by SMS (Kavenegar "verify/lookup").
// Otherwise the app is in dev mode: the code is printed in the server log and shown on the login screen.
import crypto from "node:crypto";
import { getDb, save, newId } from "./store.js";

const db = getDb();
const otps = new Map(); // phone -> {code, exp, tries, sentAt}
export const smsEnabled = Boolean(process.env.KAVENEGAR_API_KEY && process.env.KAVENEGAR_TEMPLATE);

export function normalizePhone(raw = "") {
  let p = String(raw)
    .replace(/[۰-۹]/g, (d) => "۰۱۲۳۴۵۶۷۸۹".indexOf(d))
    .replace(/[٠-٩]/g, (d) => "٠١٢٣٤٥٦٧٨٩".indexOf(d))
    .replace(/\D/g, "");
  if (p.startsWith("0098")) p = "0" + p.slice(4);
  else if (p.startsWith("98")) p = "0" + p.slice(2);
  else if (p.startsWith("9") && p.length === 10) p = "0" + p;
  return /^09\d{9}$/.test(p) ? p : null;
}

async function sendSms(phone, code) {
  const url =
    `https://api.kavenegar.com/v1/${process.env.KAVENEGAR_API_KEY}/verify/lookup.json` +
    `?receptor=${phone}&token=${code}&template=${encodeURIComponent(process.env.KAVENEGAR_TEMPLATE)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("ارسال پیامک ناموفق بود. کمی بعد دوباره امتحان کنید.");
}

export async function sendCode(rawPhone) {
  const phone = normalizePhone(rawPhone);
  if (!phone) throw Object.assign(new Error("شماره موبایل درست نیست."), { status: 400 });
  const prev = otps.get(phone);
  if (prev && Date.now() - prev.sentAt < 60_000)
    throw Object.assign(new Error("یک دقیقه صبر کنید و دوباره بزنید."), { status: 429 });

  const code = String(crypto.randomInt(10000, 100000));
  otps.set(phone, { code, exp: Date.now() + 120_000, tries: 0, sentAt: Date.now() });
  if (smsEnabled) await sendSms(phone, code);
  else console.log(`[dev] login code for ${phone}: ${code}`);
  return { phone, devCode: smsEnabled ? undefined : code };
}

export function verifyCode(rawPhone, rawCode) {
  const phone = normalizePhone(rawPhone);
  const code = String(rawCode || "").replace(/[۰-۹]/g, (d) => "۰۱۲۳۴۵۶۷۸۹".indexOf(d));
  const o = phone && otps.get(phone);
  if (!o || Date.now() > o.exp) throw Object.assign(new Error("کد منقضی شده. دوباره کد بگیرید."), { status: 400 });
  if (++o.tries > 5) throw Object.assign(new Error("تلاش زیاد. دوباره کد بگیرید."), { status: 429 });
  if (o.code !== code) throw Object.assign(new Error("کد اشتباه است."), { status: 400 });
  otps.delete(phone);

  let user = Object.values(db.users).find((u) => u.phone === phone);
  if (!user) {
    user = { id: newId(), phone, name: "", style: null, samples: [], profile: null, usage: { tokens: 0, cost: 0 }, createdAt: Date.now() };
    db.users[user.id] = user;
  }
  const token = newId(32);
  db.sessions[token] = user.id;
  save();
  return { token, user };
}

export function requireUser(req, res, next) {
  const token = (req.get("authorization") || "").replace(/^Bearer /, "");
  const user = db.users[db.sessions[token]];
  if (!user) return res.status(401).json({ error: "دوباره وارد شوید." });
  req.user = user;
  req.token = token;
  next();
}

export function logout(token) {
  delete db.sessions[token];
  save();
}
