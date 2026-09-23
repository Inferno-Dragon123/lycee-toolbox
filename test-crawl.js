import axios from 'axios';
import https from 'https';
import fs from 'fs';

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
        return null;
    }
}

// 测试爬取前10张卡片
async function testCrawl() {
    console.log('='.repeat(60));
    console.log('Lycee 爬虫测试 - 前10张卡片');
    console.log('='.repeat(60));
    console.log();

    console.log('📋 获取卡牌列表...');

    const response = await axios.get('https://www.moetcg.club/Api/search?kid=9&page=1&pageSize=10', {
        headers: {
            'Referer': 'https://www.moetcg.club/Card-Search/?kid=9',
            'User-Agent': 'Mozilla/5.0'
        },
        httpsAgent
    });

    const cards = response.data.data || [];
    console.log(`✅ 获取 ${cards.length} 张卡片\n`);

    console.log('🕷️  开始爬取日文原文...\n');

    const results = [];
    let successCount = 0;

    for (let i = 0; i < cards.length; i++) {
        const card = cards[i];
        process.stdout.write(`[${i + 1}/${cards.length}] ${card.code} ... `);

        const japaneseText = await fetchJapaneseText(card.code);

        if (japaneseText) {
            results.push({
                code: card.code,
                cid: card.cid,
                name: card.name,
                japaneseText
            });
            successCount++;
            console.log('✅');
        } else {
            console.log('❌');
        }

        await new Promise(resolve => setTimeout(resolve, 1000));
    }

    console.log(`\n✅ 成功: ${successCount}/${cards.length} 张\n`);

    // 显示第一张卡片的结果
    if (results.length > 0) {
        console.log('示例结果 (第一张卡片):');
        console.log('─'.repeat(60));
        console.log(`代码: ${results[0].code}`);
        console.log(`卡名: ${results[0].name}`);
        console.log(`日文原文:\n${results[0].japaneseText}`);
        console.log('─'.repeat(60));
    }

    console.log('\n✅ 测试完成！如果结果正确，可以运行完整爬取脚本');
}

testCrawl().catch(err => console.error('错误:', err.message));
