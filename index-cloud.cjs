const axios = require("axios");
const cheerio = require("cheerio");
const { google } = require("googleapis");

const SPREADSHEET_ID = "1T2g-vpj0EDFabuNgVqpP-9n12sLRVnR5jOEa1yWJgW0";

/* 日付 */
function todayJpMd() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  const w = ["日","月","火","水","木","金","土"][d.getDay()];
  return `${d.getMonth()+1}/${d.getDate()}(${w})`;
}

/* 文字正規化 */
function normalizeName(str){
  return str.replace(/[^ぁ-んァ-ヶー一-龠々]/g,"");
}

/* ランキング取得 */
async function fetchRanking(url, group) {
  console.log(`${group} 取得中...`);

  const res = await axios.get(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
      Cookie: "adultChk=1"
    }
  });

  const $ = cheerio.load(res.data);
  const results = [];

  $("table.rank_table tr").each((i, el) => {
    const rank = i;
    if(rank === 0) return;

    $(el).find("td").each((idx, td)=>{
      const name = $(td).find("img").attr("alt");
      if(name){
        results.push({
          name: normalizeName(name),
          rank: rank,
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
  for(const g of genres){
    const data = await fetchRanking(g.url, g.label);
    allResults = allResults.concat(data);
  }

  console.log("総取得件数:", allResults.length);

  // 検索リスト取得
  const list = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: "検索リスト!B:C",
  });

  const targets = list.data.values.slice(1).map(r=>r[0]);

  const filtered = allResults.filter(r => targets.includes(r.name));

  console.log("一致人数:", filtered.length);

  if(filtered.length === 0){
    console.log("一致データなし");
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

})();
