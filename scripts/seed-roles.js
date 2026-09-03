const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const ALL_PERMISSIONS = [
  'users:read',
  'users:manage',
  'roles:manage',
  'companies:read',
  'companies:manage',
  'products:read',
  'products:manage',
  'products:stock_update',
  'product_groups:manage',
  'tags:manage',
  'orders:view_all',
  'orders:view_own',
  'orders:create',
  'orders:edit',
  'orders:status_change',
  'orders:comments',
  'orders:export',
  'promotions:read',
  'promotions:manage',
  'analytics:view',
  'templates:manage',
  'placeholders:manage',
  'import:execute',
  'logs:view',
  'settings:manage'
];

const DEFAULT_ROLE_TEMPLATES = [
  {
    name: 'Суперадминистратор',
    description: 'Полный неограниченный доступ ко всем модулям и настройкам системы',
    isSystem: true,
    defaultDashboard: '/admin',
    permissions: ALL_PERMISSIONS
  },
  {
    name: 'Менеджер продаж',
    description: 'Работа в консоли продаж, создание и редактирование заказов, просмотр аналитики и каталога',
    isSystem: true,
    defaultDashboard: '/seller',
    permissions: [
      'orders:view_all',
      'orders:create',
      'orders:edit',
      'orders:status_change',
      'orders:comments',
      'orders:export',
      'products:read',
      'products:stock_update',
      'companies:read',
      'promotions:read',
      'analytics:view'
    ]
  },
  {
    name: 'Клиент B2B (Заказчик)',
    description: 'Оформление оптовых заказов своей компании, просмотр каталога и доступных акций',
    isSystem: true,
    defaultDashboard: '/customer',
    permissions: [
      'orders:view_own',
      'orders:create',
      'orders:comments',
      'products:read',
      'promotions:read'
    ]
  },
  {
    name: 'Ограниченный менеджер',
    description: 'Просмотр каталога, акций и комментирование заказов без прав на смену цен и настроек',
    isSystem: true,
    defaultDashboard: '/seller',
    permissions: [
      'orders:view_all',
      'orders:comments',
      'products:read',
      'promotions:read'
    ]
  }
];

async function main() {
  console.log('Seeding and migrating Role Templates...');

  const createdRoles = {};

  for (const tpl of DEFAULT_ROLE_TEMPLATES) {
    const role = await prisma.roleTemplate.upsert({
      where: { name: tpl.name },
      update: {
        description: tpl.description,
        isSystem: tpl.isSystem,
        defaultDashboard: tpl.defaultDashboard,
        permissions: tpl.permissions
      },
      create: {
        name: tpl.name,
        description: tpl.description,
        isSystem: tpl.isSystem,
        defaultDashboard: tpl.defaultDashboard,
        permissions: tpl.permissions
      }
    });
    createdRoles[tpl.name] = role;
    console.log(`✓ Role Template ready: "${role.name}" (ID: ${role.id})`);
  }

  // Migrate existing users to role templates
  const users = await prisma.user.findMany();
  console.log(`Found ${users.length} users to review for role template binding...`);

  let updatedCount = 0;
  for (const user of users) {
    let targetRoleName = 'Клиент B2B (Заказчик)';
    const roleUpper = (user.role || '').toUpperCase();

    if (roleUpper === 'ADMIN') {
      targetRoleName = 'Суперадминистратор';
    } else if (roleUpper === 'SELLER') {
      targetRoleName = 'Менеджер продаж';
    } else if (roleUpper === 'MANAGER') {
      targetRoleName = 'Ограниченный менеджер';
    } else {
      targetRoleName = 'Клиент B2B (Заказчик)';
    }

    const matchedRole = createdRoles[targetRoleName];
    if (matchedRole && user.roleTemplateId !== matchedRole.id) {
      await prisma.user.update({
        where: { id: user.id },
        data: { roleTemplateId: matchedRole.id }
      });
      updatedCount++;
      console.log(`  Linked user "${user.email}" (${user.role}) -> Role Template "${matchedRole.name}"`);
    }
  }

  console.log(`Migration finished. ${updatedCount} users updated.`);
}

main()
  .catch((err) => {
    console.error('Error seeding role templates:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
