// Isolated mobile preview. Real AI is an explicit opt-in; no analysis runs automatically.
process.env.DATA_DIR=process.env.DATA_DIR||"data/test-out/template-ui-review";
process.env.PORT=process.env.PORT||"3015";
process.env.BASE_URL=process.env.BASE_URL||"/creator";
process.env.ADMIN_PHONE="09120000000";
delete process.env.KAVENEGAR_API_KEY;
delete process.env.KAVENEGAR_TEMPLATE;
if(process.env.ENABLE_REAL_AI!=="1")delete process.env.GAPGPT_API_KEY;
await import("../server.js");
