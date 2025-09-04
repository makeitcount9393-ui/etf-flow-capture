// capture.js (최적화 미니멀 버전)
import { chromium } from "@playwright/test";
import fs from "fs";
import path from "path";

const TARGET_URL = "https://cryptokorea.net/etf-flow/";

// 한국시간 타임스탬프
function kstStamp() {
  const t = new Date();
  const fmt = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
  const s = fmt.format(t);                // "YYYY-MM-DD HH:MM:SS"
  const [date, time] = s.split(" ");
  return { date, time: time.replaceAll(":", "") };
}

// 제목(h1~h6) 포함 텍스트로 가장 가까운 div/section 상자 스크린샷
async function screenshotCardByHeading(page, headingText, outPath) {
  const heading = page.locator(
    `xpath=//h1|//h2|//h3|//h4|//h5|//h6[contains(normalize-space(.), "${headingText}")]`
  ).first();

  await heading.waitFor({ state: "visible", timeout: 15000 });

  const cardHandle = await heading.evaluateHandle((el) => {
    let cur = el;
    while (cur && cur.parentElement) {
      cur = cur.parentElement;
      if (cur.tagName === "DIV" || cur.tagName === "SECTION") return cur;
    }
    return el;
  });

  const card = page.locator(cardHandle.asElement());
  await card.scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  await card.screenshot({ path: outPath });
}

(async () => {
  const { date, time } = kstStamp();
  const outDir = path.join("captures", date);
  fs.mkdirSync(outDir, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1600, height: 2000 },
    deviceScaleFactor: 2
  });
  const page = await context.newPage();

  await page.goto(TARGET_URL, { waitUntil: "networkidle" });
  await Promise.race([
    page.waitForSelector("canvas", { timeout: 15000 }).catch(() => {}),
    page.waitForSelector("[data-echarts-instance], .echarts", { timeout: 15000 }).catch(() => {}),
    page.waitForTimeout(5000)
  ]);

  // 제목 앞부분만 매칭해 단위 표기 변경에도 견고
  await screenshotCardByHeading(page, "Bitcoin ETF Flow",  path.join(outDir, `BTC_${date}_${time}.png`));
  await screenshotCardByHeading(page, "Ethereum ETF Flow", path.join(outDir, `ETH_${date}_${time}.png`));

  await browser.close();
  console.log("✅ 캡처 완료:", outDir);
})().catch((err) => {
  console.error("❌ 캡처 에러:", err);
  process.exit(1);
});
