export function countChineseWords(text: string) {
  const chineseChars = text.match(/[\u4e00-\u9fff]/g)?.length ?? 0;
  const withoutChinese = text.replace(/[\u4e00-\u9fff]/g, " ");
  const englishWords = withoutChinese.match(/[A-Za-z0-9]+(?:[-'][A-Za-z0-9]+)?/g)?.length ?? 0;
  return chineseChars + englishWords;
}
