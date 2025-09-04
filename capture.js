import { chromium } from "@playwright/test";
import fs from "fs";
import path from "path";

// ====== (필수) 캡처할 페이지 주소 ======
const TARGET_URL = "https://cryptokorea.net/etf-flow/";

// ====== (중요) 1번/2번 캡처할 "영역" 선택자 ======
// 1안) 가장 안정적인 방법: 특정 영역을 감싸는 요소에 id를 달아 선택
//    예) <section id="btc-etf-flow"> ... </section>
//        <section id="eth-etf-flow"> ... </section>
const SELECTOR_ONE = 'section#btc-etf-flow';
const SELECTOR_TWO = 'section#eth-etf-flow';

// 2안) id가 없으면, "화면에 보이는 고정 텍스트"로 찾기
// const SELECTOR_ONE = 'section:has-text("Bitcoin ETF Flow(US$m)")';
// const SELECTOR_TWO = 'section:has-text("Ethereum ETF Flow(US$m)")';

// 3안) 정말 셀렉터를 못 잡겠으면 "좌표 캡처(clip)"로 대체 (아래 주석 해제해서 사용)
//    const CLIP_ONE = { x: 80,  y: 600,  width: 1200, height: 600 };
//    const CLIP_TWO = { x: 80,  y: 1250, width: 1200, height: 600 };

// ====== 저장용 날짜/시간 만들기 (한국시간) ======
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
  return { date, time: time.replaceAll(":", "") }; // 예: { date:"2025-09-04", time:"141000" }
}

// ====== 페이지에서 특정 영역이 보이도록 스크롤 후 요소 가져오기 ======
async function scrollIntoViewIfNeeded(page, selector) {
  const el = page.locator(selector).first();
  await el.scrollIntoViewIfNeeded();
  await page.waitForTimeout(400); // 살짝 대기(로딩/애니메이션 안정화)
  return el;
}

async function main() {
  // 고해상도(선명하게) 캡처 설정
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1600, height: 2000 }, // 캡처에 넉넉한 창 크기
    deviceScaleFactor: 2                      // 2배 해상도(더 선명)
  });
  const page = await context.newPage();

  // 페이지 열기 (네트워크 요청이 잠잠해질 때까지 기다림)
  await page.goto(TARGET_URL, { waitUntil: "networkidle" });

  // 차트/캔버스 등 늦게 뜨는 요소를 고려해 추가 대기
  await Promise.race([
    page.waitForSelector('canvas', { timeout: 15000 }).catch(() => {}),
    page.waitForSelector('.echarts, [data-echarts-instance]', { timeout: 15000 }).catch(() => {}),
    page.waitForTimeout(10000)
  ]);

  // 날짜 기반 폴더 만들기
  const { date, time } = kstStamp();
  const outDir = path.join("captures", date);
  fs.mkdirSync(outDir, { recursive: true });

  // ===== 1번 영역 캡처 =====
  try {
    const el1 = await scrollIntoViewIfNeeded(page, SELECTOR_ONE);
    await el1.screenshot({ path: path.join(outDir, `BTC_${date}_${time}.png`) });
  } catch (e) {
    console.warn("첫 번째 셀렉터 캡처 실패. 좌표 캡처로 전환하거나 SELECTOR_ONE을 점검하세요.", e);
    // 좌표 캡처 쓰려면 위에서 CLIP_ONE 주석 해제 후 아래 줄 주석 해제:
    // await page.screenshot({ path: path.join(outDir, `BTC_${date}_${time}.png`), clip: CLIP_ONE });
  }

  // ===== 2번 영역 캡처 =====
  try {
    const el2 = await scrollIntoViewIfNeeded(page, SELECTOR_TWO);
    await el2.screenshot({ path: path.join(outDir, `ETH_${date}_${time}.png`) });
  } catch (e) {
    console.warn("두 번째 셀렉터 캡처 실패. 좌표 캡처로 전환하거나 SELECTOR_TWO를 점검하세요.", e);
    // await page.screenshot({ path: path.join(outDir, `ETH_${date}_${time}.png`), clip: CLIP_TWO });
  }

  await browser.close();
  console.log("✅ 캡처 완료:", outDir);
}

main().catch(err => {
  console.error("❌ 캡처 에러:", err);
  process.exit(1);
});
