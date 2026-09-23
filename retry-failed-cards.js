import axios from 'axios';
import https from 'https';
import fs from 'fs';

const httpsAgent = new https.Agent({ rejectUnauthorized: false });
const DATABASE_FILE = 'lycee-japanese-database.json';
const OUTPUT_FILE = 'lycee-japanese-database-complete.json';

// 从 lycee-tcg.com 爬取单张卡片的日文原文
async function fetchJapaneseText(code) {
    try {
        const url = `https://lycee-tcg.com/card/card_detail.pl?cardno=${code}`;
        const response = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            },
            timeout: 45000  // 45秒超时
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

// 获取所有失败的卡牌（从萌卡社获取完整列表，找出未在数据库中的卡片）
async function getFailedCards() {
    console.log('📋 获取所有卡牌列表...');

    // 读取已有数据库
    const database = JSON.parse(fs.readFileSync(DATABASE_FILE, 'utf-8'));
    const successCodes = new Set(database.cards.map(c => c.code));

    // 从萌卡社获取完整列表
    const allCards = [];
    let page = 1;
    let emptyPages = 0;

    while (true) {
        try {
            const url = `https://www.moetcg.club/Api/search?kid=9&page=${page}&pageSize=30`;
            const response = await axios.get(url, {
                headers: {
                    'Referer': 'https://www.moetcg.club/Card-Search/?kid=9',
                    'User-Agent': 'Mozilla/5.0'
                },
                httpsAgent,
                timeout: 10000
            });

            const data = response.data.data || [];

            if (data.length === 0) {
                emptyPages++;
                if (emptyPages >= 3) {
                    break;
                }
            } else {
                emptyPages = 0;
                for (const card of data) {
                    if (card.code && card.cid) {
                        allCards.push({ code: card.code, cid: card.cid, name: card.name || '' });
                    }
                }
                console.log(`  第 ${page} 页: ${data.length} 张`);
            }

            page++;
            await new Promise(resolve => setTimeout(resolve, 500));

        } catch (error) {
            console.error(`  ❌ 第 ${page} 页失败:`, error.message);
            break;
        }
    }

    // 找出失败的卡片
    const failedCards = allCards.filter(c => !successCodes.has(c.code));
    console.log(`\n📊 总卡片: ${allCards.length} 张`);
    console.log(`📊 已成功: ${successCodes.size} 张`);
    console.log(`📊 失败的: ${failedCards.length} 张\n`);

    return failedCards;
}

// 主程序
async function main() {
    console.log('='.repeat(60));
    console.log('Lycee 失败卡片二次爬取工具');
    console.log('='.repeat(60));
    console.log();

    // 获取失败的卡片列表
    const failedCards = await getFailedCards();

    if (failedCards.length === 0) {
        console.log('✅ 没有失败的卡片！');
        return;
    }

    console.log(`🕷️  开始二次爬取 ${failedCards.length} 张失败的卡片...\n`);

    let successCount = 0;
    let failCount = 0;
    const newResults = [];

    for (let i = 0; i < failedCards.length; i++) {
        const card = failedCards[i];
        const progress = i + 1;
        const percent = ((progress / failedCards.length) * 100).toFixed(1);

        process.stdout.write(`[${progress}/${failedCards.length}] (${percent}%) ${card.code} ... `);

        const japaneseText = await fetchJapaneseText(card.code);

        if (japaneseText) {
            newResults.push({ code: card.code, cid: card.cid, name: card.name, japaneseText });
            successCount++;
            console.log('✅');
        } else {
            failCount++;
            console.log('❌');
        }

        // 每10张休息5秒
        if ((i + 1) % 10 === 0) {
            await new Promise(resolve => setTimeout(resolve, 5000));
        } else {
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
    }

    console.log(`\n✅ 二次爬取成功: ${successCount} 张`);
    console.log(`❌ 二次爬取失败: ${failCount} 张`);

    // 合并到原数据库
    if (newResults.length > 0) {
        const database = JSON.parse(fs.readFileSync(DATABASE_FILE, 'utf-8'));
        database.cards.push(...newResults);
        database.totalCards = database.cards.length;
        database.generatedAt = new Date().toISOString();

        fs.writeFileSync(OUTPUT_FILE, JSON.stringify(database, null, 2), 'utf-8');
        console.log(`\n✅ 已合并并保存到: ${OUTPUT_FILE}`);
        console.log(`📊 最终总计: ${database.totalCards} 张`);
    }

    console.log('\n' + '='.repeat(60));
    console.log('✅ 二次爬取完成！');
    console.log('='.repeat(60));
}

main().catch(err => console.error('错误:', err.message));
