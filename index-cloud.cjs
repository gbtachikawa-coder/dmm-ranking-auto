// index-cloud.cjs【GitHub Actions 完全動作版】

const puppeteer = require("puppeteer");
const { google } = require("googleapis");

const SPREADSHEET_ID = "1T2g-vpj0EDFabuNgVqpP-9n12sLRVnR5jOEa1yWJgW0";

// ================= 共通関数 =================

function todayJpMd() {
  const now = new Date();
  const jstNow = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Tokyo" }));
  jstNow.setDate(jstNow.getDate() - 1);
  const weekday = ["日","月","火","水","木","金","土"][jstNow.getDay()];
  return `${jstNow.getMonth()+1}/${jstNow.getDate()}(${weekday})`;
}

function cleanForOutput(raw) {
  if (!raw) return "";
  return raw.replace(/[^ぁ-んァ-ヶー一-龠々]/g, "");
}

// ================= スクレイピング =================

async function scrapeGenre(page, genreUrl, groupLabel) {
  console.log(`🌐 ${groupLabel} ランキング取得開始...`);

  await page.goto(
    `https://www.dmm.co.jp/age_check/=/declared=yes/?rurl=${encodeURIComponent(genreUrl)}`,
    { waitUntil: "domcontentloaded", timeout: 90000 }
  );

  // 年齢確認対策
  const ageBtn = await page.$("a[href*='declared=yes']");
  if (ageBtn) {
    await ageBtn.click();
    await new Promise(r => setTimeout(r, 3000));
  }

  // ランキング要素待機
  await page.waitForSelector("a.listbox-rank.js-lc-i3Link", { timeout: 60000 });

  const data = await page.evaluate((groupLabel) => {
    const results = [];

    const dateEl = document.querySelector("div.rank_title + p");
    const dateText = dateEl?.innerText || "";
    const match = dateText.match(/(\d{1,2})\/(\d{1,2})/);
    const month = match ? parseInt(match[1]) : null;

    let typeLabels = ["日間", "週間", "月間"];
    if (groupLabel === "新人") typeLabels = ["新人日間", "新人週間"];
    if (groupLabel === "時間帯") typeLabels = ["朝帯", "昼帯", "夜帯"];

    const rows = document.querySelectorAll("tr[class^='rank']");
    rows.forEach((row, i) => {
      const rank = i + 1;
      const cells = row.querySelectorAll("td");

      cells.forEach((cell, idx) => {
        const a = cell.querySelector("a.listbox-rank.js-lc-i3Link");
        if (!a) return;
        const img = a.querySelector("img.cgimg");
        const name = img?.alt || a.innerText.trim();
        const type = typeLabels[idx] || typeLabels[0];
        results.push({ rank, name, type });
      });
    });

    return { month, results };
  }, groupLabel);

  console.log(`✅ ${groupLabel}: ${data.results.length}件 抽出`);
  return data;
}

// ================= メイン処理 =================

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
    defaultViewport: { width: 1280, height: 900 }
  });

  const page = await browser.newPage();
  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
  );

  const GENRES = [
    { label:"あちゃ", url:"https://www.dmm.co.jp/live/chat/-/character-ranking/=/genre=popular/group=acha/" },
    { label:"まちゃ", url:"https://www.dmm.co.jp/live/chat/-/character-ranking/=/genre=popular/group=macha/" },
    { label:"おちゃ", url:"https://www.dmm.co.jp/live/chat/-/character-ranking/=/genre=popular/group=ocha/" },
    { label:"新人", url:"https://www.dmm.co.jp/live/chat/-/character-ranking/=/genre=newface/" },
    { label:"時間帯", url:"https://www.dmm.co.jp/live/chat/-/character-ranking/=/genre=timezone/" },
  ];

  let allData = [];
  let scrapeMonth = null;

  for (const g of GENRES) {
    try {
      const result = await scrapeGenre(page, g.url, g.label);
      if (!scrapeMonth && result.month) scrapeMonth = result.month;
      allData.push(...result.results.map(r => ({ ...r, group: g.label })));
    } catch (e) {
      console.log(`⚠ ${g.label} 取得失敗: ${e.message}`);
    }
  }

  scrapeMonth ||= new Date().getMonth()+1;
  console.log(`📊 対象月: ${scrapeMonth}月`);

  // ================= Google Sheets =================

  const auth = new google.auth.GoogleAuth({
    credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT),
    scopes: ["https://www.googleapis.com/auth/spreadsheets"]
  });

  const sheets = google.sheets({version:"v4", auth});

  const searchRes = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: "検索リスト!B:C"
  });

  const searchList = (searchRes.data.values || []).slice(1);
  const targetNames = searchList.map(r=>r[0]?.trim()).filter(Boolean);

  const filtered = allData.filter(r => targetNames.includes(r.name.trim()));
  console.log(`🎯 一致件数: ${filtered.length}`);

  if (filtered.length === 0) {
    console.log("⚠ 一致データなし");
    await browser.close();
    return;
  }

  const sheetName = `${scrapeMonth}月`;

  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: `${sheetName}!A:E`,
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: filtered.map((r,i)=>[
        i===0?todayJpMd():"",
        cleanForOutput(r.name),
        r.group,
        r.type,
        r.rank
      ])
    }
  });

  console.log("✅ スプレッドシート書き込み完了");
  await browser.close();
})();
