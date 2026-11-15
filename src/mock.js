// Canned responses so the demo works without an API key.
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

export async function mockProfile() {
  await wait(1500);
  return {
    data: { voice: "(دمو) صمیمی و پرانرژی، جمله‌های کوتاه.", visual: "(دمو) رنگ‌های گرم، متن درشت روی تصویر.", dos: ["شروع با سؤال"], donts: ["لحن رسمی"] },
    usage: { tokens: 0, cost: 0 },
  };
}

export async function mockGeneration(media, brief) {
  await wait(4000 + Math.random() * 3000);
  const video = media.kind === "video";
  return {
    data: {
      hooks: ["رفقا، اینو دیدین؟ 👀", "باورتون نمیشه چی شد…", "یه چیزی بگم؟"],
      caption: `(نمونه‌ی دمو${brief ? ` — ${brief}` : ""})\nامروز یه تجربه‌ی متفاوت داشتم و گفتم با شما هم به اشتراک بذارم…\nشما بودین چیکار می‌کردین؟ 👇`,
      hashtags: ["#تولید_محتوا", "#ولاگ", "#روزمرگی"],
      cover: "این بهترین تصمیمم بود!",
      scenes: video
        ? [
            { t: "0-2s", v: "کلوزآپ از سوژه", x: "رفقا، اینو دیدین؟" },
            { t: "2-8s", v: "نمای باز با کات سریع", x: "بریم ببینیم چی شد…" },
            { t: "8-12s", v: "واکنش به دوربین", x: "تو کامنتا بگین 👇" },
          ]
        : [],
      tips: ["ساعت ۲۰ تا ۲۲ منتشر کن", "در استوری هم بازنشر کن"],
    },
    usage: { tokens: 0, cost: 0 },
  };
}
