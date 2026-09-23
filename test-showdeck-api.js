import axios from 'axios';
import https from 'https';

const httpsAgent = new https.Agent({ rejectUnauthorized: false });

// 使用真实卡组ID
axios.get('https://www.moetcg.club/Api/showDeck?id=99f0c3ec2da13d6904e80cfe31a66189', {
    headers: {
        'Referer': 'https://www.moetcg.club/Card-Search/?kid=9',
        'User-Agent': 'Mozilla/5.0'
    },
    httpsAgent
}).then(response => {
    console.log('showDeck API 返回的所有卡片:');
    console.log('─'.repeat(60));
    const cards = response.data.data;

    // 找到 LO-6420-K
    const target = cards.find(c => c.code === 'LO-6420-K');

    if (target) {
        console.log('\n找到 LO-6420-K:');
        console.log('code:', target.code);
        console.log('name:', target.name);
        console.log('effect:');
        console.log(target.effect);
    } else {
        console.log('\n未找到 LO-6420-K，显示第一张卡片:');
        const firstCard = cards[0];
        for (const [key, value] of Object.entries(firstCard)) {
            if (typeof value === 'string' && value.length > 100) {
                console.log(`${key}: ${value.substring(0, 100)}...`);
            } else {
                console.log(`${key}: ${value}`);
            }
        }
        console.log('\neffect 字段完整内容:');
        console.log(firstCard.effect);
    }
}).catch(e => console.error('错误:', e.message));
