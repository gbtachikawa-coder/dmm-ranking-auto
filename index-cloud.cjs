const puppeteer = require("puppeteer");
const { google } = require("googleapis");

const SPREADSHEET_ID = "1T2g-vpj0EDFabuNgVqpP-9n12sLRVnR5jOEa1yWJgW0";

/* 日付 */
function todayJpMd() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  const w = ["日","月","火","水","木","金","土"][d.getDay()];
  return `${d.getMonth()+1}/${d.getDate()}(${w})`;
}

/* 正規化 */
function normalizeName(str){
  return str.replace(/[^ぁ-んァ-ヶー一-龠々]/g,"");
}

/* ランキング取得 */
async function fetchRanking(page, url, group) {
  console.log(`${group} 取得中...`);
  await page.goto(url, { waitUntil: "networkidle2" });

  await page.waitForSelector("table.rank_table");

  const results = await page.evaluate(() => {
    const rows = document.querySelectorAll("table.rank_table tr");
    const data = [];

    rows.forEach((row, i) => {
      if(i === 0) return;
      const tds = row.querySelectorAll("td");

      tds.forEach((td, idx) => {
        const img = td.querySelector("img");
        if(img && img.alt){
          data.push({
            name: img.alt,
            rank: i,
            col: idx
          });
        }
      });
    });
    return data;
  });

  return results.map(r => ({
    name: normalizeName(r.name),
    rank: r.rank,
    type: r.col === 0 ? "日間" : r.col === 1 ? "週間" : "月間",
    genre: group
  }));
}

(async () => {

  const auth = new google.auth.GoogleAuth({
    credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT),
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });

  const sheets = google.sheets({version:"v4", auth});

  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox"]
  });

  const page = await browser.newPage();
  await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120 Safari/537.36");

  const genres = [
    { label:"あちゃ", url:"https://www.dmm.co.jp/live/chat/-/character-ranking/=/genre=popular/group=acha/" },
    { label:"まちゃ", url:"https://www.dmm.co.jp/live/chat/-/character-ranking/=/genre=popular/group=macha/" },
    { label:"おちゃ", url:"https://www.dmm.co.jp/live/chat/-/character-ranking/=/genre=popular/group=ocha/" }
  ];

  let allResults = [];

  for(const g of genres){
    const data = await fetchRanking(page, g.url, g.label);
    console.log(`${g.label} 抽出件数:`, data.length);
    allResults = allResults.concat(data);
  }

  console.log("総取得件数:", allResults.length);

  const list = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: "検索リスト!B:C",
  });

  const targets = list.data.values.slice(1).map(r=>r[0]);

  const filtered = allResults.filter(r => targets.includes(r.name));

  console.log("一致人数:", filtered.length);

  if(filtered.length === 0){
    console.log("一致データなし");
    await browser.close();
    return;
  }

  const values = filtered.map(r=>[
    todayJpMd(),
    r.name,
    r.genre,
    r.type,
    r.rank
  ]);

  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: "11月!A:E",
    valueInputOption: "USER_ENTERED",
    requestBody:{values}
  });

  console.log("✅ 書き込み完了");

  await browser.close();
})();
