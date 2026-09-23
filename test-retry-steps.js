import axios from 'axios';
import https from 'https';
import fs from 'fs';

const httpsAgent = new https.Agent({ rejectUnauthorized: false });

console.log('测试1: 读取数据库文件...');
const database = JSON.parse(fs.readFileSync('lycee-japanese-database.json', 'utf-8'));
console.log(`✅ 数据库有 ${database.totalCards} 张卡片`);
console.log(`✅ 第一张: ${database.cards[0].code}`);

console.log('\n测试2: 获取萌卡社第1页...');
const url = `https://www.moetcg.club/Api/search?kid=9&page=1&pageSize=30`;
const response = await axios.get(url, {
    headers: {
        'Referer': 'https://www.moetcg.club/Card-Search/?kid=9',
        'User-Agent': 'Mozilla/5.0'
    },
    httpsAgent,
    timeout: 10000
});

console.log(`✅ 第1页返回 ${response.data.data.length} 张卡片`);
console.log(`✅ 第一张: ${response.data.data[0].code}`);

console.log('\n✅ 所有测试通过！');
