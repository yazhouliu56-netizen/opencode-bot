const TelegramBot = require('node-telegram-bot-api');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const TOKEN = process.env.TELEGRAM_BOT_TOKEN || '8808062598:AAFo8tv6crox4TIy1c8nPbXjp0iY-sQpiBg';
const BRIDGE_PORT = 3456;
const LOG = 'D:\\dev\\logs\\telegram.log';
const PROJECTS = 'D:\\dev\\projects';

const bot = new TelegramBot(TOKEN, { polling: true });
let bridgeReady = true;

function log(m) { fs.appendFileSync(LOG, `[${new Date().toISOString()}] ${m}\n`); }

function sendToBridge(chatId, text) {
  const data = JSON.stringify({ chatId, idea: text });
  const req = http.request({
    hostname: 'localhost', port: BRIDGE_PORT, path: '/process',
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
  }, (res) => {});
  req.on('error', () => {
    if (bridgeReady) { bridgeReady = false; bot.sendMessage(chatId, '❌ Bridge 未运行，请执行: D:\\dev\\bridge\\start-bridge.ps1'); }
  });
  req.write(data);
  req.end();
}

// 定时检查 outbox
setInterval(() => {
  try {
    const outbox = 'D:\\dev\\outbox';
    if (!fs.existsSync(outbox)) return;
    const files = fs.readdirSync(outbox).filter(f => f.endsWith('.json'));
    for (const f of files) {
      const filePath = path.join(outbox, f);
      const content = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
      const data = JSON.parse(content);
      bot.sendMessage(data.chatId, data.message).then(() => {
        fs.unlinkSync(filePath);
        log(`Sent: ${data.chatId}`);
      }).catch(e => log(`Send failed: ${e.message}`));
    }
  } catch (e) { log(`Poll error: ${e.message}`); }
}, 3000);

bot.onText(/\/start/, (msg) => {
  bot.sendMessage(msg.chat.id, `🤖 智能工作流

直接发文字，AI 自动判断意图：
• "打开京东" → 打开网站
• "搜索显卡" → 搜索
• "帮我做个记账本" → 创建项目

命令:
/list     - 项目列表
/models   - 模型配置
/research <问题> - Deep Research 深度研究
/heal     - 自愈检查
/status   - 系统健康检查
/learn    - 自学习循环 (评估→学习→再评估)
/rate <ID> <分数> - 给记忆评分 (1-5)`);
});

bot.onText(/\/list/, (msg) => {
  try {
    const dirs = fs.readdirSync(PROJECTS).filter(d => fs.statSync(path.join(PROJECTS, d)).isDirectory());
    bot.sendMessage(msg.chat.id, dirs.length ? `📁 项目:\n${dirs.map(d => '  • ' + d).join('\n')}` : '📭 空');
  } catch { bot.sendMessage(msg.chat.id, '❌ 读取失败'); }
});

// Deep Research 命令
bot.onText(/\/research (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const question = match[1].trim();
  const statusMsg = await bot.sendMessage(chatId, `🔬 开始 Deep Research: "${question.slice(0, 50)}..."\n⏳ 需要几分钟，完成后自动通知`);
  log(`Research: [${chatId}] ${question}`);
  try {
    const { execSync } = require('child_process');
    const output = execSync(`node D:\\dev\\bridge\\deep-research.js "${question.replace(/"/g, '\\"')}"`, {
      timeout: 300000, maxBuffer: 1024 * 1024
    }).toString();
    // 取报告部分（在 "研究报告" 和 "信息来源" 之间）
    const reportMatch = output.match(/═══════════ 研究报告 ═══════════[\s\S]*?(?=═══════════ 信息来源 ═══════════)/);
    const report = reportMatch ? reportMatch[0].trim() : output.slice(-3000);
    const lines = report.split('\n').filter(l => !l.includes('⚠') && !l.includes('⏱'));
    const short = lines.slice(0, 100).join('\n').slice(0, 4000);
    bot.sendMessage(chatId, `🔬 研究报告\n\n${short}\n\n完整报告: 终端执行查看`);
    log(`Research done: [${chatId}]`);
  } catch (e) {
    bot.sendMessage(chatId, `❌ 研究失败: ${e.message.slice(0, 200)}`);
    log(`Research error: [${chatId}] ${e.message}`);
  }
});

// 自愈重试命令：重试上次失败的命令
bot.onText(/\/heal/, (msg) => {
  bot.sendMessage(msg.chat.id, '🩺 运行自愈检查...');
  const { execSync } = require('child_process');
  try {
    const out = execSync(`node D:\\dev\\bridge\\auto-heal.js`, { timeout: 60000 }).toString();
    bot.sendMessage(msg.chat.id, `🩺 ${out.slice(0, 1500)}`);
  } catch (e) {
    bot.sendMessage(msg.chat.id, `❌ 自愈检查失败: ${e.message.slice(0, 200)}`);
  }
});

// 健康检查
bot.onText(/\/status/, (msg) => {
  bot.sendMessage(msg.chat.id, '🏥 运行全面检查...');
  const { execSync } = require('child_process');
  try {
    const out = execSync(`node D:\\dev\\bridge\\health-check.js`, { timeout: 30000 }).toString();
    bot.sendMessage(msg.chat.id, `🏥 ${out.slice(0, 3500)}`);
  } catch (e) {
    bot.sendMessage(msg.chat.id, `❌ 检查失败: ${e.message.slice(0, 200)}`);
  }
});

// 自学习循环
bot.onText(/\/learn/, (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId, '🧠 启动自学习循环 (评估→弱项分析→学习→再评估)\n⏳ 需要几分钟...');
  log(`Learn: [${chatId}]`);
  const { execSync } = require('child_process');
  try {
    const out = execSync('node D:\\dev\\bridge\\learn.js', { timeout: 600000, maxBuffer: 1024 * 1024 }).toString();
    // 提取报告部分
    const reportMatch = out.match(/═══════════ 学习报告 ═══════════[\s\S]*/);
    const report = reportMatch ? reportMatch[0] : out.slice(-1000);
    bot.sendMessage(chatId, `🧠 ${report.slice(0, 3500)}`);
    log(`Learn done: [${chatId}]`);
  } catch (e) {
    const out = e.stdout?.toString()?.slice(-1000) || e.message.slice(0, 200);
    bot.sendMessage(chatId, `❌ 学习循环失败:\n${out}`);
    log(`Learn error: [${chatId}] ${e.message}`);
  }
});

// 评分命令: /rate <id> <1-5>
bot.onText(/\/rate (.+)/, (msg, match) => {
  const args = match[1].trim().split(/\s+/);
  const id = args[0];
  const score = parseInt(args[1]);
  if (!id || !score || score < 1 || score > 5) {
    return bot.sendMessage(msg.chat.id, '用法: /rate <记忆ID> <1-5>\n如: /rate 42 5');
  }
  const { execSync } = require('child_process');
  try {
    execSync(`node D:\\dev\\bridge\\memory.js rate ${id} ${score}`, { timeout: 10000 });
    bot.sendMessage(msg.chat.id, `⭐ 记忆 #${id} 评分: ${score}/5`);
    log(`Rate: [${msg.chat.id}] #${id}=${score}`);
  } catch (e) {
    bot.sendMessage(msg.chat.id, `❌ 评分失败: ${e.message.slice(0, 100)}`);
  }
});

bot.onText(/\/models/, (msg) => {
  try {
    const env = fs.readFileSync('D:\\dev\\config\\.env', 'utf8');
    const models = env.split('\n').find(l => l.startsWith('AI_MODELS='))?.split('=').slice(1).join('=') || '未配置';
    const count = env.split('\n').find(l => l.startsWith('AI_ENSEMBLE_COUNT='))?.split('=')[1] || '3';
    bot.sendMessage(msg.chat.id, `🤖 当前模型配置\n\n模型: ${models}\n数量: ${count}个\n\n编辑 D:\\dev\\config\\.env 修改 AI_MODELS 和 AI_ENSEMBLE_COUNT 即可调整\n\n可用模型:\ngpt-4o-mini, gpt-4o, Llama-3.3-70B-Instruct\nMistral-large, Phi-3.5-MoE-instruct\nCohere-command-r-plus-08-2024`);
  } catch { bot.sendMessage(msg.chat.id, '❌ 读取配置失败'); }
});

// 处理语音消息
bot.on('voice', async (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId, '🎤 正在识别语音...');
  try {
    const voiceId = `voice_${chatId}_${Date.now()}`;
    const oggDir = 'D:\\dev\\inbox';
    const oggPath = path.join(oggDir, voiceId + '.ogg');
    const wavPath = path.join(oggDir, voiceId + '.wav');

    // 下载语音文件
    const fileLink = await bot.getFileLink(msg.voice.file_id);
    const res = await fetch(fileLink);
    const buffer = await res.arrayBuffer();
    fs.writeFileSync(oggPath, Buffer.from(buffer));

    const pythonPath = 'C:\\Users\\Administrator\\AppData\\Local\\Python\\bin\\python.exe';
    const scriptPath = 'D:\\dev\\telegram-bot\\transcribe.py';

    exec(`ffmpeg -y -i "${oggPath}" "${wavPath}" 2>nul && "${pythonPath}" "${scriptPath}" "${wavPath}"`, { timeout: 60000 }, (err, stdout) => {
      try { fs.unlinkSync(oggPath); } catch(e) {}
      try { fs.unlinkSync(wavPath); } catch(e) {}

      const text = (stdout || '').trim();
      if (text && text !== '(未识别)') {
        bot.sendMessage(chatId, `🗣️ "${text}"`);
        sendToBridge(chatId, text);
        log(`Voice: [${chatId}] ${text}`);
      } else {
        bot.sendMessage(chatId, '❌ 没听清，请再说一遍或打字');
      }
    });
  } catch (e) {
    bot.sendMessage(chatId, '❌ 语音处理失败，请打字');
    log(`Voice error: ${e.message}`);
  }
});

bot.on('message', (msg) => {
  if (!msg.text || msg.text.startsWith('/')) return;
  if (msg.voice) return;
  const text = msg.text.trim();
  if (text.length < 3) return;

  bot.sendMessage(msg.chat.id, '⏳ AI 分析中...');
  sendToBridge(msg.chat.id, text);
  log(`Received: [${msg.chat.id}] ${text}`);
});

log('Bot started (AI intent mode)');
console.log('Bot started - AI analyzes every message');
