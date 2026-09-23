import axios from 'axios';
import https from 'https';
import fs from 'fs';

const httpsAgent = new https.Agent({ rejectUnauthorized: false });
const OUTPUT_FILE = 'lycee-japanese-database.json';
const PROGRESS_FILE = 'crawl-progress.json';

// 从 lycee-tcg.com 爬取单张卡片的日文原文
async function fetchJapaneseText(code) {
    try {
        const url = `https://lycee-tcg.com/card/card_detail.pl?cardno=${code}`;
        const response = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            },
            timeout: 45000  // 增加到45秒，lycee-tcg.com服务器响应很慢
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

// 加载已有进度
function loadProgress() {
    if (fs.existsSync(PROGRESS_FILE)) {
        const data = JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf-8'));
        console.log(`📂 找到已有进度: 已完成 ${data.completed.length} 张，失败 ${data.failed.length} 张\n`);
        return data;
    }
    return { completed: [], failed: [], results: [] };
}

// 保存进度
function saveProgress(progress) {
    fs.writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2), 'utf-8');
}

// 保存最终结果
function saveFinalResults(results) {
    const data = {
        generatedAt: new Date().toISOString(),
        totalCards: results.length,
        cards: results
    };
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(data, null, 2), 'utf-8');
    console.log(`\n✅ 已保存到: ${OUTPUT_FILE}`);
}

// 获取所有卡牌列表
async function getAllCards() {
    console.log('📋 获取所有卡牌列表...');

    const cards = [];
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
                console.log(`  第 ${page} 页: 0 张 (连续空页: ${emptyPages})`);

                // 连续3页为空，认为已到底
                if (emptyPages >= 3) {
                    console.log(`  ✅ 已到达最后一页`);
                    break;
                }
            } else {
                emptyPages = 0;

                for (const card of data) {
                    if (card.code && card.cid) {
                        cards.push({ code: card.code, cid: card.cid, name: card.name || '' });
                    }
                }

                console.log(`  ✅ 第 ${page} 页: 获取 ${data.length} 张卡片`);
            }

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
    console.log('Lycee 日文原文数据库 - 分批爬取工具（可断点续传）');
    console.log('='.repeat(60));
    console.log();

    // 加载进度
    const progress = loadProgress();
    const completedCodes = new Set(progress.completed);
    const failedCodes = new Set(progress.failed);

    // 获取卡牌列表
    const allCards = await getAllCards();

    if (allCards.length === 0) {
        console.log('❌ 未获取到卡牌列表');
        return;
    }

    // 过滤已完成的卡片
    const remainingCards = allCards.filter(c => !completedCodes.has(c.code) && !failedCodes.has(c.code));

    console.log(`🕷️  开始爬取日文原文...`);
    console.log(`   总计: ${allCards.length} 张`);
    console.log(`   已完成: ${progress.completed.length} 张`);
    console.log(`   待爬取: ${remainingCards.length} 张\n`);

    let successCount = 0;
    let failCount = 0;
    const startCompleted = progress.completed.length;  // 记录开始时已完成的数量

    for (let i = 0; i < remainingCards.length; i++) {
        const card = remainingCards[i];
        const totalProgress = startCompleted + i + 1;  // 用开始时的数量，不会重复计算
        const percent = ((totalProgress / allCards.length) * 100).toFixed(1);

        process.stdout.write(`[${totalProgress}/${allCards.length}] (${percent}%) ${card.code} ... `);

        const japaneseText = await fetchJapaneseText(card.code);

        if (japaneseText) {
            const result = { code: card.code, cid: card.cid, name: card.name, japaneseText };
            progress.results.push(result);
            progress.completed.push(card.code);
            successCount++;
            console.log('✅');
        } else {
            progress.failed.push(card.code);
            failCount++;
            console.log('❌');
        }

        // 每10张保存一次进度
        if ((i + 1) % 10 === 0) {
            saveProgress(progress);
            await new Promise(resolve => setTimeout(resolve, 5000));  // 增加到5秒，让服务器休息
        } else {
            await new Promise(resolve => setTimeout(resolve, 1000));  // 增加到1秒
        }
    }

    console.log(`\n✅ 本次成功: ${successCount} 张`);
    console.log(`❌ 本次失败: ${failCount} 张`);
    console.log(`📊 累计完成: ${progress.completed.length}/${allCards.length} 张`);

    // 保存最终结果
    saveFinalResults(progress.results);

    // 删除进度文件
    if (fs.existsSync(PROGRESS_FILE)) {
        fs.unlinkSync(PROGRESS_FILE);
        console.log('🗑️  已删除进度文件');
    }

    console.log('\n' + '='.repeat(60));
    console.log('✅ 爬取完成！');
    console.log('='.repeat(60));
}

main().catch(err => console.error('错误:', err.message));
