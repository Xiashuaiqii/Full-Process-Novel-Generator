const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
  console.log('=== 所有小说 ===');
  const novels = await prisma.novel.findMany();
  console.table(novels.map(n => ({ id: n.id.slice(0, 8), title: n.title })));

  for (const novel of novels) {
    console.log(`\n=== 小说: ${novel.title} (${novel.id.slice(0, 8)}) ===`);

    console.log('\n--- 卷 ---');
    const volumes = await prisma.volume.findMany({
      where: { novelId: novel.id },
      orderBy: { sortOrder: 'asc' }
    });
    console.table(volumes.map(v => ({
      id: v.id.slice(0, 8),
      title: v.title,
      sortOrder: v.sortOrder
    })));

    console.log('\n--- 章节 ---');
    const chapters = await prisma.chapter.findMany({
      where: { novelId: novel.id },
      orderBy: [{ volumeId: 'asc' }, { chapterNo: 'asc' }]
    });
    console.table(chapters.map(c => ({
      id: c.id.slice(0, 8),
      volumeId: c.volumeId ? c.volumeId.slice(0, 8) : 'null',
      chapterNo: c.chapterNo,
      title: c.title,
      status: c.status,
      wordCount: c.wordCount
    })));

    console.log('\n--- 章节统计 ---');
    const volumeCounts = {};
    let ungrouped = 0;
    for (const c of chapters) {
      if (c.volumeId) {
        volumeCounts[c.volumeId] = (volumeCounts[c.volumeId] || 0) + 1;
      } else {
        ungrouped++;
      }
    }
    console.log('各卷章节数:', volumeCounts);
    console.log('未分卷章节数:', ungrouped);
    console.log('总章节数:', chapters.length);
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
