const puppeteer = require("puppeteer");
const cheerio = require("cheerio");
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

async function fetchRanking(url, group) {
  console.log(`${group} 取得開始`);

  const browser = await puppeteer.launch({
    headless: "new",
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage"
    ]
  });

  const page = await browser.newPage();

  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
  );

  await page.goto(url, { waitUntil: "networkidle2", timeout: 60000 });

  try {
    await page.waitForSelector("table.rank_table", { timeout: 60000 });
  } catch {
    console.log(`${group} ランキングHTML取得失敗`);
    await browser.close();
    return [];
  }

  const html = await page.content();
  await browser.close();

  const $ = cheerio.load(html);
  const results = [];

  $("table.rank_table tr").each((i, el) => {
    if (i === 0) return;
    const tds = $(el).find("td");

    tds.each((idx, td) => {
      const name = $(td).find("img").attr("alt");
      if (name) {
        results.push({
          name: normalizeName(name),
          rank: i,
          type: idx === 0 ? "日間" : idx === 1 ? "週間" : "月間",
          genre: group
        });
      }
    });
  });

  console.log(`${group} 抽出件数: ${results.length}`);
  return results;
}

(async () => {

  const auth = new google.auth.GoogleAuth({
    credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT),
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });

  const sheets = google.sheets({version:"v4", auth});

  const genres = [
    { label:"あちゃ", url:"https://www.dmm.co.jp/live/chat/-/character-ranking/=/genre=popular/group=acha/" },
    { label:"まちゃ", url:"https://www.dmm.co.jp/live/chat/-/character-ranking/=/genre=popular/group=macha/" },
    { label:"おちゃ", url:"https://www.dmm.co.jp/live/chat/-/character-ranking/=/genre=popular/group=ocha/" }
  ];

  let allResults = [];

  for (const g of genres) {
    const data = await fetchRanking(g.url, g.label);
    allResults = allResults.concat(data);
  }

  console.log("総取得件数:", allResults.length);

})();
