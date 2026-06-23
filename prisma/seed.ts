import "dotenv/config";
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient({
  log: ['query'],
})

async function main() {
  const user = await prisma.user.upsert({
    where: { email: 'demo@example.com' },
    update: {},
    create: {
      email: 'demo@example.com',
      name: 'Demo User',
      sets: {
        create: {
          title: 'Finance Interview Basics',
          description: 'Core concepts for investment banking and PE interviews',
          cards: {
            create: [
              { term: 'P/E Ratio', definition: 'Price per share divided by earnings per share; measures how much investors pay per $1 of earnings', position: 0 },
              { term: 'EBITDA', definition: 'Earnings Before Interest, Taxes, Depreciation, and Amortization — a proxy for operating cash flow', position: 1 },
              { term: 'DCF', definition: 'Discounted Cash Flow — projects future FCF and discounts them to present value using WACC', position: 2 },
              { term: 'WACC', definition: 'Weighted Average Cost of Capital — blended cost of equity and debt, used as the DCF discount rate', position: 3 },
              { term: 'Enterprise Value', definition: 'Market cap + net debt (debt minus cash); total firm value independent of capital structure', position: 4 },
              { term: 'LBO', definition: 'Leveraged Buyout — acquisition primarily funded with debt, using the target\'s assets and cash flows as collateral', position: 5 },
            ],
          },
        },
      },
    },
  })
  console.log(`Seeded: ${user.email}`)
}

main().catch(console.error).finally(() => prisma.$disconnect())
