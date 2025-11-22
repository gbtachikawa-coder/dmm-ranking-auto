// ✅ DMMランキング GitHub Actions 完全安定版

const axios = require("axios");
const cheerio = require("cheerio");
const { google } = require("googleapis");

const SPREADSHEET_ID = "1T2g-vpj0EDFabuNgVqpP-9n12sLRVnR5jOEa1yWJgW0";

// ===== 日付 =====
function todayJpMd() {
  const now = new Date();
  const jst = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Tokyo" }));
  jst.setDate(jst.getDate() - 1);
  const w = ["日","月","火","水","木","金","土"][jst.getDay()];
  return `${jst.getMonth()+1}/${jst.getDate()}(${w})`;
}

function cleanName(text){
  if(!text) return "";
  return text.replace(/[^ぁ-んァ-ヶー一-龠々]/g,"");
}

// ===== スクレイピング =====
async function fetchRanking(url,label){
  console.log(`🌐 ${label} 取得中...`);

  const res = await axios.get(url,{
    headers:{
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
      "Accept-Language": "ja-JP"
    }
  });

  const $ = cheerio.load(res.data);
  const list = [];

  $("tr.rank").each((i,el)=>{
    const rank = i+1;
    $(el).find("a.listbox-rank").each((idx,a)=>{
      const name = cleanName($(a).text().trim());
      if(name){
        list.push({
          name,
          rank,
          type: ["日間","週間","月間"][idx] || "日間",
          genre: label
        });
      }
    });
  });

  console.log(`✅ ${label} ${list.length}件取得`);
  return list;
}

(async ()=>{

const GENRES = [
  {label:"あちゃ",url:"https://www.dmm.co.jp/live/chat/-/character-ranking/=/genre=popular/group=acha/"},
  {label:"まちゃ",url:"https://www.dmm.co.jp/live/chat/-/character-ranking/=/genre=popular/group=macha/"},
  {label:"おちゃ",url:"https://www.dmm.co.jp/live/chat/-/character-ranking/=/genre=popular/group=ocha/"},
  {label:"新人",url:"https://www.dmm.co.jp/live/chat/-/character-ranking/=/genre=newface/"},
  {label:"時間帯",url:"https://www.dmm.co.jp/live/chat/-/character-ranking/=/genre=timezone/"}
];

let allData = [];

for(const g of GENRES){
  const d = await fetchRanking(g.url,g.label);
  allData.push(...d);
}

console.log(`📦 総取得件数 ${allData.length}`);

// ===== Google Sheets =====
const auth = new google.auth.GoogleAuth({
  credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT),
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});

const sheets = google.sheets({version:"v4",auth});

// 検索リスト
const searchRes = await sheets.spreadsheets.values.get({
  spreadsheetId: SPREADSHEET_ID,
  range: "検索リスト!B:C",
});

const searchList = (searchRes.data.values || []).slice(1);
const targets = searchList.map(r=>r[0]);

const filtered = allData.filter(r=>targets.includes(r.name));

console.log(`🎯 一致人数 ${filtered.length}`);

// 出力
if(filtered.length===0){
  console.log("⚠️ 一致データなし");
  return;
}

const date = todayJpMd();
const values = filtered.map((r,i)=>[
  i===0?date:"",
  r.name,
  r.genre,
  r.type,
  r.rank
]);

const month = new Date().getMonth()+1;
const sheetName = `${month}月`;

await sheets.spreadsheets.values.append({
  spreadsheetId: SPREADSHEET_ID,
  range: `${sheetName}!A:E`,
  valueInputOption:"USER_ENTERED",
  requestBody:{values}
});

console.log("✅ スプレッドシート書き込み完了");
})();
