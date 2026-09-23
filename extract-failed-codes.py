import re

with open('C:/Users/35057/Desktop/失败.md', 'r', encoding='utf-8') as f:
    content = f.read()

# 提取所有 LO- 开头的卡牌编号
codes = re.findall(r'LO-[0-9A-Z-]+', content)
unique_codes = sorted(set(codes))

print(f"找到 {len(unique_codes)} 张失败的卡牌\n")
print("前20张:")
for code in unique_codes[:20]:
    print(code)

# 保存到文件
with open('failed-cards.txt', 'w', encoding='utf-8') as f:
    for code in unique_codes:
        f.write(code + '\n')

print(f"\n✅ 已保存到 failed-cards.txt")
