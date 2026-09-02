const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('Seeding database with B2B Cigarette ordering data...');

  // 1. Core Placeholder Mappings
  const placeholderMappings = [
    { placeholder: '{CLIENT_NAME}', systemField: 'customer.name', description: 'Название компании клиента' },
    { placeholder: '{ORDER_DATE}', systemField: 'order.createdAt', description: 'Дата и время оформления заказа' },
    { placeholder: '{ORDER_NUMBER}', systemField: 'order.orderNumber', description: 'Уникальный номер заказа' },
    { placeholder: '{TOTAL_BLOCKS}', systemField: 'order.totalBlocks', description: 'Итоговое количество блоков в заказе' },
    { placeholder: '{TOTAL_CASES}', systemField: 'order.totalCases', description: 'Итоговое количество коробок в заказе' },
    { placeholder: '{TOTAL_PRICE}', systemField: 'order.totalPrice', description: 'Общая сумма заказа' },
    { placeholder: '{SKU_NAME}', systemField: 'product.name', description: 'Наименование сигаретной продукции (SKU)' },
    { placeholder: '{QTY_PACKS}', systemField: 'item.quantityPacks', description: 'Количество заказанных пачек для конкретного SKU' },
    { placeholder: '{QTY_BLOCKS}', systemField: 'item.quantityBlocks', description: 'Количество заказанных блоков для конкретного SKU' },
    { placeholder: '{QTY_CASES}', systemField: 'item.quantityCases', description: 'Количество заказанных коробок для конкретного SKU' },
    { placeholder: '{ITEM_TOTAL_PRICE}', systemField: 'item.totalPrice', description: 'Общая стоимость отдельной позиции в заказе' },
  ];

  console.log('Clearing old placeholders...');
  try {
    await prisma.placeholderMapping.deleteMany({});
  } catch (e) {}

  console.log('Creating placeholder mappings...');
  for (const mapping of placeholderMappings) {
    await prisma.placeholderMapping.create({ data: mapping });
  }

  console.log('Clearing old products...');
  try {
    await prisma.product.deleteMany({});
  } catch (e) {}

  // 2. Default Local Excel Template record
  console.log('Clearing old templates...');
  try {
    await prisma.template.deleteMany({});
  } catch (e) {}

  console.log('Seeding default template record...');
  await prisma.template.create({
    data: {
      name: 'Стандартный B2B Бланк Заказа',
      isActive: true,
      isLocal: true,
      filePath: 'templates/default_order_template.xlsx',
      version: '1.0.0'
    }
  });

  // 3. Default Settings
  console.log('Clearing old system settings...');
  try {
    await prisma.systemSetting.deleteMany({});
  } catch (e) {}

  console.log('Seeding default settings...');
  await prisma.systemSetting.create({
    data: { key: 'GDRIVE_SYNC_ENABLED', value: 'false' }
  });
  await prisma.systemSetting.create({
    data: { key: 'GDRIVE_CLIENT_EMAIL', value: '' }
  });
  await prisma.systemSetting.create({
    data: { key: 'GDRIVE_FOLDER_ID', value: '' }
  });
  await prisma.systemSetting.create({
    data: { key: 'BACKUP_ENCRYPTION_KEY', value: 'B2BSecureSystemPassphrase2026' }
  });

  console.log('Seeding completed successfully!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
