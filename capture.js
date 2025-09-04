// capture.js — 제목+차트(캔버스)까지 묶어서 clip 캡처
import { chromium } from "@playwright/test";
import fs from "fs";
import path from "path";

const TARGET_URL = "https://cryptokorea.net/etf-flow/";

// ===== 튜닝 포인트 =====
const VIEWPORT = { width: 1600, height: 2400 }; // 데스크톱 뷰포트(너무 작으면 차트 하단이 잘림)
const SCALE = 2;                                 // 2~3 (선명도)
const PADDING = { t: 12, r: 12, b: 24, l: 12 };  // 캡처 여백
const FALLBACK_EXTRA_HEIGHT = 900;               // 캔버스를 못 찾았을 때, 제목에서 아래로 추가 높이(px)

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
 * 1) 제목 상자
 * 2) 같은 카드/근처에 있는 "가장 큰 <canvas>" 상자
 * 를 찾아, 둘을 포함하는 사각형(패딩 포함) clip을 계산한다.
 * 캔버스를 못 찾으면 제목 rect에 FALLBACK_EXTRA_HEIGHT만큼 아래로 확장한다.
 */
async function chartClipByHeading(page, headingText) {
  return await page.evaluate(({ headingText, PADDING, FALLBACK_EXTRA_HEIGHT }) => {
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

    // 2) 카드(상위 div/section) 후보
    let card = heading;
    while (card && card.parentElement) {
      card = card.parentElement;
      if (card && (card.tagName === 'DIV' || card.tagName === 'SECTION')) break;
    }
    if (!card) card = heading;

    // 3) 카드 내부 또는 근처에서 "가장 큰 canvas" 탐색
    //    - 카드 내부 캔버스 우선
    const canvases = Array.from(card.querySelectorAll('canvas'));
    //    - 내부에 없으면, 제목 아래쪽 근처의 캔버스를 보조로 탐색(같은 섹션 다음 형제 등)
    if (canvases.length === 0) {
      const below = document.elementsFromPoint(window.innerWidth/2, heading.getBoundingClientRect().bottom + 10)
        .filter(el => el.tagName === 'CANVAS');
      canvases.push(...below);
      // 마지막 안전장치: 페이지 전체에서 몇 개만 스캔
      if (canvases.length === 0) canvases.push(...document.querySelectorAll('canvas'));
    }

    function pageRect(el) {
      const r = el.getBoundingClientRect();
      return {
        left: r.left + window.scrollX,
        top:  r.top + window.scrollY,
        right: r.right + window.scrollX,
        bottom: r.bottom + window.scrollY,
        width: r.width,
        height: r.height
      };
    }

    const headingR = pageRect(heading);

    // 가장 "큰" 캔버스(면적 기준)
    let bestCanvas = null, bestArea = 0, bestR = null;
    for (const c of canvases) {
      const rr = pageRect(c);
      const area = Math.max(0, rr.width) * Math.max(0, rr.height);
      if (area > bestArea) { bestArea = area; bestCanvas = c; bestR = rr; }
    }

    let left = headingR.left, right = headingR.right;
    let top = headingR.top,   bottom = headingR.bottom;

    if (bestCanvas && bestArea > 0) {
      // 제목 + 차트 영역 합집합
      left   = Math.min(left,   bestR.left);
      right  = Math.max(right,  bestR.right);
      top    = Math.min(top,    bestR.top);
      bottom = Math.max(bottom, bestR.bottom);
    } else {
      // 캔버스 못 찾으면 제목에서 아래로 확장
      bottom = Math.max(bottom, headingR.bottom + FALLBACK_EXTRA_HEIGHT);
    }

    // 패딩 적용
    left   = Math.max(0, Math.floor(left)   - PADDING.l);
    top    = Math.max(0, Math.floor(top)    - PADDING.t);
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
  }, { headingText, PADDING, FALLBACK_EXTRA_HEIGHT });
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

  // 제목을 화면 중앙 근처로 스크롤 (sticky header 겹침 방지)
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));

  // ===== BTC =====
  const btcClip = await chartClipByHeading(page, "Bitcoin ETF Flow");
  await page.screenshot({ path: path.join(outDir, `BTC_${date}_${time}.png`), clip: btcClip });

  // ===== ETH =====
  const ethClip = await chartClipByHeading(page, "Ethereum ETF Flow");
  await page.screenshot({ path: path.join(outDir, `ETH_${date}_${time}.png`), clip: ethClip });

  await browser.close();
  console.log("✅ 캡처 완료:", outDir);
})().catch((err) => {
  console.error("❌ 캡처 에러:", err);
  process.exit(1);
});
