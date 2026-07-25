// api/translate.js
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

// ============================================================
// 翻译库（read-through 缓存）
// - 库文件：项目根 data/translations.json（vercel dev 本地可读写）
// - 生产提醒：Vercel serverless 文件系统只读，写入不持久；上线共享库需换 KV，接口不变。
// - key：卡牌 code（稳定）；缺 code 的卡兜底用 'h:'+sha1(原文)
// - 值：{ zh 译文, src 原文, ts 时间戳 }；命中但 src 变化（牌库 errata）则重译覆盖
// ============================================================
const DB_DIR = path.join(process.cwd(), 'data');
const DB_FILE = path.join(DB_DIR, 'translations.json');

let cache = null;                    // Map<key, {zh, src, ts}>
let writeChain = Promise.resolve();  // 串行化落盘，避免并发读改写互相覆盖

function loadCache() {
    if (cache) return cache;
    cache = new Map();
    try {
        if (fs.existsSync(DB_FILE)) {
            const obj = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
            for (const [k, v] of Object.entries(obj)) cache.set(k, v);
            console.log(`[翻译库] 已载入 ${cache.size} 条`);
        }
    } catch (e) {
        console.error('[翻译库] 载入失败，改用空库：', e.message);
    }
    return cache;
}

function persistCache() {
    writeChain = writeChain.then(() => new Promise((resolve) => {
        try {
            if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });
            const obj = {};
            for (const [k, v] of cache.entries()) obj[k] = v;
            fs.writeFile(DB_FILE, JSON.stringify(obj, null, 2), 'utf8', (err) => {
                if (err) console.error('[翻译库] 写入失败：', err.message);
                resolve();
            });
        } catch (e) {
            console.error('[翻译库] 写入失败：', e.message);
            resolve();
        }
    }));
    return writeChain;
}

function cacheKey(code, text) {
    if (code) return String(code);
    return 'h:' + crypto.createHash('sha1').update(text || '').digest('hex');
}

// DeepSeek 翻译 system prompt（术语表原样保留）
const SYSTEM_PROMPT = `你是一个专业的日文卡牌游戏效果翻译专家。请将输入的日文卡牌效果文本，翻译成准确、通顺、符合卡牌游戏术语习惯的中文。

翻译要求：
1. 保持卡牌游戏术语的准确性，以下术语必须按指定方式翻译：
   ｽﾃｯﾌﾟ → 移动
   ｻｲﾄﾞｽﾃｯﾌﾟ → 横向侧移
   ｵｰﾀﾞｰｽﾃｯﾌﾟ → 纵向移动
   ｵｰﾀﾞｰﾁｪﾝｼﾞ → 位置交换
   ｼﾞｬﾝﾌﾟ → 跳跃
   ﾍﾟﾅﾙﾃｨ → 离场惩罚
   ｱｸﾞﾚｯｼﾌﾞ → 进取心
   ｱｼｽﾄ → 辅助
   ｴﾝｹﾞｰｼﾞ → 结合
   ﾘｶﾊﾞﾘｰ → 补正
   ｶﾞｯﾂ → 斗志
   ﾘｰﾀﾞｰ → 领导
   ｻﾎﾟｰﾀｰ → 支援者
   ﾎﾞｰﾅｽ → 奖励
   ﾀｰﾝﾘｶﾊﾞﾘｰ → 回合补正
   ﾌﾟﾘﾝｼﾊﾟﾙ → 主演
   ｻﾌﾟﾗｲｽﾞ → 突袭

2. 保留原文的格式符号（如：[宣言]、[诱发]、[COST]、[切札]等）
3. 保持原文的分隔符（|）结构，不要改变其位置
4. 除了卡牌效果和能力之外涉及到的其他专有名称（如角色名、作品名、技能名等）保持原文不翻译`;

// 翻译单条文本（长文本分段 → 串行调 DeepSeek → 合并）。失败抛错，由调用方降级。
async function translateText(text, apiKey) {
    const maxChunkSize = 1500; // 字符数，DeepSeek 上下文限制
    const textChunks = [];
    if (text.length > maxChunkSize) {
        const sentences = text.split(/(?<=[。|！？\n])/);
        let currentChunk = '';
        for (const sentence of sentences) {
            if ((currentChunk + sentence).length > maxChunkSize) {
                if (currentChunk) textChunks.push(currentChunk);
                currentChunk = sentence;
            } else {
                currentChunk += sentence;
            }
        }
        if (currentChunk) textChunks.push(currentChunk);
    } else {
        textChunks.push(text);
    }

    const translatedChunks = [];
    for (let i = 0; i < textChunks.length; i++) {
        const chunk = textChunks[i];
        const isLast = (i === textChunks.length - 1);
        const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model: 'deepseek-v4-flash',
                messages: [
                    { role: 'system', content: SYSTEM_PROMPT },
                    { role: 'user', content: chunk }
                ],
                temperature: 0.3,
                max_tokens: 1500
            })
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            console.error('DeepSeek API error:', errorData);
            // 非最后一段失败：保留原文分段，继续（尽量少丢内容）
            if (!isLast) { translatedChunks.push(chunk); continue; }
            throw new Error('Translation service error: ' + JSON.stringify(errorData));
        }

        const data = await response.json();
        const translatedText = data.choices[0].message.content.trim();
        translatedChunks.push(translatedText);
        if (!isLast) await new Promise(resolve => setTimeout(resolve, 200));
    }

    return translatedChunks.join('').replace(/\n{3,}/g, '\n\n').trim();
}

export default async function handler(req, res) {
    // 0. CORS：开发时前端（file:// 或 Live Server）与本地 API 不同源，必须放行预检。
    res.setHeader('Access-Control-Allow-Origin', '*'); // 生产可收紧为具体域名
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') {
        return res.status(204).end();
    }

    // 1. 只允许 POST
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    // 2. 密钥
    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey) {
        console.error('DEEPSEEK_API_KEY not set');
        return res.status(500).json({ error: 'Server configuration error' });
    }

    // 3. 解析输入：批量 { items:[{id,code,text}] }，或兼容旧单条 { text }
    const body = req.body || {};
    const singleMode = !Array.isArray(body.items);
    if (singleMode && !body.text) {
        return res.status(400).json({ error: 'Missing text to translate' });
    }
    const items = singleMode
        ? [{ id: '_single', code: body.code || '', text: body.text || '' }]
        : body.items;
    if (items.length === 0) {
        return res.status(200).json({ translations: {} });
    }

    // 4. 查库：命中直接用，未命中收集待翻译
    const db = loadCache();
    const translations = {};   // id -> 译文
    const toTranslate = [];    // { id, key, text }
    for (const it of items) {
        const text = it.text || '';
        if (!text) { translations[it.id] = ''; continue; }
        const key = cacheKey(it.code, text);
        const hit = db.get(key);
        if (hit && hit.src === text) {
            translations[it.id] = hit.zh;              // 命中库 → 0 token
        } else {
            toTranslate.push({ id: it.id, key, text }); // 未命中/原文已变 → 待翻译
        }
    }

    // 5. 只翻未命中项（小并发）；单卡失败降级原文且不入库，不影响其他卡
    let dbChanged = false;
    const CONCURRENCY = 4;
    for (let i = 0; i < toTranslate.length; i += CONCURRENCY) {
        const batch = toTranslate.slice(i, i + CONCURRENCY);
        const results = await Promise.all(batch.map(async (t) => {
            try {
                const zh = await translateText(t.text, apiKey);
                return { ...t, zh, ok: true };
            } catch (e) {
                console.error(`[翻译] 失败(id=${t.id})：`, e.message);
                return { ...t, zh: t.text, ok: false };
            }
        }));
        for (const r of results) {
            translations[r.id] = r.zh;
            if (r.ok) {
                db.set(r.key, { zh: r.zh, src: r.text, ts: Date.now() });
                dbChanged = true;
            }
        }
    }

    if (dbChanged) persistCache(); // 异步落盘，不阻塞响应

    // 6. 响应：批量返回 translations；单条模式兼容旧返回 { translatedText }
    if (singleMode) {
        return res.status(200).json({ translatedText: translations['_single'] || body.text });
    }
    console.log(`[翻译] 请求 ${items.length} 张，命中库 ${items.length - toTranslate.length} 张，新翻译 ${toTranslate.length} 张`);
    return res.status(200).json({ translations });
}
