import axios from 'axios';
import https from 'https';

const httpsAgent = new https.Agent({ rejectUnauthorized: false });

axios.get('https://www.moetcg.club/Api/search?kid=9&code=LO-6420-K', {
    headers: {
        'Referer': 'https://www.moetcg.club/Card-Search/?kid=9',
        'User-Agent': 'Mozilla/5.0'
    },
    httpsAgent
}).then(response => {
    console.log('萌卡社 API 返回的所有字段:');
    const card = response.data.data[0];
    for (const [key, value] of Object.entries(card)) {
        console.log(`${key}: ${typeof value === 'string' ? value.substring(0, 100) : value}`);
    }
}).catch(e => console.error(e.message));
