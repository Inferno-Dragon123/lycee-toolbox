import axios from 'axios';
import https from 'https';

const httpsAgent = new https.Agent({ rejectUnauthorized: false });

async function checkTotalCards() {
    console.log('检查萌卡社 Lycee 卡牌总数...\n');

    let page = 1;
    let totalCards = 0;
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
                console.log(`第 ${page} 页: 0 张 (连续空页: ${emptyPages})`);

                // 连续3页为空，认为已经到底
                if (emptyPages >= 3) {
                    console.log('\n✅ 已到达最后一页');
                    break;
                }
            } else {
                emptyPages = 0;
                totalCards += data.length;
                console.log(`第 ${page} 页: ${data.length} 张 (累计: ${totalCards})`);
            }

            page++;
            await new Promise(resolve => setTimeout(resolve, 500));

        } catch (error) {
            console.error(`第 ${page} 页失败:`, error.message);
            break;
        }
    }

    console.log(`\n📊 总计: ${totalCards} 张卡片`);
    console.log(`📄 总页数: ${page - emptyPages} 页`);
}

checkTotalCards();
