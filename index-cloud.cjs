// index-cloud.cjs（GitHub Actions 完全安定版）

const puppeteer = require("puppeteer");
const { google } = require("googleapis");

const SPREADSHEET_ID = "1T2g-vpj0EDFabuNgVqpP-9n12sLRVnR5jOEa1yWJgW0";

/* ===== 日付 ===== */
function todayJpMd() {
  const now = new Date();
  const jst = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Tokyo" }));
  jst.setDate(jst.getDate() - 1);
  const w = ["日","月","火","水","木","金","土"][jst.getDay()];
  return `${jst.getMonth()+1}/${jst.getDate()}(${w})`;
}

function cleanForOutput(raw){
  if(!raw) return "";
  return raw.replace(/[^ぁ-んァ-ヶー一-龠々]/g,'');
}

/* ===== ランキング取得 ===== */
async function scrapeGenre(page, url, label){
  console.log(`🌐 ${label} 取得開始`);

  await page.goto(
    `https://www.dmm.co.jp/age_check/=/declared=yes/?rurl=${encodeURIComponent(url)}`,
    { waitUntil: "domcontentloaded", timeout: 90000 }
  );

  // 年齢確認対策
  const ageBtn = await page.$("a[href*='declared=yes']");
  if(ageBtn){
    await ageBtn.click();
    await new Promise(r=>setTimeout(r,3000));
  }

  // ★ここが超重要：確実に存在するランキング親要素
  await page.waitForSelector("div#ranking", { timeout: 60000 });

  const data = await page.evaluate((label)=>{
    const results = [];

    let typeLabels = ["日間","週間","月間"];
    if(label==="新人") typeLabels=["新人日間","新人週間"];
    if(label==="時間帯") typeLabels=["朝帯","昼帯","夜帯"];

    document.querySelectorAll("div.rank_list table tr").forEach((tr,i)=>{
      const rank = i+1;
      tr.querySelectorAll("a").forEach((a,idx)=>{
        const name = a.querySelector("img")?.alt || a.textContent.trim();
        if(!name) return;
        const type = typeLabels[idx] || typeLabels[typeLabels.length-1];
        results.push({rank,name,type});
      });
    });

    return { month:new Date().getMonth()+1, results };
  },label);

  console.log(`✅ ${label} ${data.results.length}件`);
  return data;
}

/* ===== メイン ===== */
(async()=>{
  const browser = await puppeteer.launch({
    headless: "new",
    args:[
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu"
    ]
  });

  const page = await browser.newPage();
  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36"
  );

  const GENRES = [
    {label:"あちゃ",url:"https://www.dmm.co.jp/live/chat/-/character-ranking/=/genre=popular/group=acha/"},
    {label:"まちゃ",url:"https://www.dmm.co.jp/live/chat/-/character-ranking/=/genre=popular/group=macha/"},
    {label:"おちゃ",url:"https://www.dmm.co.jp/live/chat/-/character-ranking/=/genre=popular/group=ocha/"},
    {label:"新人",url:"https://www.dmm.co.jp/live/chat/-/character-ranking/=/genre=newface/"},
    {label:"時間帯",url:"https://www.dmm.co.jp/live/chat/-/character-ranking/=/genre=timezone/"}
  ];

  let allData=[];
  let scrapeMonth=null;

  for(const g of GENRES){
    try{
      const r=await scrapeGenre(page,g.url,g.label);
      if(!scrapeMonth) scrapeMonth=r.month;
      allData=allData.concat(r.results.map(x=>({...x,group:g.label})));
    }catch(e){
      console.log(`⚠️ ${g.label}失敗: ${e.message}`);
    }
  }

  console.log(`📦 合計取得 ${allData.length}件`);

  /* ===== Sheets ===== */
  const auth=new google.auth.GoogleAuth({
    credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT),
    scopes:["https://www.googleapis.com/auth/spreadsheets"]
  });
  const sheets=google.sheets({version:"v4",auth});

  const searchRes = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range:"検索リスト!B:C"
  });

  const list=(searchRes.data.values||[]).slice(1);
  const targets=list.map(r=>r[0]).filter(Boolean);

  const filtered=allData.filter(d=>targets.includes(d.name.trim()));

  console.log(`🎯 一致:${filtered.length}件`);

  if(filtered.length===0){
    console.log("⚠️ 該当なし");
    await browser.close();
    return;
  }

  const values=[];
  const date=todayJpMd();

  filtered.forEach((r,i)=>{
    values.push([
      i===0?date:"",
      i===0?r.name:"",
      r.group,
      r.type,
      r.rank
    ]);
  });

  const sheetName=`${scrapeMonth}月`;

  await sheets.spreadsheets.values.append({
    spreadsheetId:SPREADSHEET_ID,
    range:`${sheetName}!A:E`,
    valueInputOption:"USER_ENTERED",
    requestBody:{values}
  });

  console.log("🎉 書き込み成功");
  await browser.close();
})();
