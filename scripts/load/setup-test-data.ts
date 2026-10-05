import prisma from '../../src/lib/db';
import bcrypt from 'bcryptjs';
import fs from 'fs';
import path from 'path';

const PASSWORD_PLAIN = 'LoadTestPass123!';

async function main() {
  console.log('=== PHASE 13A: Provisioning Load Test Data ===\n');

  // 1. Roles
  const clientRole = await prisma.roleTemplate.findFirst({
    where: { name: 'Клиент' }
  });
  const sellerRole = await prisma.roleTemplate.findFirst({
    where: { name: 'Менеджер продаж' }
  });

  if (!clientRole || !sellerRole) {
    throw new Error('Required role templates (Клиент, Менеджер продаж) not found!');
  }

  // 2. Dedicated Load Test Company
  const company = await prisma.company.upsert({
    where: { code: 'LOADTEST' },
    update: {
      name: 'Load Test Company LLC',
      purchasePlanCases: 1000,
      monthlyTargetCases: 1000
    },
    create: {
      name: 'Load Test Company LLC',
      code: 'LOADTEST',
      inn: '999888777',
      purchasePlanCases: 1000,
      monthlyTargetCases: 1000
    }
  });
  console.log(`✓ Test Company: ${company.name} (${company.code}) - ID: ${company.id}`);

  // 3. Dedicated Load Test Products (High stock: 1,000,000 packs)
  const product1 = await prisma.product.upsert({
    where: { sku: 'LOADTEST-SKU-1' },
    update: {
      name: 'Load Test SKU 1 (Regular)',
      basePrice: 15000,
      stockPacks: 1000000,
      isActive: true
    },
    create: {
      sku: 'LOADTEST-SKU-1',
      name: 'Load Test SKU 1 (Regular)',
      imageUrl: '/images/products/placeholder.png',
      basePrice: 15000,
      stockPacks: 1000000,
      isActive: true
    }
  });

  const product2 = await prisma.product.upsert({
    where: { sku: 'LOADTEST-SKU-2' },
    update: {
      name: 'Load Test SKU 2 (Slims)',
      basePrice: 16000,
      stockPacks: 1000000,
      isActive: true
    },
    create: {
      sku: 'LOADTEST-SKU-2',
      name: 'Load Test SKU 2 (Slims)',
      imageUrl: '/images/products/placeholder.png',
      basePrice: 16000,
      stockPacks: 1000000,
      isActive: true
    }
  });
  console.log(`✓ Test Products:`);
  console.log(`  - ${product1.sku}: ${product1.name} (Stock: ${product1.stockPacks})`);
  console.log(`  - ${product2.sku}: ${product2.name} (Stock: ${product2.stockPacks})`);

  // 4. Password hash (compute once for speed)
  const passwordHash = await bcrypt.hash(PASSWORD_PLAIN, 10);

  // 5. Provision 50 Customer Users
  const customerUsers = [];
  for (let i = 1; i <= 50; i++) {
    const pad = String(i).padStart(3, '0');
    const email = `loadtest-user-${pad}@ktng-test.local`;
    const name = `Load Test User ${pad}`;

    const user = await prisma.user.upsert({
      where: { email },
      update: {
        name,
        passwordHash,
        role: 'CUSTOMER',
        roleTemplateId: clientRole.id,
        companyId: company.id,
        isActive: true
      },
      create: {
        email,
        name,
        passwordHash,
        role: 'CUSTOMER',
        roleTemplateId: clientRole.id,
        companyId: company.id,
        isActive: true
      }
    });

    customerUsers.push({
      id: user.id,
      email: user.email,
      password: PASSWORD_PLAIN,
      role: 'CUSTOMER',
      name: user.name,
      companyId: company.id
    });
  }
  console.log(`✓ Provisioned ${customerUsers.length} customer test users (loadtest-user-001 to 050)`);

  // 6. Provision 1 Seller User
  const sellerEmail = 'loadtest-seller@ktng-test.local';
  const sellerUser = await prisma.user.upsert({
    where: { email: sellerEmail },
    update: {
      name: 'Load Test Seller',
      passwordHash,
      role: 'SELLER',
      roleTemplateId: sellerRole.id,
      companyId: null,
      isActive: true
    },
    create: {
      email: sellerEmail,
      name: 'Load Test Seller',
      passwordHash,
      role: 'SELLER',
      roleTemplateId: sellerRole.id,
      companyId: null,
      isActive: true
    }
  });
  console.log(`✓ Provisioned Seller test user: ${sellerUser.email}`);

  // 7. Write tests/load/test-data.json for k6 runner
  const testData = {
    company: {
      id: company.id,
      name: company.name,
      code: company.code
    },
    products: [
      { id: product1.id, sku: product1.sku, name: product1.name, price: product1.basePrice },
      { id: product2.id, sku: product2.sku, name: product2.name, price: product2.basePrice }
    ],
    seller: {
      id: sellerUser.id,
      email: sellerUser.email,
      password: PASSWORD_PLAIN
    },
    customers: customerUsers
  };

  const testDataPath = path.resolve(process.cwd(), 'tests/load/test-data.json');
  fs.writeFileSync(testDataPath, JSON.stringify(testData, null, 2), 'utf-8');
  console.log(`✓ Saved test configuration to: ${testDataPath}`);

  console.log('\n=== Setup completed successfully! ===');
}

main()
  .catch((err) => {
    console.error('Setup failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
