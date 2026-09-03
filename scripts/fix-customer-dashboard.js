const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('--- Updating Customer Role Templates and Customer defaultDashboard ---');
  
  // 1. Update any role template with name containing 'Клиент' or 'Customer' to defaultDashboard: '/customer'
  const updatedRoles = await prisma.roleTemplate.updateMany({
    where: {
      OR: [
        { name: { contains: 'Клиент', mode: 'insensitive' } },
        { name: { contains: 'Customer', mode: 'insensitive' } },
        { name: { contains: 'Заказчик', mode: 'insensitive' } }
      ]
    },
    data: {
      defaultDashboard: '/customer'
    }
  });
  console.log(`Updated ${updatedRoles.count} role templates.`);

  // 2. Fetch all role templates to log
  const allRoles = await prisma.roleTemplate.findMany();
  console.log('Current Role Templates:', allRoles.map(r => ({ id: r.id, name: r.name, defaultDashboard: r.defaultDashboard, permissions: r.permissions })));

  // 3. Ensure customers are assigned the customer role template
  const customerRole = allRoles.find(r => r.name.includes('Клиент') || r.name.includes('Customer') || r.name.includes('Заказчик'));
  if (customerRole) {
    const updatedUsers = await prisma.user.updateMany({
      where: {
        role: 'CUSTOMER'
      },
      data: {
        roleTemplateId: customerRole.id
      }
    });
    console.log(`Updated ${updatedUsers.count} customer users to roleTemplateId ${customerRole.id} (${customerRole.name}).`);
  }
}

main()
  .catch(e => console.error(e))
  .finally(() => prisma.$disconnect());
