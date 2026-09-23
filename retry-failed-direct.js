import axios from 'axios';
import https from 'https';
import fs from 'fs';

const httpsAgent = new https.Agent({ rejectUnauthorized: false });
const DATABASE_FILE = 'lycee-japanese-database.json';
const FAILED_CARDS_FILE = 'failed-cards.txt';
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

// 从萌卡社获取卡牌的 cid 和 name
async function getCardInfo(code) {
    try {
        const url = `https://www.moetcg.club/Api/search?kid=9&cardno=${code}`;
        const response = await axios.get(url, {
            headers: {
                'Referer': 'https://www.moetcg.club/Card-Search/?kid=9',
                'User-Agent': 'Mozilla/5.0'
            },
            httpsAgent,
            timeout: 10000
        });

        const data = response.data.data || [];
        if (data.length > 0 && data[0].code === code) {
            return { cid: data[0].cid, name: data[0].name || '' };
        }
        return null;

    } catch (error) {
        return null;
    }
}

// 主程序
async function main() {
    console.log('='.repeat(60));
    console.log('Lycee 失败卡片定向爬取工具');
    console.log('='.repeat(60));
    console.log();

    // 读取已有数据库
    const database = JSON.parse(fs.readFileSync(DATABASE_FILE, 'utf-8'));
    const existingCardsMap = new Map();
    database.cards.forEach(card => {
        existingCardsMap.set(card.code, { cid: card.cid, name: card.name });
    });

    // 读取失败卡牌列表
    const failedCodes = fs.readFileSync(FAILED_CARDS_FILE, 'utf-8')
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0);

    console.log(`📋 需要爬取 ${failedCodes.length} 张失败的卡牌\n`);

    let successCount = 0;
    let failCount = 0;
    const newResults = [];

    for (let i = 0; i < failedCodes.length; i++) {
        const code = failedCodes[i];
        const progress = i + 1;
        const percent = ((progress / failedCodes.length) * 100).toFixed(1);

        process.stdout.write(`[${progress}/${failedCodes.length}] (${percent}%) ${code} ... `);

        // 从已有数据库获取卡牌信息
        const cardInfo = existingCardsMap.get(code);
        if (!cardInfo) {
            console.log('❌ (数据库中无此卡牌)');
            failCount++;
            continue;
        }

        // 爬取日文原文
        const japaneseText = await fetchJapaneseText(code);

        if (japaneseText) {
            newResults.push({
                code: code,
                cid: cardInfo.cid,
                name: cardInfo.name,
                japaneseText
            });
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
