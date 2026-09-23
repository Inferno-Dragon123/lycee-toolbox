import axios from 'axios';
import https from 'https';

const httpsAgent = new https.Agent({ rejectUnauthorized: false });

// 测试 LO-6420-K 的 cid (99823)
axios.get('https://api-comment.moetcg.club/comment?path=%2FcardBuilder%2Fdetail%2Fcid%2F99823.html&pageSize=10&page=1&lang=zh-CN&sortBy=insertedAt_desc', {
    headers: {
        'Referer': 'https://www.moetcg.club/',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36 Edg/150.0.0.0'
    },
    httpsAgent
}).then(response => {
    console.log('comment API 返回结构:');
    console.log(JSON.stringify(response.data, null, 2));
}).catch(e => console.error('错误:', e.message));
