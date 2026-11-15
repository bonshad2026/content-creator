// Runs the app for UI testing WITHOUT spending GapGPT tokens and WITHOUT touching real data:
// separate data folder (data-demo/), no API key (demo mode = canned AI answers, all local editing still runs).
// Usage: npm run demo   → http://localhost:3010
process.env.DATA_DIR = process.env.DATA_DIR || "data-demo";
process.env.PORT = process.env.PORT || "3010";
delete process.env.GAPGPT_API_KEY;
await import("../server.js");
