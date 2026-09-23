import axios from 'axios';
import https from 'https';
import fs from 'fs';

const httpsAgent = new https.Agent({ rejectUnauthorized: false });
const DATABASE_FILE = 'lycee-japanese-database.json';

// 从 lycee-tcg.com 爬取单张卡片的日文原文
async function fetchJapaneseText(code) {
    try {
        const url = `https://lycee-tcg.com/card/card_detail.pl?cardno=${code}`;
        const response = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            },
            timeout: 15000
        });

        const html = response.data;
        const match = html.match(/<td colspan="10" height="[^"]*"[^>]*>([\s\S]*?)<\/td>/i);

        if (!match) {
            return null;
        }

        const effectHtml = match[1];
        const japaneseText = effectHtml
            .replace(/<br\s*\/?>/gi, '\n')
            .replace(/<DIV[\s\S]*?<\/DIV>/gi, '')
            .replace(/<[^>]+>/g, '')
            .replace(/\[このカードを使用したデッキを検索する\]/g, '')
            .replace(/\s+\n/g, '\n')
            .replace(/\n{3,}/g, '\n\n')
            .trim();

        return japaneseText;

    } catch (error) {
        return null;
    }
}

// 加载现有数据库
function loadDatabase() {
    if (fs.existsSync(DATABASE_FILE)) {
        const data = JSON.parse(fs.readFileSync(DATABASE_FILE, 'utf-8'));
        console.log(`📂 加载现有数据库: ${data.cards.length} 张卡片`);
        return data;
    }
    console.log('📂 未找到现有数据库，将创建新数据库');
    return { generatedAt: null, totalCards: 0, cards: [] };
}

// 获取所有卡牌列表
async function getAllCards() {
    console.log('📋 获取最新卡牌列表...');

    const cards = [];
    let page = 1;
    const maxPages = 100;

    while (page <= maxPages) {
        try {
            const url = `https://www.moetcg.club/Api/search?kid=9&page=${page}&pageSize=100`;
            const response = await axios.get(url, {
                headers: {
                    'Referer': 'https://www.moetcg.club/Card-Search/?kid=9',
                    'User-Agent': 'Mozilla/5.0'
                },
                httpsAgent
            });

            const data = response.data.data || [];

            if (data.length === 0) {
                break;
            }

            for (const card of data) {
                if (card.code && card.cid) {
                    cards.push({ code: card.code, cid: card.cid, name: card.name || '' });
                }
            }

            console.log(`  ✅ 第 ${page} 页: ${data.length} 张`);
            page++;

            await new Promise(resolve => setTimeout(resolve, 500));

        } catch (error) {
            console.error(`  ❌ 第 ${page} 页失败:`, error.message);
            break;
        }
    }

    console.log(`\n📊 总计获取 ${cards.length} 张卡片\n`);
    return cards;
}

// 主程序
async function main() {
    console.log('='.repeat(60));
    console.log('Lycee 日文原文数据库 - 增量更新工具');
    console.log('='.repeat(60));
    console.log();

    // 加载现有数据库
    const database = loadDatabase();
    const existingCodes = new Set(database.cards.map(c => c.code));

    // 获取最新卡牌列表
    const allCards = await getAllCards();

    // 找出新卡
    const newCards = allCards.filter(c => !existingCodes.has(c.code));

    if (newCards.length === 0) {
        console.log('✅ 没有新卡片需要更新');
        return;
    }

    console.log(`🆕 发现 ${newCards.length} 张新卡片\n`);
    console.log('🕷️  开始爬取新卡片...\n');

    let successCount = 0;
    const newResults = [];

    for (let i = 0; i < newCards.length; i++) {
        const card = newCards[i];
        process.stdout.write(`[${i + 1}/${newCards.length}] ${card.code} ... `);

        const japaneseText = await fetchJapaneseText(card.code);

        if (japaneseText) {
            newResults.push({ code: card.code, cid: card.cid, name: card.name, japaneseText });
            successCount++;
            console.log('✅');
        } else {
            console.log('❌');
        }

        await new Promise(resolve => setTimeout(resolve, 500));
    }

    console.log(`\n✅ 新增成功: ${successCount}/${newCards.length} 张`);

    // 合并到数据库
    database.cards.push(...newResults);
    database.totalCards = database.cards.length;
    database.updatedAt = new Date().toISOString();
    if (!database.generatedAt) {
        database.generatedAt = database.updatedAt;
    }

    // 保存
    fs.writeFileSync(DATABASE_FILE, JSON.stringify(database, null, 2), 'utf-8');
    console.log(`\n✅ 已更新数据库: ${DATABASE_FILE}`);
    console.log(`📊 当前总计: ${database.cards.length} 张卡片`);

    console.log('\n' + '='.repeat(60));
    console.log('✅ 增量更新完成！');
    console.log('='.repeat(60));
}

main().catch(err => console.error('错误:', err.message));
