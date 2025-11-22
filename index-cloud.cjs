const puppeteer = require("puppeteer");
const { google } = require("googleapis");

const SPREADSHEET_ID = "1T2g-vpj0EDFabuNgVqpP-9n12sLRVnR5jOEa1yWJgW0";

function todayJpMd() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  const w = ["日","月","火","水","木","金","土"][d.getDay()];
  return `${d.getMonth()+1}/${d.getDate()}(${w})`;
}

function normalizeName(str){
  return str.replace(/[^ぁ-んァ-ヶー一-龠々]/g,"");
}

async function fetchRanking(page, url, group){
  console.log(`${group} 取得開始`);

  await page.goto(url, { waitUntil: "networkidle2", timeout: 60000 });

  await page.waitForSelector(".rank_table", { timeout: 60000 });

  const results = await page.evaluate(group => {
    const data = [];
    const rows = document.querySelectorAll(".rank_table tbody tr");

    rows.forEach((row, index) => {
      const rank = index + 1;
      const tds = row.querySelectorAll("td");

      tds.forEach((td, colIndex) => {
        const img = td.querySelector("img");
        if(!img) return;

        const name = img.alt;
        const type = colIndex === 0 ? "日間" : colIndex === 1 ? "週間" : "月間";

        data.push({
          name,
          rank,
          type,
          genre: group
        });
      });
    });

    return data;
  }, group);

  console.log(`${group} 抽出数: ${results.length}`);
  return results;
}

(async () => {

  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox","--disable-dev-shm-usage"]
  });

  const page = await browser.newPage();

  const genres = [
    { label:"あちゃ", url:"https://www.dmm.co.jp/live/chat/-/character-ranking/=/genre=popular/group=acha/" },
    { label:"まちゃ", url:"https://www.dmm.co.jp/live/chat/-/character-ranking/=/genre=popular/group=macha/" },
    { label:"おちゃ", url:"https://www.dmm.co.jp/live/chat/-/character-ranking/=/genre=popular/group=ocha/" }
  ];

  let allResults = [];

  for(const g of genres){
    const data = await fetchRanking(page, g.url, g.label);
    allResults = allResults.concat(data);
  }

  console.log("総取得件数:", allResults.length);

  await browser.close();

  if(allResults.length === 0){
    console.log("DMMランキング取得失敗");
    return;
  }

  const auth = new google.auth.GoogleAuth({
    credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT),
    scopes: ["https://www.googleapis.com/auth/spreadsheets"]
  });

  const sheets = google.sheets({version:"v4", auth});

  const list = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: "検索リスト!B:C"
  });

  const targets = list.data.values.slice(1).map(r=>r[0]);

  const filtered = allResults.filter(r => targets.includes(normalizeName(r.name)));

  console.log("一致人数:", filtered.length);

  if(!filtered.length){
    console.log("一致なし");
    return;
  }

  const values = filtered.map(r=>[
    todayJpMd(),
    normalizeName(r.name),
    r.genre,
    r.type,
    r.rank
  ]);

  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: "11月!A:E",
    valueInputOption: "USER_ENTERED",
    requestBody:{ values }
  });

  console.log("✅ 正常書き込み完了");
})();
