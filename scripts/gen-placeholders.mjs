// Generates original, license-free (CC0) SVG placeholders for each category. Run: node scripts/gen-placeholders.mjs
import fs from 'node:fs';
const cats = {
  rice:'#d9b26f',cooking_oil:'#e0b93f',sugar:'#cfd8dc',flour:'#d7ccc8',pasta:'#e6c07b',lentils:'#c4733b',milk:'#90caf9',eggs:'#e8d3a8',yogurt:'#b3e5fc',cheese:'#f0c851',bread:'#c8965a',cereal:'#e6b35c',
  chicken:'#e58f73',minced_meat:'#b5543f',fish:'#6fb3c9',tuna:'#5b8fb0',bananas:'#f2d03b',apples:'#d9534f',tomatoes:'#e0503c',onions:'#c28fb5',potatoes:'#b89b6a',cucumbers:'#6fae5b',
  water:'#64b5f6',juice:'#f59e42',tea:'#8d6e4a',dish_soap:'#7ad0c8',laundry:'#7aa6e0',floor_cleaner:'#8fcf8f',garbage_bags:'#8d99a6',handwash:'#9ad0e8',shampoo:'#b79be0',toothpaste:'#7fd1d9',tissues:'#cfe3ee',
  diapers:'#f4b6c2',baby_formula:'#f7d6a0',baby_wipes:'#f2c8d8',snacks:'#e6844c',biscuits:'#d8a46a',
};
fs.mkdirSync('web/public/img/cat', { recursive: true });
for (const [k, color] of Object.entries(cats)) {
  const label = k.replace(/_/g, ' ');
  fs.writeFileSync(`web/public/img/cat/${k}.svg`, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 160" role="img" aria-label="${label}"><rect width="160" height="160" rx="24" fill="${color}"/><circle cx="80" cy="66" r="30" fill="#ffffff" fill-opacity=".55"/><rect x="38" y="104" width="84" height="10" rx="5" fill="#ffffff" fill-opacity=".7"/><text x="80" y="140" font-family="sans-serif" font-size="13" text-anchor="middle" fill="#00000099">${label}</text></svg>`);
}
fs.writeFileSync('web/public/img/store-cover.svg', `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 240"><rect width="640" height="240" fill="#e3f0ec"/><rect x="40" y="110" width="560" height="100" rx="12" fill="#ffffff"/><rect x="40" y="70" width="560" height="50" rx="10" fill="#1f7a5c"/><g fill="#f4c542"><rect x="70" y="140" width="70" height="50" rx="6"/><rect x="170" y="140" width="70" height="50" rx="6"/><rect x="270" y="140" width="70" height="50" rx="6"/><rect x="370" y="140" width="70" height="50" rx="6"/><rect x="470" y="140" width="70" height="50" rx="6"/></g></svg>`);
console.log('placeholders written');
