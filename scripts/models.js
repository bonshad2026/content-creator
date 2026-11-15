// Lists the models your GapGPT key can use:  npm run models
import OpenAI from "openai";

if (!process.env.GAPGPT_API_KEY) {
  console.error("GAPGPT_API_KEY is not set. Put it in .env first.");
  process.exit(1);
}
const client = new OpenAI({
  apiKey: process.env.GAPGPT_API_KEY,
  baseURL: process.env.GAPGPT_BASE_URL || "https://api.gapgpt.app/v1",
});
const ids = [];
for await (const m of client.models.list()) ids.push(m.id);
console.log(ids.sort().join("\n"));
