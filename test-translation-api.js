// 测试翻译API是否使用日文原文
import axios from 'axios';

async function testTranslation() {
  const testCard = {
    code: 'LO-6665',
    text: '这是萌卡社的劣质中文'
  };

  console.log('测试卡牌翻译...\n');
  console.log('卡牌编号:', testCard.code);
  console.log('传入文本:', testCard.text);
  console.log();

  const response = await axios.post('http://localhost:3000/api/translate', {
    code: testCard.code,
    text: testCard.text
  });

  console.log('翻译结果:');
  console.log(response.data.translatedText);
}

testTranslation().catch(err => console.error('错误:', err.message));
