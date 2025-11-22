const puppeteer = require("puppeteer");
const { google } = require("googleapis");

const SPREADSHEET_ID = "1T2g-vpj0EDFabuNgVqpP-9n12sLRVnR5jOEa1yWJgW0";
const KEYFILE_PATH = "./service-account-key.json";

/* ------------------ 日付フォーマット ------------------ */
function todayJpMd() {
  const now = new Date();
  const jstNow = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Tokyo" }));
  jstNow.setDate(jstNow.getDate() - 1);
  const weekday = ["日", "月", "火", "水", "木", "金", "土"][jstNow.getDay()];
  return `${jstNow.getMonth() + 1}/${jstNow.getDate()}(${weekday})`;
}

/* ------------------ 文字整形 ------------------ */
function cleanForOutput(raw) {
  if (!raw) return "";
  return raw.replace(/[^ぁ-んァ-ヶー一-龠々]/g, "");
}

/* ------------------ 各ジャンルのスクレイピング ------------------ */
async function scrapeGenre(page, genreUrl, groupLabel) {
  console.log(`🌐 ${groupLabel} ランキング取得開始...`);
  await page.goto(
    `https://www.dmm.co.jp/age_check/=/declared=yes/?rurl=${encodeURIComponent(genreUrl)}`,
    { waitUntil: "networkidle2", timeout: 90000 }
  );

  await page.waitForSelector("a.listbox-rank.js-lc-i3Link", { timeout: 20000 });

  const data = await page.evaluate((groupLabel) => {
    const results = [];
    const dateEl = document.querySelector("div.rank_title + p");
    const dateText = dateEl?.innerText?.trim() || "";
    const dateMatch = dateText.match(/(\d{1,2})\/(\d{1,2})/);
    const month = dateMatch ? parseInt(dateMatch[1]) : null;

    let typeLabels = ["日間", "週間", "月間"];
    if (groupLabel === "新人") typeLabels = ["新人日間", "新人週間"];
    if (groupLabel === "時間帯") typeLabels = ["朝帯", "昼帯", "夜帯"];

    const rows = document.querySelectorAll("tr[class^='rank']");
    rows.forEach((row, i) => {
      const rank = i + 1;
      const cells = Array.from(row.querySelectorAll("td"));
      cells.forEach((cell, idx) => {
        const a = cell.querySelector("a.listbox-rank.js-lc-i3Link");
        if (!a) return;
        const img = a.querySelector("img.cgimg");
        const name = img?.alt || a.innerText.trim();
        const type = typeLabels[idx] || typeLabels[typeLabels.length - 1];
        results.push({ rank, name, type });
      });
    });

    return { month, results };
  }, groupLabel);

  console.log(`✅ ${groupLabel}: ${data.results.length}件 抽出完了`);
  return data;
}

/* ------------------ メイン処理 ------------------ */
(async () => {
  const browser = await puppeteer.launch({
    headless: false,
    slowMo: 100,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
    defaultViewport: { width: 1280, height: 900 },
  });
  const page = await browser.newPage();

  const GENRES = [
    { label: "あちゃ", url: "https://www.dmm.co.jp/live/chat/-/character-ranking/=/genre=popular/group=acha/" },
    { label: "まちゃ", url: "https://www.dmm.co.jp/live/chat/-/character-ranking/=/genre=popular/group=macha/" },
    { label: "おちゃ", url: "https://www.dmm.co.jp/live/chat/-/character-ranking/=/genre=popular/group=ocha/" },
    { label: "新人", url: "https://www.dmm.co.jp/live/chat/-/character-ranking/=/genre=newface/" },
    { label: "時間帯", url: "https://www.dmm.co.jp/live/chat/-/character-ranking/=/genre=timezone/" },
  ];

  console.log("🚀 全ジャンルランキングを順次取得します...");
  let allData = [];
  let scrapeMonth = null;

  for (const g of GENRES) {
    try {
      const result = await scrapeGenre(page, g.url, g.label);
      if (!scrapeMonth && result.month) scrapeMonth = result.month;
      allData = allData.concat(result.results.map((r) => ({ ...r, group: g.label })));
    } catch (err) {
      console.log(`⚠️ ${g.label} の取得に失敗: ${err.message}`);
    }
  }

  if (!scrapeMonth) {
    const now = new Date();
    scrapeMonth = now.getMonth() + 1;
    console.log(`⚠️ 集計日が取得できなかったため、現在の月(${scrapeMonth}月)を使用します。`);
  }

  console.log(`📊 集計対象月: ${scrapeMonth}月`);
  console.log(`📦 合計 ${allData.length}件 取得完了`);

  /* ------------------ Google Sheets API ------------------ */
const auth = new google.auth.GoogleAuth({
  credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT),
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});

  const sheets = google.sheets({ version: "v4", auth });

  console.log("📖 検索リストを取得中...");
  const searchRes = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: "検索リスト!B:C",
  });

  const searchList = (searchRes.data.values || []).slice(1);
  const targetNames = searchList.map((r) => r[0]?.trim()).filter(Boolean);
  const groupMap = Object.fromEntries(searchList.map((r) => [r[0]?.trim(), r[1]?.trim()]));

  console.log(`🔎 検索リスト人数: ${targetNames.length}名`);

  const filtered = allData
    .filter((r) => targetNames.includes(r.name.trim()))
    .map((r) => ({
      ...r,
      genre: groupMap[r.name.trim()] || r.group,
    }));

  console.log(`🎯 一致した人数: ${filtered.length}名`);

  /* ---------- 並び順 ---------- */
  const genreOrder = { あちゃ: 1, まちゃ: 2, おちゃ: 3, 新人: 4, 時間帯: 5 };
  const typeOrder = {
    日間: 1, 週間: 2, 月間: 3, 昼帯: 4, 夜帯: 5, 朝帯: 6, 新人日間: 7, 新人週間: 8,
  };

  filtered.sort((a, b) => {
    const ga = genreOrder[a.genre] || 99;
    const gb = genreOrder[b.genre] || 99;
    if (ga !== gb) return ga - gb;

    const ta = typeOrder[a.type] || 99;
    const tb = typeOrder[b.type] || 99;
    if (ta !== tb) return ta - tb;

    if (a.rank !== b.rank) return a.rank - b.rank;

    const nameA = cleanForOutput(a.name);
    const nameB = cleanForOutput(b.name);
    return nameA.localeCompare(nameB, "ja");
  });

  /* ---------- 出力整形（空白行なし） ---------- */
  const date = todayJpMd();
  const values = [];

  const grouped = {};
  for (const r of filtered) {
    const name = cleanForOutput(r.name);
    if (!grouped[name]) grouped[name] = [];
    grouped[name].push(r);
  }

  const seen = new Set();
  const orderedNames = filtered
    .map((r) => cleanForOutput(r.name))
    .filter((n) => {
      if (seen.has(n)) return false;
      seen.add(n);
      return true;
    });

  orderedNames.forEach((name, nameIdx) => {
    const records = grouped[name];
    records.forEach((r, i) => {
      values.push([
        nameIdx === 0 && i === 0 ? date : "",
        i === 0 ? name : "",
        r.genre,
        r.type,
        r.rank,
      ]);
    });
  });

  if (values.length === 0) {
    console.log("⚠️ 一致する名前がありません。スプレッドシートには書き込みません。");
    await browser.close();
    return;
  }

  const sheetName = `${scrapeMonth}月`;

  /* ---------- シート存在チェック＆作成 ---------- */
  const sheetMeta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
  const sheetExists = sheetMeta.data.sheets.some(
    (s) => s.properties.title === sheetName
  );

  if (!sheetExists) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: {
        requests: [{ addSheet: { properties: { title: sheetName } } }],
      },
    });
    console.log(`🆕 ${sheetName} シートを新規作成しました。`);
  }

  console.log(`📤 ${sheetName} シートへ ${values.length}件 書き込み開始...`);
  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: `${sheetName}!A:E`,
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values },
  });

  console.log(`🎉 ${sheetName} への書き込み完了！（月自動判定・並び順完全版・空白なし）`);
  await browser.close();
})();
