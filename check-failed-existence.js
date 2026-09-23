import axios from 'axios';
import https from 'https';
import fs from 'fs';

const httpsAgent = new https.Agent({ rejectUnauthorized: false });

async function getAllCardsFromMoetcg() {
    console.log('📋 从萌卡社重新获取所有卡牌列表...\n');

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

    console.log(`\n📊 总计: ${allCards.length} 张\n`);
    return allCards;
}

async function main() {
    // 获取所有卡牌
    const allCards = await getAllCardsFromMoetcg();
    const allCodesMap = new Map(allCards.map(c => [c.code, c]));

    // 读取失败列表
    const failedCodes = fs.readFileSync('failed-cards.txt', 'utf-8')
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0);

    console.log('检查失败的卡牌是否存在于萌卡社:\n');

    const existsCards = [];
    const notExists = [];

    for (const code of failedCodes) {
        if (allCodesMap.has(code)) {
            existsCards.push(allCodesMap.get(code));
        } else {
            notExists.push(code);
        }
    }

    console.log(`✅ 存在于萌卡社: ${existsCards.length} 张`);
    console.log(`❌ 不存在于萌卡社: ${notExists.length} 张`);

    if (existsCards.length > 0) {
        // 保存存在的卡牌信息
        fs.writeFileSync('failed-cards-info.json', JSON.stringify(existsCards, null, 2), 'utf-8');
        console.log('\n✅ 已保存到 failed-cards-info.json');

        console.log('\n存在于萌卡社的失败卡牌（前10张）:');
        existsCards.slice(0, 10).forEach(card => console.log(`  ${card.code} - ${card.name}`));
    }
}

main().catch(err => console.error('错误:', err.message));
