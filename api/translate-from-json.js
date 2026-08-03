// api/translate-from-json.js - 直接从预翻译的JSON读取中文
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 加载预翻译的数据库（启动时加载一次）
let translationDB = null;
function loadTranslationDB() {
    if (!translationDB) {
        const dbPath = path.join(process.cwd(), 'lycee-chinese-database-final.json');
        const data = JSON.parse(fs.readFileSync(dbPath, 'utf-8'));

        // 构建 code -> chineseText 的映射
        translationDB = new Map();
        for (const card of data.cards) {
            if (card.code && card.japaneseText) {
                translationDB.set(card.code, card.japaneseText); // 注意：这里japaneseText实际是中文翻译
            }
        }
        console.log(`[翻译数据库] 已加载 ${translationDB.size} 张卡牌的翻译`);
    }
    return translationDB;
}

export default async function handler(req, res) {
    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') {
        return res.status(204).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const db = loadTranslationDB();

        // 解析输入：批量 { items:[{id,code,text}] }，或兼容旧单条 { text, code }
        const body = req.body || {};
        const singleMode = !Array.isArray(body.items);

        if (singleMode && !body.text && !body.code) {
            return res.status(400).json({ error: 'Missing text or code' });
        }

        const items = singleMode
            ? [{ id: '_single', code: body.code || '', text: body.text || '' }]
            : body.items;

        if (items.length === 0) {
            return res.status(200).json({ translations: {} });
        }

        // 从数据库查找翻译
        const translations = {};
        let hitCount = 0;
        let missCount = 0;

        for (const it of items) {
            if (it.code && db.has(it.code)) {
                // 命中：使用预翻译的中文
                translations[it.id] = db.get(it.code);
                hitCount++;
            } else {
                // 未命中：使用原文
                translations[it.id] = it.text || '';
                missCount++;
            }
        }

        console.log(`[翻译] 请求 ${items.length} 张，命中 ${hitCount} 张，未命中 ${missCount} 张`);

        // 响应
        if (singleMode) {
            return res.status(200).json({ translatedText: translations['_single'] || body.text });
        }
        return res.status(200).json({ translations });

    } catch (error) {
        console.error('[翻译] 错误:', error.message);
        return res.status(500).json({ error: 'Translation failed', details: error.message });
    }
}
