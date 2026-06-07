const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const TOKEN = process.env.TELEGRAM_BOT_TOKEN || require('D:\\dev\\bridge\\env.js').telegramToken;
const LOG = 'D:\\dev\\logs\\telegram.log';
const BRIDGE = 'D:\\dev\\bridge';

const bot = new TelegramBot(TOKEN, { polling: true });

function log(m) { try { fs.appendFileSync(LOG, `[${new Date().toISOString()}] ${m}\n`); } catch {} }

function runAsk(chatId, text) {
  try {
    const out = execSync(`node "${BRIDGE}\\ask.js" "${text.replace(/"/g, '\\"')}"`, {
      timeout: 120000, encoding: 'utf8', maxBuffer: 1024 * 1024,
      windowsHide: true,
    });
    const reply = out.trim().slice(0, 4000);
    bot.sendMessage(chatId, reply || '✅ 已处理');
  } catch (e) {
    const err = e.stdout?.trim()?.slice(-1000) || e.message.slice(0, 200);
    bot.sendMessage(chatId, '❌ ' + err);
    log(`Error: [${chatId}] ${e.message.slice(0, 100)}`);
  }
}

bot.onText(/\/start/, (msg) => {
  bot.sendMessage(msg.chat.id, `🤖 OpenCode 远程助手

直接发文字，我帮你处理。
命令:
/list     - 项目列表
/research <问题>  - Deep Research
/heal     - 自愈检查
/status   - 系统健康检查
/learn    - 自学习循环
/rate <ID> <分>  - 给记忆评分
/daily    - 学习日报`);
});

bot.onText(/\/list/, (msg) => {
  try {
    const dirs = fs.readdirSync('D:\\dev\\projects').filter(d => fs.statSync(path.join('D:\\dev\\projects', d)).isDirectory());
    bot.sendMessage(msg.chat.id, dirs.length ? '📁 项目:\n' + dirs.map(d => '  • ' + d).join('\n') : '📭 空');
  } catch { bot.sendMessage(msg.chat.id, '❌ 读取失败'); }
});

bot.onText(/\/research (.+)/, async (msg, match) => {
  await bot.sendMessage(msg.chat.id, '🔬 开始 Deep Research...');
  runAsk(msg.chat.id, '/deep ' + match[1]);
});

bot.onText(/\/heal/, (msg) => {
  bot.sendMessage(msg.chat.id, '🩺 运行自愈检查...');
  runAsk(msg.chat.id, '/heal');
});

bot.onText(/\/status/, (msg) => {
  bot.sendMessage(msg.chat.id, '🏥 运行健康检查...');
  runAsk(msg.chat.id, '/health');
});

bot.onText(/\/learn/, (msg) => {
  bot.sendMessage(msg.chat.id, '🧠 启动自学习循环...');
  runAsk(msg.chat.id, '/learn');
});

bot.onText(/\/rate (.+)/, (msg, match) => {
  runAsk(msg.chat.id, '/rate ' + match[1]);
});

bot.onText(/\/daily/, (msg) => {
  runAsk(msg.chat.id, '/daily');
});

// 语音消息
bot.on('voice', async (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId, '🎤 识别语音中...');
  try {
    const fileLink = await bot.getFileLink(msg.voice.file_id);
    const res = await fetch(fileLink);
    const buffer = await res.arrayBuffer();
    const oggPath = path.join('D:\\dev\\inbox', `voice_${Date.now()}.ogg`);
    fs.writeFileSync(oggPath, Buffer.from(buffer));

    const py = 'C:\\Users\\Administrator\\AppData\\Local\\Python\\bin\\python.exe';
    execSync(`ffmpeg -y -i "${oggPath}" "${oggPath.replace('.ogg', '.wav')}" 2>nul`, { timeout: 15000 });
    const out = execSync(`"${py}" "${BRIDGE}\\voice.py" "${oggPath.replace('.ogg', '.wav')}"`, { timeout: 30000, encoding: 'utf8' });
    try { fs.unlinkSync(oggPath); } catch {}
    try { fs.unlinkSync(oggPath.replace('.ogg', '.wav')); } catch {}

    const text = out.trim();
    if (text && text !== '(未识别)') {
      bot.sendMessage(chatId, '🗣️ "' + text + '"');
      runAsk(chatId, text);
    } else {
      bot.sendMessage(chatId, '❌ 没听清，请打字');
    }
  } catch (e) {
    bot.sendMessage(chatId, '❌ 语音处理失败');
    log(`Voice error: ${e.message.slice(0, 100)}`);
  }
});

// 普通文字消息
bot.on('message', (msg) => {
  if (!msg.text || msg.text.startsWith('/') || msg.voice) return;
  const text = msg.text.trim();
  if (text.length < 3) return;
  bot.sendMessage(msg.chat.id, '⏳ 处理中...');
  log(`Received: [${msg.chat.id}] ${text}`);
  runAsk(msg.chat.id, text);
});

log('Bot started');
console.log('Bot started - listening for messages');
