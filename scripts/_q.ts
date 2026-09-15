import { prisma } from '../src/lib/db'
async function main() {
  const rows = await prisma.aiCallLog.groupBy({ by: ['task', 'model', 'provider'], _count: { _all: true }, orderBy: { _count: { task: 'desc' } } })
  console.log(JSON.stringify(rows))
  console.log('total', await prisma.aiCallLog.count(), 'oldest', await prisma.aiCallLog.findFirst({ orderBy: { createdAt: 'asc' }, select: { createdAt: true } }))
  const groups = await prisma.studyGroup.findMany({ select: { id: true, name: true } })
  console.log('groups', JSON.stringify(groups))
}
main().finally(() => prisma.$disconnect())
