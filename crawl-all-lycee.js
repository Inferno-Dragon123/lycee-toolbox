import axios from 'axios';
import https from 'https';
import fs from 'fs';
import { Redis } from '@upstash/redis';

const httpsAgent = new https.Agent({ rejectUnauthorized: false });

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
        console.error(`  ❌ ${code}: ${error.message}`);
        return null;
    }
}

// 步骤1: 从萌卡社获取所有 LO 系列卡牌列表
async function getAllCards() {
    console.log('📋 步骤1: 获取所有卡牌列表...');

    const cards = [];
    let page = 1;
    const maxPages = 100; // 防止无限循环

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
                console.log(`  ✅ 第 ${page} 页无数据，结束`);
                break;
            }

            for (const card of data) {
                if (card.code && card.cid) {
                    cards.push({ code: card.code, cid: card.cid, name: card.name || '' });
                }
            }

            console.log(`  ✅ 第 ${page} 页: 获取 ${data.length} 张卡片`);
            page++;

            // 避免请求过快
            await new Promise(resolve => setTimeout(resolve, 500));

        } catch (error) {
            console.error(`  ❌ 第 ${page} 页失败:`, error.message);
            break;
        }
    }

    console.log(`\n📊 总计获取 ${cards.length} 张卡片\n`);
    return cards;
}

// 步骤2: 批量爬取日文原文
async function crawlAllJapanese(cards) {
    console.log('🕷️  步骤2: 开始爬取日文原文...\n');

    const results = [];
    const failed = [];
    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < cards.length; i++) {
        const card = cards[i];
        const progress = `[${i + 1}/${cards.length}]`;

        process.stdout.write(`${progress} ${card.code} ... `);

        const japaneseText = await fetchJapaneseText(card.code);

        if (japaneseText) {
            results.push({ ...card, japaneseText });
            successCount++;
            console.log('✅');
        } else {
            failed.push(card.code);
            failCount++;
            console.log('❌');
        }

        // 每10张卡片暂停一下，避免请求过快
        if ((i + 1) % 10 === 0) {
            await new Promise(resolve => setTimeout(resolve, 2000));
        } else {
            await new Promise(resolve => setTimeout(resolve, 500));
        }
    }

    console.log(`\n✅ 成功: ${successCount} 张`);
    console.log(`❌ 失败: ${failCount} 张`);

    if (failed.length > 0) {
        console.log(`\n失败的卡牌: ${failed.join(', ')}`);
    }

    return { results, failed };
}

// 步骤3: 保存到 JSON 文件
function saveToFile(results) {
    console.log('\n💾 步骤3: 保存到文件...');

    const outputPath = 'lycee-japanese-database.json';
    const data = {
        generatedAt: new Date().toISOString(),
        totalCards: results.length,
        cards: results
    };

    fs.writeFileSync(outputPath, JSON.stringify(data, null, 2), 'utf-8');
    console.log(`✅ 已保存到: ${outputPath}`);
}

// 主程序
async function main() {
    console.log('='.repeat(60));
    console.log('Lycee 日文原文数据库 - 全面爬取工具');
    console.log('='.repeat(60));
    console.log();

    const cards = await getAllCards();

    if (cards.length === 0) {
        console.log('❌ 未获取到卡牌列表');
        return;
    }

    const { results, failed } = await crawlAllJapanese(cards);

    saveToFile(results);

    console.log('\n' + '='.repeat(60));
    console.log('✅ 爬取完成！');
    console.log('='.repeat(60));
}

main();
