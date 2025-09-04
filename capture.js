import { chromium } from "@playwright/test";
import fs from "fs";
import path from "path";

// 제목 텍스트로 가장 가까운 카드(div/section) 요소를 찾아 스크린샷
async function screenshotCardByHeading(page, headingText, outPath) {
  // 1) 제목(헤딩) 찾기: 'Bitcoin ETF Flow' / 'Ethereum ETF Flow' 앞부분만 잡아 변동 여유 확보
  const heading = page.locator(`xpath=//h1|//h2|//h3|//h4|//h5|//h6[
    contains(normalize-space(.), "${headingText}")
  ]`).first();

  await heading.waitFor({ state: 'visible', timeout: 15000 });

  // 2) 가장 가까운 카드 컨테이너(div 또는 section) 찾기
  //    - 보통 차트는 카드(div/section) 안에 들어가 있으니, 가장 가까운 상위 div/section을 캡처
  const card = await heading.evaluateHandle((el) => {
    // 위로 올라가며 div/section을 찾고, 첫 번째로 만나는 요소를 사용
    let cur = el;
    while (cur && cur.parentElement) {
      cur = cur.parentElement;
      if (cur.tagName === 'DIV' || cur.tagName === 'SECTION') return cur;
    }
    return el; // 안전장치: 못 찾으면 헤딩 자체라도 반환
  });

  const cardLocator = page.locator(card.asElement());
  await cardLocator.scrollIntoViewIfNeeded();
  await page.waitForTimeout(300); // 레이아웃 안정화

  await cardLocator.screenshot({ path: outPath });
}

// ====== (필수) 캡처할 페이지 주소 ======
const TARGET_URL = "https://cryptokorea.net/etf-flow/";

// (중략 — 브라우저/컨텍스트/페이지 생성은 그대로)

// 페이지 열기 + 로딩 대기
await page.goto(TARGET_URL, { waitUntil: "networkidle" });

// 차트가 늦게 뜰 수 있어 안전 대기
await Promise.race([
  page.waitForSelector('canvas', { timeout: 15000 }).catch(() => {}),
  page.waitForSelector('[data-echarts-instance], .echarts', { timeout: 15000 }).catch(() => {}),
  page.waitForTimeout(5000)
]);

const { date, time } = kstStamp();
const outDir = path.join("captures", date);
fs.mkdirSync(outDir, { recursive: true });

// 1) 비트코인 카드 캡처 (제목의 앞부분만 넣기)
await screenshotCardByHeading(
  page,
  "Bitcoin ETF Flow",                                // ← "Bitcoin ETF Flow(US$m)" 앞부분
  path.join(outDir, `BTC_${date}_${time}.png`)
);

// 2) 이더리움 카드 캡처
await screenshotCardByHeading(
  page,
  "Ethereum ETF Flow",                               // ← "Ethereum ETF Flow(US$m)" 앞부분
  path.join(outDir, `ETH_${date}_${time}.png`)
);

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
