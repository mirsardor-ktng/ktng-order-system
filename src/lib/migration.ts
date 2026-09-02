import prisma from '@/lib/db';

/**
 * Automates the migration of existing users and orders to support the Company and fileId/fileName architecture.
 */
export async function runDatabaseMigration() {
  const report = {
    companiesCreated: 0,
    usersMigrated: 0,
    ordersLinked: 0,
    filesRecovered: 0,
    errors: [] as string[]
  };

  try {
    // 1. Migrate Customer Users to Companies
    const customerUsers = await prisma.user.findMany({
      where: { role: 'CUSTOMER' }
    });

    for (const user of customerUsers) {
      if (!user.companyId) {
        try {
          // Check if a company with this name already exists
          let company = await prisma.company.findFirst({
            where: { name: user.name }
          });

          if (!company) {
            // Generate a unique company code (CMP-001, CMP-002, etc.)
            const count = await prisma.company.count();
            let code = `CMP-${String(count + 1).padStart(3, '0')}`;
            let exists = await prisma.company.findUnique({ where: { code } });
            let i = 1;
            while (exists) {
              code = `CMP-${String(count + 1 + i).padStart(3, '0')}`;
              exists = await prisma.company.findUnique({ where: { code } });
              i++;
            }

            company = await prisma.company.create({
              data: {
                name: user.name,
                code,
                inn: null,
                purchasePlanCases: 0
              }
            });
            report.companiesCreated++;
          }

          // Link user to company
          await prisma.user.update({
            where: { id: user.id },
            data: { companyId: company.id }
          });
          report.usersMigrated++;
        } catch (err: any) {
          report.errors.push(`Error migrating user ${user.email}: ${err.message}`);
        }
      } else {
        report.usersMigrated++;
      }
    }

    // Reload customer users to get companyId mappings
    const updatedCustomerUsers = await prisma.user.findMany({
      where: { role: 'CUSTOMER' },
      include: { company: true }
    });

    // 2. Migrate Orders (link to company & createdBy, and recover GDrive file ID/name)
    const orders = await prisma.order.findMany();

    for (const order of orders) {
      const customerUser = updatedCustomerUsers.find(u => u.id === order.customerId);
      const updateData: any = {};

      // Set companyId and createdByUserId if missing
      if (!order.companyId && customerUser?.companyId) {
        updateData.companyId = customerUser.companyId;
      }
      if (!order.createdByUserId) {
        updateData.createdByUserId = order.customerId;
      }

      // Recover fileId and fileName from legacy fileUrl
      if (!order.fileId && order.fileUrl) {
        try {
          const urlObj = new URL(order.fileUrl, 'http://localhost');
          const fileId = urlObj.searchParams.get('fileId');
          const fileName = urlObj.searchParams.get('fileName') || `order_${order.orderNumber}.xlsx`;

          if (fileId) {
            updateData.fileId = fileId;
            updateData.fileName = fileName;
            report.filesRecovered++;
          }
        } catch (err: any) {
          report.errors.push(`Error parsing fileUrl for order ${order.orderNumber}: ${err.message}`);
        }
      }

      // Perform update if changes are needed
      if (Object.keys(updateData).length > 0) {
        await prisma.order.update({
          where: { id: order.id },
          data: updateData
        });
        report.ordersLinked++;
      }
    }

  } catch (globalErr: any) {
    report.errors.push(`Global migration error: ${globalErr.message}`);
  }

  return report;
}

/**
 * Recovers fileId and fileName parameters for all orders that have fileUrls but lack fileIds.
 */
export async function recoverLegacyFileLinks() {
  const report = {
    processed: 0,
    recovered: 0,
    errors: [] as string[]
  };

  try {
    const orders = await prisma.order.findMany({
      where: {
        fileId: null,
        fileUrl: { not: null }
      }
    });

    for (const order of orders) {
      report.processed++;
      if (order.fileUrl) {
        try {
          const urlObj = new URL(order.fileUrl, 'http://localhost');
          const fileId = urlObj.searchParams.get('fileId');
          const fileName = urlObj.searchParams.get('fileName') || `order_${order.orderNumber}.xlsx`;

          if (fileId) {
            await prisma.order.update({
              where: { id: order.id },
              data: { fileId, fileName }
            });
            report.recovered++;
          }
        } catch (err: any) {
          report.errors.push(`Failed to parse link for order ${order.orderNumber}: ${err.message}`);
        }
      }
    }
  } catch (err: any) {
    report.errors.push(`Recovery error: ${err.message}`);
  }

  return report;
}
