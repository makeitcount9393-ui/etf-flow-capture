// capture.js — 좌표(clip) 캡처 최적화 버전
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
  const s = fmt.format(t); // "YYYY-MM-DD HH:MM:SS"
  const [date, time] = s.split(" ");
  return { date, time: time.replaceAll(":", "") };
}

/**
 * 제목(h1~h6)에 특정 텍스트가 "포함"된 요소를 찾고,
 * 가장 가까운 상위 div/section의 페이지 좌표(x,y,w,h)를 반환.
 * 좌표는 clip 캡처에 바로 사용 가능.
 * - headingText: 예) "Bitcoin ETF Flow" (괄호/단위 변동 대비 앞부분만)
 * - pad: {t,r,b,l} 여백(px)로 테두리 살짝 넉넉히 찍고 싶을 때
 */
async function rectByHeading(page, headingText, pad = { t: 12, r: 12, b: 12, l: 12 }) {
  return await page.evaluate(({ headingText, pad }) => {
    // 1) 제목 찾기 (h1~h6 중 텍스트 포함)
    const xpath = `//h1|//h2|//h3|//h4|//h5|//h6`;
    const it = document.evaluate(xpath, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
    let heading = null;
    for (let i = 0; i < it.snapshotLength; i++) {
      const el = it.snapshotItem(i);
      if (el && el.textContent && el.textContent.trim().includes(headingText)) {
        heading = el;
        break;
      }
    }
    if (!heading) throw new Error(`Heading not found for text: ${headingText}`);

    // 2) 가장 가까운 상위 div/section을 카드로 간주
    let card = heading;
    while (card && card.parentElement) {
      card = card.parentElement;
      if (card && (card.tagName === "DIV" || card.tagName === "SECTION")) break;
    }
    if (!card) card = heading; // 안전장치

    // 3) 페이지 좌표 계산
    const r = card.getBoundingClientRect();
    const x = Math.max(0, Math.floor(r.left + window.scrollX) - pad.l);
    const y = Math.max(0, Math.floor(r.top + window.scrollY) - pad.t);
    const w = Math.ceil(r.width) + pad.l + pad.r;
    const h = Math.ceil(r.height) + pad.t + pad.b;

    // 4) 페이지 전체 크기를 넘어가면 잘라냄
    const pageW = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth);
    const pageH = Math.max(document.documentElement.scrollHeight, document.body.scrollHeight);

    return {
      x,
      y,
      width: Math.min(w, pageW - x),
      height: Math.min(h, pageH - y)
    };
  }, { headingText, pad });
}

(async () => {
  const { date, time } = kstStamp();
  const outDir = path.join("captures", date);
  fs.mkdirSync(outDir, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1600, height: 2200 }, // 넉넉한 데스크톱 뷰포트
    deviceScaleFactor: 2                      // 선명도 ↑
  });
  const page = await context.newPage();

  await page.goto(TARGET_URL, { waitUntil: "networkidle" });
  await Promise.race([
    page.waitForSelector("canvas", { timeout: 15000 }).catch(() => {}),
    page.waitForSelector("[data-echarts-instance], .echarts", { timeout: 15000 }).catch(() => {}),
    page.waitForTimeout(5000)
  ]);

  // ===== 좌표 계산 → clip 캡처 =====
  const btcClip = await rectByHeading(page, "Bitcoin ETF Flow");
  await page.screenshot({ path: path.join(outDir, `BTC_${date}_${time}.png`), clip: btcClip });

  const ethClip = await rectByHeading(page, "Ethereum ETF Flow");
  await page.screenshot({ path: path.join(outDir, `ETH_${date}_${time}.png`), clip: ethClip });

  await browser.close();
  console.log("✅ 캡처 완료:", outDir);
})().catch((err) => {
  console.error("❌ 캡처 에러:", err);
  process.exit(1);
});
