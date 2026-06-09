const http = require("http");
const https = require("https");
const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const GH_TOKEN = process.env.GITHUB_TOKEN;
const PORT = process.env.PORT || 3000;

function httpsPost(host, path, body, extraHeaders) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const headers = { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data), ...extraHeaders };
    const opts = { hostname: host, path, method: "POST", headers };
    const r = https.request(opts, res => { let d = ""; res.on("data", c => d += c); res.on("end", () => { try { resolve(JSON.parse(d)); } catch { resolve(null); } }); });
    r.setTimeout(20000, () => { r.destroy(); resolve(null); });
    r.on("error", () => resolve(null));
    r.write(data);
    r.end();
  });
}

function httpsGet(host, path, extraHeaders) {
  return new Promise((resolve, reject) => {
    const opts = { hostname: host, path, method: "GET", headers: { "User-Agent": "OpenCodeBot/1.0", ...extraHeaders } };
    const r = https.request(opts, res => { let d = ""; res.on("data", c => d += c); res.on("end", () => { try { resolve(JSON.parse(d)); } catch { resolve(null); } }); });
    r.setTimeout(8000, () => { r.destroy(); resolve(null); });
    r.on("error", () => resolve(null));
    r.end();
  });
}

function httpsBuffer(url) {
  return new Promise((resolve, reject) => {
    https.get(url, res => { let d = []; res.on("data", c => d.push(c)); res.on("end", () => resolve(Buffer.concat(d))); }).on("error", reject);
  });
}

async function downloadTelegramFile(fileId) {
  const f = await httpsGet("api.telegram.org", "/bot" + TOKEN + "/getFile?file_id=" + fileId);
  if (!f?.result?.file_path) return null;
  return await httpsBuffer("https://api.telegram.org/file/bot" + TOKEN + "/" + f.result.file_path);
}

async function send(chatId, text) {
  if (!TOKEN) return;
  try { await httpsPost("api.telegram.org", "/bot" + TOKEN + "/sendMessage", { chat_id: chatId, text: text.slice(0, 4096) }); } catch {}
}

async function sendAction(chatId, action) {
  if (!TOKEN) return;
  try { await httpsPost("api.telegram.org", "/bot" + TOKEN + "/sendChatAction", { chat_id: chatId, action }); } catch {}
}

// --- Search sources ---

async function searchDuck(query) {
  return new Promise(resolve => {
    const r = https.get("https://lite.duckduckgo.com/lite/?q=" + encodeURIComponent(query), { timeout: 10000, headers: { "User-Agent": "Mozilla/5.0" } }, res => {
      let d = ""; res.on("data", c => d += c); res.on("end", () => {
        const titles = [...d.matchAll(/class='result-link'>([^<]+)<\/a>/g)].map(m => m[1]);
        const snippets = [...d.matchAll(/class='result-snippet'>([^<]*(?:<[^>]+>[^<]*)*)<\/td>/g)].map(m => m[1].replace(/<[^>]+>/g, ""));
        const urls = [...d.matchAll(/class='link-text'>([^<]+)<\/span>/g)].map(m => m[1]);
        const lines = [];
        for (let i = 0; i < Math.min(4, titles.length); i++) {
          lines.push((i + 1) + ". " + titles[i] + " - " + (urls[i] || "") + "\n   " + (snippets[i] || ""));
        }
        resolve(lines.join("\n\n").slice(0, 2500));
      });
    });
    r.on("error", () => resolve(""));
    r.end();
  });
}

async function fetchHN() {
  try {
    const ids = await httpsGet("hacker-news.firebaseio.com", "/v0/topstories.json");
    if (!ids?.length) return "";
    const items = await Promise.all(ids.slice(0, 5).map(id => httpsGet("hacker-news.firebaseio.com", "/v0/item/" + id + ".json")));
    const lines = items.filter(i => i && i.title).map(i => "• " + i.title + " (" + (i.score || 0) + " pts) - https://news.ycombinator.com/item?id=" + i.id);
    return lines.length ? "[Hacker News]\n" + lines.join("\n") : "";
  } catch { return ""; }
}

async function fetchGithubTrending() {
  if (!GH_TOKEN) return "";
  try {
    const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
    const q = encodeURIComponent("created:>" + weekAgo + " stars:>50");
    const d = await httpsGet("api.github.com", "/search/repositories?q=" + q + "&sort=stars&order=desc&per_page=5", { "Authorization": "Bearer " + GH_TOKEN });
    if (!d?.items?.length) return "";
    return "[GitHub Trending]\n" + d.items.map(i => "• " + i.full_name + " - " + i.html_url + "\n  " + (i.description || "") + " ⭐" + i.stargazers_count + " | " + (i.language || "N/A")).join("\n");
  } catch { return ""; }
}

async function fetchGithubSearch(query) {
  if (!GH_TOKEN) return "";
  try {
    const q = encodeURIComponent(query + " stars:>100");
    const d = await httpsGet("api.github.com", "/search/repositories?q=" + q + "&sort=stars&order=desc&per_page=5", { "Authorization": "Bearer " + GH_TOKEN });
    if (!d?.items?.length) return "";
    return "[GitHub Search: " + query + "]\n" + d.items.map(i => "• " + i.full_name + " - " + i.html_url + "\n  " + (i.description || "") + " ⭐" + i.stargazers_count).join("\n");
  } catch { return ""; }
}

async function fetchWikipedia(query) {
  try {
    const q = encodeURIComponent(query.slice(0, 100));
    const d = await httpsGet("en.wikipedia.org", "/w/api.php?action=query&list=search&srsearch=" + q + "&format=json&srlimit=3&srprop=snippet");
    if (!d?.query?.search?.length) return "";
    return "[Wikipedia]\n" + d.query.search.map((r, i) => (i + 1) + ". " + r.title + " - https://en.wikipedia.org/wiki/" + encodeURIComponent(r.title) + "\n   " + r.snippet.replace(/<[^>]+>/g, "")).join("\n").slice(0, 1500);
  } catch { return ""; }
}

// --- Specialized data sources ---

const STOCK_PATTERN = /\b([A-Z]{1,5}(?:\.(?:HK|SS|SZ|T|L|PA|DE|TO|VI))?)\b/;
const WEATHER_PATTERN = /(weather|天气|气温|温度|下雨|晴天|气温|台风|温哥华|北京|上海|深圳|广州|成都|杭州|武汉|南京|重庆|苏州|天津|长沙|郑州|东莞|青岛|西安|合肥|福州|昆明|大连|厦门|无锡|宁波|沈阳|长春|哈尔滨|济南|石家庄|南宁|贵阳|海口|太原|兰州|南昌|呼和浩特|银川|西宁|拉萨|乌鲁木齐|香港|台北|澳门|东京|首尔|纽约|伦敦|巴黎|柏林|悉尼|新加坡|曼谷|迪拜|莫斯科|多伦多|温哥华)/i;

async function fetchStock(sym) {
  try {
    const buf = await httpsBuffer("https://query1.finance.yahoo.com/v8/finance/chart/" + encodeURIComponent(sym) + "?interval=1d&range=5d");
    const m = JSON.parse(buf.toString()).chart.result[0].meta;
    return "Stock: " + m.shortName + " (" + m.symbol + ") = " + m.regularMarketPrice + " " + m.currency + " (High: " + m.regularMarketDayHigh + " Low: " + m.regularMarketDayLow + " Vol: " + m.regularMarketVolume.toLocaleString() + ")";
  } catch { return null; }
}

async function fetchStockFromQuery(query) {
  const m = query.match(STOCK_PATTERN);
  if (!m) return null;
  const sym = m[1];
  if (!sym.includes(".")) {
    for (const suffix of ["", ".HK", ".SS"]) {
      const r = await fetchStock(sym + suffix);
      if (r) return r;
    }
    return null;
  }
  return await fetchStock(sym);
}

async function fetchWeather(query) {
  const m = query.match(WEATHER_PATTERN);
  if (!m) return null;
  const loc = m[1];
  return new Promise(resolve => {
    const r = https.get("https://wttr.in/" + encodeURIComponent(loc) + "?format=%l:+%C+%t+%w+%h", { timeout: 5000, headers: { "User-Agent": "curl" } }, res => {
      let d = ""; res.on("data", c => d += c); res.on("end", () => resolve(d.trim() ? "Weather: " + d.trim() : null));
    });
    r.on("error", () => resolve(null));
    r.end();
  });
}

// --- Query type detection ---

function detectQueryType(query) {
  const q = query.toLowerCase();
  return {
    isTechTrend: /(trend|trending|热门|新项目|新工具|新框架|new (project|tool|lib|framework|tech)|popular|top|推荐.*(项目|工具|库|框架)|最近.*(项目|工具|技术|库|框架|火)|go语言|rust|python|react|ai|gpt|llm|开源|framework|library|language)/i.test(q),
    isNews: /(news|hacker news|tech news|最新|有什么新|发布|更新|announce|recent|what.*new|科技|行业|前沿)/i.test(q),
  };
}

// --- Multi-source context enrichment ---

function timeout(ms) {
  return new Promise(resolve => setTimeout(() => resolve(""), ms));
}

async function enrichContext(query) {
  const type = detectQueryType(query);

  // Stock or weather get specialized data (skip if query too short for ticker)
  if (query.length > 2) {
    const stock = await fetchStockFromQuery(query);
    if (stock) {
      const web = await searchDuck(query + " stock news");
      return "[STOCK DATA]\n" + stock + (web ? "\n\n[WEB SEARCH]\n" + web : "");
    }
  }
  const weather = await fetchWeather(query);
  if (weather) return "[WEATHER DATA]\n" + weather;

  // General: multi-source parallel search (with 12s global timeout)
  const searches = [searchDuck(query)];
  if (type.isTechTrend) {
    searches.push(fetchGithubTrending(), fetchGithubSearch(query), fetchHN());
  } else if (type.isNews) {
    searches.push(fetchHN(), fetchGithubTrending());
  }
  searches.push(fetchWikipedia(query));

  const results = await Promise.race([
    Promise.all(searches),
    timeout(12000).then(() => searches.map(() => ""))
  ]);
  const parts = results.filter(r => r && r.length > 0);
  return parts.length ? "[REAL-TIME DATA]\n" + parts.join("\n\n---\n\n") : "";
}

// --- AI ---

async function askAI(question) {
  if (!GH_TOKEN) return null;
  const today = new Date().toISOString().slice(0, 10);
  let context = "";
  try { context = await enrichContext(question); } catch {}

  let sysMsg = "You are OpenCode AI assistant. Today is " + today + ". Answer using real-time data below.";
  if (context) sysMsg += "\n\n" + context;
  sysMsg += "\n\nRequirements: Answer directly, be thorough. At the end list source URLs you used. Never say 'check sources yourself'.";

  try {
    const d = await httpsPost("models.inference.ai.azure.com", "/chat/completions", {
      model: "deepseek-r1", messages: [{ role: "system", content: sysMsg }, { role: "user", content: question }], max_tokens: 4096,
    }, { "Authorization": "Bearer " + GH_TOKEN });
    return d?.choices?.[0]?.message?.content || null;
  } catch { return null; }
}

// --- Vision & Voice ---

async function analyzeImage(base64, mime) {
  if (!GH_TOKEN) return "AI unavailable (no GITHUB_TOKEN)";
  try {
    const d = await httpsPost("models.inference.ai.azure.com", "/chat/completions", {
      model: "gpt-4o", max_tokens: 512,
      messages: [{
        role: "user", content: [
          { type: "text", text: "Describe this image in detail in the user's language." },
          { type: "image_url", image_url: { url: "data:" + mime + ";base64," + base64 } }
        ]
      }]
    }, { "Authorization": "Bearer " + GH_TOKEN });
    return d?.choices?.[0]?.message?.content || "Could not analyze image.";
  } catch { return "Vision API error."; }
}

async function transcribeAudio(base64) {
  if (!GH_TOKEN) return "AI unavailable (no GITHUB_TOKEN)";
  const boundary = "----FormBoundary" + Math.random().toString(36).slice(2);
  const body = Buffer.concat([
    Buffer.from("--" + boundary + '\r\nContent-Disposition: form-data; name="file"; filename="voice.ogg"\r\nContent-Type: audio/ogg\r\n\r\n'),
    Buffer.from(base64, "base64"),
    Buffer.from('\r\n--' + boundary + '\r\nContent-Disposition: form-data; name="model"\r\n\r\nwhisper-1\r\n--' + boundary + '--\r\n')
  ]);
  return new Promise(resolve => {
    const opts = { hostname: "models.inference.ai.azure.com", path: "/openai/deployments/whisper/audio/transcriptions?api-version=2024-10-21", method: "POST", headers: { "Content-Type": "multipart/form-data; boundary=" + boundary, "Content-Length": body.length, "Authorization": "Bearer " + GH_TOKEN } };
    const r = https.request(opts, res => { let d = ""; res.on("data", c => d += c); res.on("end", () => { try { resolve(JSON.parse(d).text); } catch { resolve(null); } }); });
    r.on("error", () => resolve(null));
    r.write(body);
    r.end();
  });
}

// --- Webhook ---

async function setWebhook() {
  if (!TOKEN) { console.log("No TOKEN"); return; }
  const base = process.env.RENDER_EXTERNAL_URL || "https://opencode-bot-80xf.onrender.com";
  try {
    const d = await httpsGet("api.telegram.org", "/bot" + TOKEN + "/setWebhook?url=" + base + "/webhook");
    console.log("Webhook:", d?.description || "?");
  } catch (e) { console.error("Webhook fail:", e.message); }
}

// --- Message handler ---

function handleMessage(msg) {
  const chat = msg.chat.id;
  if (msg.text) {
    const t = msg.text.trim();
    if (t === "/start") return send(chat, "Hello! I am OpenCode Bot.\nSend text, photos, or voice messages.\n/read <url> - Summarize webpage\n/stock <code> - Stock price\n/status - Bot info");
    if (t === "/help") return send(chat, "Send text/photos/voice. AI auto-answers with web search & sources.\n/read <url> - Summarize webpage\n/stock <code> - Stock price (e.g. AAPL, 0700.HK)\n/status - Info\n/ping - Pong");
    if (t === "/status") return send(chat, "Bot online\nModel: DeepSeek-R1\nWeb: DuckDuckGo + Wikipedia\nTech: GitHub Trending + Hacker News\nVision: GPT-4o\nVoice: Whisper\nStock: Yahoo Finance\nWeather: wttr.in");
    if (t === "/ping") return send(chat, "pong");
    if (t.startsWith("/stock ")) {
      sendAction(chat, "typing");
      const sym = t.slice(7).trim().toUpperCase();
      httpsBuffer("https://query1.finance.yahoo.com/v8/finance/chart/" + encodeURIComponent(sym) + "?interval=1d&range=5d").then(buf => {
        try {
          const d = JSON.parse(buf.toString()).chart.result[0].meta;
          const r = d.shortName + " (" + d.symbol + ")\nPrice: " + d.regularMarketPrice + " " + d.currency + "\nHigh: " + d.regularMarketDayHigh + " | Low: " + d.regularMarketDayLow + "\nPrev Close: " + d.chartPreviousClose + "\nVolume: " + d.regularMarketVolume.toLocaleString();
          send(chat, r);
        } catch { send(chat, "Stock not found. Try AAPL, 0700.HK, 600036.SS"); }
      }).catch(() => send(chat, "Stock lookup failed."));
      return;
    }
    if (t.startsWith("/read ")) {
      sendAction(chat, "typing");
      const url = t.slice(6).trim();
      if (!url.startsWith("http")) return send(chat, "Invalid URL. Use /read https://...");
      httpsBuffer(url).then(buf => {
        const html = buf.toString("utf8").replace(/<script[^>]*>[\s\S]*?<\/script>/g, "").replace(/<style[^>]*>[\s\S]*?<\/style>/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 4000);
        if (html.length < 50) return send(chat, "Could not read page content.");
        httpsPost("models.inference.ai.azure.com", "/chat/completions", {
          model: "deepseek-r1", max_tokens: 1024,
          messages: [{ role: "system", content: "Summarize this webpage content concisely." }, { role: "user", content: html }]
        }, { "Authorization": "Bearer " + GH_TOKEN }).then(d => send(chat, d?.choices?.[0]?.message?.content || "Summary failed.")).catch(() => send(chat, "AI error."));
      }).catch(() => send(chat, "Failed to fetch URL."));
      return;
    }
    // Non-command: auto AI with multi-source search
    sendAction(chat, "typing");
    askAI(t).then(a => send(chat, a || "AI unavailable")).catch(() => send(chat, "Error"));
    return;
  }
  if (msg.photo) {
    const fileId = msg.photo[msg.photo.length - 1].file_id;
    sendAction(chat, "typing");
    downloadTelegramFile(fileId).then(buf => {
      if (!buf) return send(chat, "Failed to download image.");
      const b64 = buf.toString("base64");
      const mime = "image/jpeg";
      analyzeImage(b64, mime).then(desc => send(chat, desc));
    }).catch(() => send(chat, "Image download error."));
    return;
  }
  if (msg.voice) {
    sendAction(chat, "typing");
    downloadTelegramFile(msg.voice.file_id).then(buf => {
      if (!buf) return send(chat, "Failed to download voice.");
      transcribeAudio(buf.toString("base64")).then(text => send(chat, text || "Transcription failed."));
    }).catch(() => send(chat, "Voice download error."));
    return;
  }
}

const server = http.createServer((req, res) => {
  if (req.method === "POST" && req.url === "/webhook") {
    let body = "";
    req.on("data", c => body += c);
    req.on("end", () => {
      try {
        const update = JSON.parse(body);
        if (update.message) handleMessage(update.message);
      } catch {}
      res.end("OK");
    });
  } else {
    res.end("OK");
  }
});

server.listen(PORT, () => {
  console.log("Bot on port " + PORT);
  setTimeout(setWebhook, 2000);
});
