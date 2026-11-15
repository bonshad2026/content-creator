// UI test server for plans + admin under a BASE_URL. Demo mode (no tokens), its own data folder, a made-up admin number.
// Usage: node scripts/admin-ui-server.mjs → http://localhost:3011/creator/   (admin login: 09120000000, code shown on screen)
process.env.DATA_DIR = process.env.DATA_DIR || "data/test-out/admin-ui";
process.env.PORT = process.env.PORT || "3011";
process.env.BASE_URL = process.env.BASE_URL ?? "/creator";
process.env.ADMIN_PHONE = process.env.ADMIN_PHONE || "09120000000";
delete process.env.KAVENEGAR_API_KEY;
await import("./demo-server.mjs");
