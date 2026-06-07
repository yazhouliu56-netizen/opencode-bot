export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/setup') {
      const webhookUrl = url.origin + '/webhook';
      const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/setWebhook?url=${webhookUrl}`);
      const data = await res.json();
      return new Response(JSON.stringify(data, null, 2), { headers: { 'Content-Type': 'application/json' } });
    }

    if (url.pathname === '/status') {
      const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/getWebhookInfo`);
      const data = await res.json();
      return new Response(JSON.stringify(data, null, 2), { headers: { 'Content-Type': 'application/json' } });
    }

    if (request.method !== 'POST') return new Response('OK');

    const update = await request.json();
    const msg = update.message;
    if (!msg) return new Response('OK');

    if (!msg.text) {
      await send(env.TELEGRAM_BOT_TOKEN, msg.chat.id, '抱歉，我只支持文字消息。');
      return new Response('OK');
    }

    const text = msg.text.trim();
    const chatId = msg.chat.id;
    await send(env.TELEGRAM_BOT_TOKEN, chatId, '⏳ 思考中...');
    // 保存chat_id到记忆, 供本地notify使用
    try {
      await fetch(`${env.SUPABASE_URL}/rest/v1/memories`, {
        method: 'POST',
        headers: { apikey: env.SUPABASE_KEY, Authorization: `Bearer ${env.SUPABASE_KEY}`, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates' },
        body: JSON.stringify({ content: String(chatId), tags: ['_chat_id'] }),
        signal: AbortSignal.timeout(3000),
      });
    } catch {}

    try {
      const reply = await smartReply(env, text);
      await send(env.TELEGRAM_BOT_TOKEN, chatId, reply.slice(0, 4000));
    } catch (e) {
      await send(env.TELEGRAM_BOT_TOKEN, chatId, '❌ 出错了，稍后重试');
    }

    return new Response('OK');
  },
};

async function smartReply(env, text) {
  // 1. 搜索记忆（最近5条）
  let memory = '';
  if (env.SUPABASE_URL && env.SUPABASE_KEY) {
    try {
      const res = await fetch(`${env.SUPABASE_URL}/rest/v1/memories?select=id,content,tags,created_at&limit=5&order=created_at.desc`, {
        headers: { apikey: env.SUPABASE_KEY, Authorization: `Bearer ${env.SUPABASE_KEY}` },
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.length) {
          memory = '\n\n最近记忆:\n' + data.map(m => {
            const date = (m.created_at || '').slice(0, 10);
            const tags = (m.tags || []).join(', ');
            return `[${date}] ${tags ? '('+tags+') ' : ''}${m.content.slice(0, 200)}`;
          }).join('\n');
        }
      }
    } catch {}
  }

  // 2. 智能路由：让 AI 决定要不要搜索
  const searchDecision = await callAI(env, [
    { role: 'system', content: `判断以下用户问题是否需要实时网络搜索。只需要搜索最新信息(技术版本、新闻、价格、天气等有时效性的内容)。返回 JSON: {"search": true/false, "query": "搜索关键词"}
问题: ${text.slice(0, 200)}` },
  ], 128);
  let webInfo = '';
  try {
    const decision = JSON.parse(searchDecision || '{}');
    if (decision.search && decision.query) {
      const sr = await webSearch(decision.query);
      if (sr) webInfo = '\n\n搜索结果:\n' + sr;
    }
  } catch {}

  // 3. AI 回答（带上下文）
  const systemMsg = `你是一个智能助手。中文回答，简洁直接。回答基于你的知识${memory ? '、记忆库中的经验' : ''}${webInfo ? '、实时搜索结果' : ''}。不要提及"根据记忆"或"根据搜索"。`;

  const reply = await callAI(env, [
    { role: 'system', content: systemMsg + memory + webInfo },
    { role: 'user', content: text },
  ], 1024);

  return reply || '✅ 已处理';
}

async function webSearch(query) {
  try {
    const res = await fetch(`https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`, {
      signal: AbortSignal.timeout(8000),
    });
    const html = await res.text();
    const results = [];
    const links = html.match(/<a[^>]*class="result-link"[^>]*href="([^"]*)"[^>]*>([^<]*)<\/a>/gi) || [];
    const snippets = html.match(/<td class="result-snippet"[^>]*>([^<]*)<\/td>/gi) || [];
    for (let i = 0; i < Math.min(links.length, 3); i++) {
      const href = links[i].match(/href="([^"]*)"/)?.[1] || '';
      const title = links[i].match(/>([^<]*)</)?.[1] || '';
      const snippet = snippets[i]?.replace(/<[^>]+>/g, '').slice(0, 150) || '';
      results.push(`${i+1}. ${title}: ${snippet} (${href})`);
    }
    return results.join('\n');
  } catch { return ''; }
}

async function callAI(env, messages, maxTokens) {
  if (env.GITHUB_TOKEN) {
    try {
      const res = await fetch('https://models.inference.ai.azure.com/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${env.GITHUB_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'gpt-4.1-nano', messages, max_tokens: maxTokens || 1024 }),
        signal: AbortSignal.timeout(25000),
      });
      if (res.ok) { const d = await res.json(); return d.choices?.[0]?.message?.content; }
    } catch {}
  }
  return null;
}

async function send(token, chatId, text) {
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text }),
    });
  } catch {}
}
