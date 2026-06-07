// Telegram Bot - Render.com 部署版 (Webhook)
// Bot接收消息 -> 调本地OpenCode处理 -> 返回结果
// 部署后通过 /ask <问题> 使用

const express = require('express');
const { execSync } = require('child_process');
const path = require('path');
const https = require('https');

const TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const PORT = process.env.PORT || 3000;
const WEBHOOK_URL = process.env.WEBHOOK_URL || '';

// 简单内存缓存：每个用户最近一次回复
const cache = new Map();

const app = express();
app.use(express.json());

// Telegeram API 转发
function tg(method, payload) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(payload);
    const req = https.request(
      `https://api.telegram.org/bot${TOKEN}/${method}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } },
      (res) => { let b = ''; res.on('data', c => b += c); res.on('end', () => resolve(b)); }
    );
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

// 处理消息
async function handleMessage(chatId, text) {
  // 缓存命中
  const key = `${chatId}:${text}`;
  if (cache.has(key)) {
    await tg('sendMessage', { chat_id: chatId, text: cache.get(key) });
    return;
  }

  await tg('sendChatAction', { chat_id: chatId, action: 'typing' });

  try {
    // 调用 OpenAI API 处理（复用项目的 query-expert 逻辑）
    // 这里用轻量方式：直接调 GPT-4o-mini
    const response = await queryAI(text);
    cache.set(key, response);
    // 只保留最近 100 条
    if (cache.size > 100) {
      const first = cache.keys().next().value;
      cache.delete(first);
    }
    await tg('sendMessage', { chat_id: chatId, text: response.slice(0, 4096) });
  } catch (e) {
    await tg('sendMessage', { chat_id: chatId, text: `❌ ${e.message.slice(0, 200)}` });
  }
}

// 直接调 AI 处理（不需要整个 bridge）
async function queryAI(text) {
  const githubToken = process.env.GITHUB_TOKEN;
  if (!githubToken) return '未配置 GITHUB_TOKEN 环境变量';

  const res = await fetch('https://models.inference.ai.azure.com/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${githubToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: '你是一个AI编程助手。用户通过Telegram发消息给你，请用中文简洁回答。如果是编程问题，给出可直接运行的代码。' },
        { role: 'user', content: text }
      ],
      max_tokens: 2048,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`API ${res.status}: ${body.slice(0, 100)}`);
  }

  const data = await res.json();
  return data.choices?.[0]?.message?.content || '无响应';
}

// Webhook 入口
app.post('/webhook', async (req, res) => {
  const msg = req.body?.message;
  if (msg?.text && msg?.chat?.id) {
    // 异步处理，不阻塞响应
    handleMessage(msg.chat.id, msg.text).catch(e => console.error(e));
  }
  res.sendStatus(200);
});

// 健康检查
app.get('/', (req, res) => res.send('ok'));

// 设置 Webhook
async function setupWebhook() {
  if (!WEBHOOK_URL) {
    console.log('⚠️ WEBHOOK_URL 未设置，无法注册 webhook');
    return;
  }
  const url = `https://api.telegram.org/bot${TOKEN}/setWebhook?url=${WEBHOOK_URL}`;
  try {
    const res = await fetch(url);
    const data = await res.json();
    console.log('Webhook:', data.description || data.ok);
  } catch (e) {
    console.error('Webhook 失败:', e.message);
  }
}

app.listen(PORT, async () => {
  console.log(`Bot running on :${PORT}`);
  if (TOKEN && WEBHOOK_URL) await setupWebhook();
});
