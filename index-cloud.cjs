const puppeteer = require("puppeteer");
const { google } = require("googleapis");

const SPREADSHEET_ID = "1T2g-vpj0EDFabuNgVqpP-9n12sLRVnR5jOEa1yWJgW0";

/* ------------------ 日付フォーマット ------------------ */
function todayJpMd() {
  const now = new Date();
  const jstNow = new Date(
    now.toLocaleString("en-US", { timeZone: "Asia/Tokyo" })
  );
  jstNow.setDate(jstNow.getDate() - 1);
  const weekday = ["日","月","火","水","木","金","土"][jstNow.getDay()];
  return `${jstNow.getMonth()+1}/${jstNow.getDate()}(${weekday})`;
}

/* ------------------ 文字整形 ------------------ */
function cleanForOutput(raw) {
  if (!raw) return "";
  return raw.replace(/[^ぁ-んァ-ヶー一-龠々]/g, "");
}

/* ------------------ スクレイピング ------------------ */
async function scrapeGenre(page, url, groupLabel) {
  console.log(`🌐 ${groupLabel} ランキング取得開始...`);

  await page.goto(
    `https://www.dmm.co.jp/age_check/=/declared=yes/?rurl=${encodeURIComponent(url)}`,
    { waitUntil: "domcontentloaded", timeout: 90000 }
  );

  await page.waitForTimeout(5000);

  const data = await page.evaluate((groupLabel) => {
    const results = [];

    let typeLabels = ["日間","週間","月間"];
    if (groupLabel === "新人") typeLabels = ["新人日間","新人週間"];
    if (groupLabel === "時間帯") typeLabels = ["朝帯","昼帯","夜帯"];

    const rows = document.querySelectorAll("ul.rank-list li");

    rows.forEach((row, i) => {
      const rank = i + 1;
      const nameEl = row.querySelector(".name");
      if (!nameEl) return;

      const name = nameEl.textContent.trim();
      const type = typeLabels[i % typeLabels.length];

      results.push({ rank, name, type });
    });

    return { month: null, results };
  }, groupLabel);

  console.log(`✅ ${groupLabel}: ${data.results.length}件 抽出完了`);
  return data;
}

/* ------------------ メイン ------------------ */
(async () => {
  const browser = await puppeteer.launch({
    headless: "new",
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--no-zygote",
      "--single-process"
    ],
    defaultViewport: { width: 1280, height: 900 },
  });

  const page = await browser.newPage();
  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
  );

  const GENRES = [
    { label: "あちゃ", url: "https://www.dmm.co.jp/live/chat/-/character-ranking/=/genre=popular/group=acha/" },
    { label: "まちゃ", url: "https://www.dmm.co.jp/live/chat/-/character-ranking/=/genre=popular/group=macha/" },
    { label: "おちゃ", url: "https://www.dmm.co.jp/live/chat/-/character-ranking/=/genre=popular/group=ocha/" },
    { label: "新人", url: "https://www.dmm.co.jp/live/chat/-/character-ranking/=/genre=newface/" },
    { label: "時間帯", url: "https://www.dmm.co.jp/live/chat/-/character-ranking/=/genre=timezone/" },
  ];

  console.log("🚀 全ジャンルランキング取得開始...");
  let allData = [];

  for (const g of GENRES) {
    try {
      const result = await scrapeGenre(page, g.url, g.label);
      allData = allData.concat(result.results.map(r => ({...r, group:g.label})));
    } catch(e){
      console.log(`⚠️ ${g.label} 取得失敗: ${e.message}`);
    }
  }

  console.log(`📦 合計 ${allData.length}件 取得完了`);

  /* ---- Google Sheets ---- */
  const auth = new google.auth.GoogleAuth({
    credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT),
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });

  const sheets = google.sheets({ version:"v4", auth });

  const searchRes = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: "検索リスト!B:C"
  });

  const searchList = (searchRes.data.values || []).slice(1);
  const targetNames = searchList.map(r => r[0]?.trim()).filter(Boolean);
  const groupMap = Object.fromEntries(searchList.map(r=>[r[0]?.trim(), r[1]?.trim()]));

  const filtered = allData.filter(r => targetNames.includes(r.name.trim()))
    .map(r => ({...r, genre: groupMap[r.name.trim()] || r.group}));

  console.log(`🎯 一致した人数: ${filtered.length}名`);

  if(filtered.length === 0){
    console.log("⚠️ 一致データなし");
    await browser.close();
    return;
  }

  const date = todayJpMd();
  const values = [];
  const grouped = {};

  filtered.forEach(r=>{
    const name = cleanForOutput(r.name);
    if(!grouped[name]) grouped[name] = [];
    grouped[name].push(r);
  });

  Object.keys(grouped).forEach((name, idx)=>{
    grouped[name].forEach((r,i)=>{
      values.push([
        idx===0 && i===0 ? date : "",
        i===0 ? name : "",
        r.genre,
        r.type,
        r.rank
      ]);
    });
  });

  const sheetName = `${new Date().getMonth()+1}月`;

  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: `${sheetName}!A:E`,
    valueInputOption:"USER_ENTERED",
    requestBody:{ values }
  });

  console.log("🎉 書き込み完了");
  await browser.close();
})();
