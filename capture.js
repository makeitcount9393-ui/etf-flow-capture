// capture.js — 제목 아래쪽의 "가장 큰 캔버스"만 포함해 clip 캡처
import { chromium } from "@playwright/test";
import fs from "fs";
import path from "path";

const TARGET_URL = "https://cryptokorea.net/etf-flow/";

// ===== 튜닝 포인트 =====
const VIEWPORT = { width: 1600, height: 2600 }; // 하단 여유 증가
const SCALE = 2;
const PADDING = { t: 12, r: 12, b: 24, l: 12 };
// 제목 기준으로 "아래"에서만 캔버스를 찾고, 아래로 최대 이 거리까지만(픽셀)
const MAX_BELOW_DISTANCE = 2000;     // 필요하면 2400~3000까지 늘려도 OK
const FALLBACK_EXTRA_HEIGHT = 1000;  // 캔버스 못 찾을 때 제목에서 아래로 확장 높이

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
  const s = fmt.format(t);
  const [date, time] = s.split(" ");
  return { date, time: time.replaceAll(":", "") };
}

/**
 * 제목(h1~h6) 텍스트를 기준으로:
 * 1) 제목 사각형 계산
 * 2) "제목의 바로 아래"에 위치한 캔버스들만 후보로 수집
 *    - heading.bottom <= canvas.top
 *    - canvas.top - heading.bottom <= MAX_BELOW_DISTANCE
 * 3) 그 중 가장 큰 캔버스를 골라 제목+차트의 합집합 clip 계산
 * 4) 없다면 제목에서 아래로 FALLBACK_EXTRA_HEIGHT 확장
 */
async function chartClipByHeading(page, headingText) {
  return await page.evaluate(({ headingText, PADDING, MAX_BELOW_DISTANCE, FALLBACK_EXTRA_HEIGHT }) => {
    // 1) 제목 찾기
    const xq = document.evaluate(`//h1|//h2|//h3|//h4|//h5|//h6`,
      document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
    let heading = null;
    for (let i = 0; i < xq.snapshotLength; i++) {
      const el = xq.snapshotItem(i);
      if (el && el.textContent && el.textContent.trim().includes(headingText)) {
        heading = el; break;
      }
    }
    if (!heading) throw new Error(`Heading not found: ${headingText}`);

    const pageRect = (el) => {
      const r = el.getBoundingClientRect();
      return {
        left: r.left + window.scrollX,
        top: r.top + window.scrollY,
        right: r.right + window.scrollX,
        bottom: r.bottom + window.scrollY,
        width: r.width, height: r.height
      };
    };

    const headingR = pageRect(heading);

    // 2) 후보 캔버스: "제목 아래"에 있고, 너무 멀리 떨어지지 않은 것만
    const allCanvas = Array.from(document.querySelectorAll('canvas'));
    const below = allCanvas
      .map(c => ({ el: c, r: pageRect(c) }))
      .filter(({ r }) => r.top >= headingR.bottom - 2 && (r.top - headingR.bottom) <= MAX_BELOW_DISTANCE);

    // 3) 가장 큰 캔버스 선택
    let best = null, bestArea = 0;
    for (const c of below) {
      const area = Math.max(0, c.r.width) * Math.max(0, c.r.height);
      if (area > bestArea) { bestArea = area; best = c; }
    }

    // 4) clip 계산
    let left = headingR.left, right = headingR.right, top = headingR.top, bottom = headingR.bottom;

    if (best) {
      left   = Math.min(left,   best.r.left);
      right  = Math.max(right,  best.r.right);
      top    = Math.min(top,    best.r.top);
      bottom = Math.max(bottom, best.r.bottom);
    } else {
      // 캔버스가 안 잡히면 제목 아래로 넉넉히 확장
      bottom = Math.max(bottom, headingR.bottom + FALLBACK_EXTRA_HEIGHT);
    }

    // 패딩 & 페이지 경계 보정
    left   = Math.max(0, Math.floor(left) - PADDING.l);
    top    = Math.max(0, Math.floor(top)  - PADDING.t);
    right  = Math.ceil(right)  + PADDING.r;
    bottom = Math.ceil(bottom) + PADDING.b;

    const pageW = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth);
    const pageH = Math.max(document.documentElement.scrollHeight, document.body.scrollHeight);

    return {
      x: left,
      y: top,
      width:  Math.min(right - left,  pageW - left),
      height: Math.min(bottom - top, pageH - top)
    };
  }, { headingText, PADDING, MAX_BELOW_DISTANCE, FALLBACK_EXTRA_HEIGHT });
}

(async () => {
  const { date, time } = kstStamp();
  const outDir = path.join("captures", date);
  fs.mkdirSync(outDir, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: SCALE
  });
  const page = await context.newPage();

  await page.goto(TARGET_URL, { waitUntil: "networkidle" });

  // 지연 로딩 대비
  await Promise.race([
    page.waitForSelector("canvas", { timeout: 15000 }).catch(() => {}),
    page.waitForSelector("[data-echarts-instance], .echarts", { timeout: 15000 }).catch(() => {}),
    page.waitForTimeout(6000)
  ]);

  // 스크롤 초기화(스티키 헤더 간섭 방지)
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));

  // === BTC ===
  const btcClip = await chartClipByHeading(page, "Bitcoin ETF Flow");
  await page.screenshot({ path: path.join(outDir, `BTC_${date}_${time}.png`), clip: btcClip });

  // === ETH === (아래쪽만 후보로 제한되어 BTC가 끼어들지 않음)
  const ethClip = await chartClipByHeading(page, "Ethereum ETF Flow");
  await page.screenshot({ path: path.join(outDir, `ETH_${date}_${time}.png`), clip: ethClip });

  await browser.close();
  console.log("✅ 캡처 완료:", outDir);
})().catch((err) => {
  console.error("❌ 캡처 에러:", err);
  process.exit(1);
});
