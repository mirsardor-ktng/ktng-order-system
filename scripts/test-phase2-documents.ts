import { PrismaClient, OrderDocumentType } from '@prisma/client';
import { OrderDocumentService, LOGISTICS_CODES_MAX_SIZE, TRANSPORT_PHOTO_MAX_SIZE } from '../src/lib/orders/order-document.service';
import { JWTPayload } from '../src/lib/auth';

const prisma = new PrismaClient();

async function runTests() {
  console.log('====================================================');
  console.log('  STARTING PHASE 2 ORDER DOCUMENTS TEST SUITE');
  console.log('====================================================\n');

  let passedTests = 0;
  let failedTests = 0;

  function assert(condition: boolean, testName: string) {
    if (condition) {
      console.log(`[PASS] ${testName}`);
      passedTests++;
    } else {
      console.error(`[FAIL] ${testName}`);
      failedTests++;
    }
  }

  // 1. Setup Test Data (Order and Users)
  const testOrder = await prisma.order.findFirst({
    include: { customer: true, company: true }
  });

  if (!testOrder) {
    throw new Error('No orders found in database to test against.');
  }

  console.log(`Using Test Order: ${testOrder.orderNumber} (ID: ${testOrder.id})\n`);

  // Mock sessions
  const superadminSession: JWTPayload = {
    userId: testOrder.customer.id,
    email: 'admin@test.com',
    role: 'ADMIN',
    permissions: ['*'], // Superadmin has all permissions
    companyId: testOrder.companyId || undefined
  };

  const logisticsSession: JWTPayload = {
    userId: 'user_logistics',
    email: 'logistics@test.com',
    role: 'SELLER',
    permissions: [
      'orders:view_all',
      'orders:logistics_codes:upload',
      'orders:logistics_codes:view',
      'orders:logistics_codes:download',
      'orders:transport_docs:upload',
      'orders:transport_docs:view',
      'orders:transport_docs:download'
    ],
    companyId: undefined
  };

  const financeSession: JWTPayload = {
    userId: 'user_finance',
    email: 'finance@test.com',
    role: 'SELLER',
    permissions: [
      'orders:view_all',
      'orders:logistics_codes:view',
      'orders:logistics_codes:download',
      'orders:transport_docs:view',
      'orders:transport_docs:download'
    ],
    companyId: undefined
  };

  const unauthorizedSession: JWTPayload = {
    userId: 'user_unauthorized',
    email: 'unauth@test.com',
    role: 'CUSTOMER',
    permissions: ['orders:view_own'],
    companyId: 'different_company_id'
  };

  // Track created documents for cleanup
  const createdDocIds: string[] = [];

  try {
    // ----------------------------------------------------
    // TEST 1: Upload Logistics Codes (Valid .xlsx)
    // ----------------------------------------------------
    const xlsxBuffer = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00, 0x00, 0x00]); // PK zip header
    const doc1 = await OrderDocumentService.uploadDocument(
      logisticsSession,
      testOrder.id,
      OrderDocumentType.LOGISTICS_CODES,
      'test_codes_01.xlsx',
      xlsxBuffer,
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    createdDocIds.push(doc1.id);

    assert(
      doc1.type === OrderDocumentType.LOGISTICS_CODES &&
      doc1.fileName === 'test_codes_01.xlsx' &&
      doc1.fileSize === xlsxBuffer.length,
      'Test 1: Upload single logistics codes (.xlsx)'
    );

    // ----------------------------------------------------
    // TEST 2: Multiple Logistics Codes in Same Order (.csv & .pdf)
    // ----------------------------------------------------
    const csvBuffer = Buffer.from('sku,code\n10009500A0,SN123456\n10009500A0,SN123457\n');
    const doc2 = await OrderDocumentService.uploadDocument(
      logisticsSession,
      testOrder.id,
      OrderDocumentType.LOGISTICS_CODES,
      'additional_codes.csv',
      csvBuffer,
      'text/csv'
    );
    createdDocIds.push(doc2.id);

    const pdfBuffer = Buffer.from('%PDF-1.4 test pdf content header');
    const doc3 = await OrderDocumentService.uploadDocument(
      logisticsSession,
      testOrder.id,
      OrderDocumentType.LOGISTICS_CODES,
      'stamped_codes.pdf',
      pdfBuffer,
      'application/pdf'
    );
    createdDocIds.push(doc3.id);

    assert(
      doc2.fileName === 'additional_codes.csv' && doc3.fileName === 'stamped_codes.pdf',
      'Test 2: Multiple code files in same order (.csv and .pdf)'
    );

    // ----------------------------------------------------
    // TEST 3: Logistics Codes Download (Finance role)
    // ----------------------------------------------------
    const downloaded1 = await OrderDocumentService.getDocumentForDownload(
      financeSession,
      doc1.id
    );

    assert(
      downloaded1.document.id === doc1.id &&
      downloaded1.fileBuffer.length === xlsxBuffer.length,
      'Test 3: Finance user can download logistics codes'
    );

    // ----------------------------------------------------
    // TEST 4: Upload Driver License Photo (JPEG)
    // ----------------------------------------------------
    const jpegBuffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
    const driverPhoto = await OrderDocumentService.uploadDocument(
      logisticsSession,
      testOrder.id,
      OrderDocumentType.DRIVER_LICENSE_PHOTO,
      'driver_license_front.jpg',
      jpegBuffer,
      'image/jpeg'
    );
    createdDocIds.push(driverPhoto.id);

    assert(
      driverPhoto.type === OrderDocumentType.DRIVER_LICENSE_PHOTO &&
      driverPhoto.fileName === 'driver_license_front.jpg',
      'Test 4: Upload driver license photo (.jpg)'
    );

    // ----------------------------------------------------
    // TEST 5: Driver Photo Preview
    // ----------------------------------------------------
    const preview1 = await OrderDocumentService.getDocumentForPreview(
      financeSession,
      driverPhoto.id
    );

    assert(
      preview1.document.id === driverPhoto.id &&
      preview1.mimeType === 'image/jpeg' &&
      preview1.fileBuffer.length === jpegBuffer.length,
      'Test 5: Secure preview of driver license photo'
    );

    // ----------------------------------------------------
    // TEST 6: Upload Vehicle Registration Photo (PNG)
    // ----------------------------------------------------
    const pngBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
    const vehiclePhoto = await OrderDocumentService.uploadDocument(
      logisticsSession,
      testOrder.id,
      OrderDocumentType.VEHICLE_REGISTRATION_PHOTO,
      'vehicle_tech_passport.png',
      pngBuffer,
      'image/png'
    );
    createdDocIds.push(vehiclePhoto.id);

    assert(
      vehiclePhoto.type === OrderDocumentType.VEHICLE_REGISTRATION_PHOTO &&
      vehiclePhoto.fileName === 'vehicle_tech_passport.png',
      'Test 6: Upload vehicle registration photo (.png)'
    );

    // ----------------------------------------------------
    // TEST 7: Vehicle Photo Preview
    // ----------------------------------------------------
    const preview2 = await OrderDocumentService.getDocumentForPreview(
      financeSession,
      vehiclePhoto.id
    );

    assert(
      preview2.document.id === vehiclePhoto.id &&
      preview2.mimeType === 'image/png',
      'Test 7: Secure preview of vehicle registration photo'
    );

    // ----------------------------------------------------
    // TEST 8: Permission Enforcement - Finance cannot upload
    // ----------------------------------------------------
    let financeUploadBlocked = false;
    try {
      await OrderDocumentService.uploadDocument(
        financeSession,
        testOrder.id,
        OrderDocumentType.LOGISTICS_CODES,
        'illegal.xlsx',
        xlsxBuffer
      );
    } catch (e: any) {
      if (e.message.includes('Недостаточно прав')) {
        financeUploadBlocked = true;
      }
    }
    assert(financeUploadBlocked, 'Test 8: Finance user without upload permission is blocked (403)');

    // ----------------------------------------------------
    // TEST 9: Unauthorized User cannot preview or download
    // ----------------------------------------------------
    let unauthPreviewBlocked = false;
    try {
      await OrderDocumentService.getDocumentForPreview(
        unauthorizedSession,
        driverPhoto.id
      );
    } catch (e: any) {
      if (e.message.includes('Недостаточно прав') || e.message.includes('Доступ запрещен')) {
        unauthPreviewBlocked = true;
      }
    }

    let unauthDownloadBlocked = false;
    try {
      await OrderDocumentService.getDocumentForDownload(
        unauthorizedSession,
        doc1.id
      );
    } catch (e: any) {
      if (e.message.includes('Недостаточно прав') || e.message.includes('Доступ запрещен')) {
        unauthDownloadBlocked = true;
      }
    }

    assert(
      unauthPreviewBlocked && unauthDownloadBlocked,
      'Test 9: Unauthorized user blocked from preview and download (403)'
    );

    // ----------------------------------------------------
    // TEST 10: Validation - Reject Executables & SVG
    // ----------------------------------------------------
    let exeBlocked = false;
    try {
      await OrderDocumentService.uploadDocument(
        logisticsSession,
        testOrder.id,
        OrderDocumentType.LOGISTICS_CODES,
        'malicious.exe',
        Buffer.from('MZ executable header')
      );
    } catch (e: any) {
      if (e.message.includes('Недопустимый формат')) {
        exeBlocked = true;
      }
    }

    let svgBlocked = false;
    try {
      await OrderDocumentService.uploadDocument(
        logisticsSession,
        testOrder.id,
        OrderDocumentType.DRIVER_LICENSE_PHOTO,
        'vector.svg',
        Buffer.from('<svg></svg>')
      );
    } catch (e: any) {
      if (e.message.includes('Недопустимый формат')) {
        svgBlocked = true;
      }
    }

    assert(exeBlocked && svgBlocked, 'Test 10: Dangerous formats (.exe, .svg) rejected');

    // ----------------------------------------------------
    // TEST 11: Validation - File Size Limits
    // ----------------------------------------------------
    let oversizeBlocked = false;
    try {
      const hugeBuffer = Buffer.alloc(TRANSPORT_PHOTO_MAX_SIZE + 1024);
      // Give valid jpeg header so it only fails on size
      hugeBuffer[0] = 0xff;
      hugeBuffer[1] = 0xd8;
      hugeBuffer[2] = 0xff;
      await OrderDocumentService.uploadDocument(
        logisticsSession,
        testOrder.id,
        OrderDocumentType.DRIVER_LICENSE_PHOTO,
        'huge_photo.jpg',
        hugeBuffer
      );
    } catch (e: any) {
      if (e.message.includes('превышает допустимый лимит')) {
        oversizeBlocked = true;
      }
    }
    assert(oversizeBlocked, 'Test 11: Photos > 10MB rejected with size limit error');

    // ----------------------------------------------------
    // TEST 12: Preview Rejected for Non-Photos
    // ----------------------------------------------------
    let previewNonPhotoBlocked = false;
    try {
      await OrderDocumentService.getDocumentForPreview(
        financeSession,
        doc1.id // doc1 is LOGISTICS_CODES .xlsx
      );
    } catch (e: any) {
      if (e.message.includes('только для фотографий')) {
        previewNonPhotoBlocked = true;
      }
    }
    assert(previewNonPhotoBlocked, 'Test 12: Preview endpoint only permits photo document types');

    // ----------------------------------------------------
    // TEST 13: Regression - Existing Warehouse Request Download
    // ----------------------------------------------------
    const existingWhDoc = await prisma.orderDocument.findFirst({
      where: { type: OrderDocumentType.WAREHOUSE_ASSEMBLY_REQUEST }
    });

    if (existingWhDoc) {
      const whSession: JWTPayload = {
        userId: 'wh_user',
        email: 'wh@test.com',
        role: 'SELLER',
        permissions: ['orders:view_all', 'orders:warehouse_request:download']
      };

      const whDownloaded = await OrderDocumentService.getDocumentForDownload(
        whSession,
        existingWhDoc.id
      );

      assert(
        whDownloaded.document.id === existingWhDoc.id &&
        whDownloaded.fileBuffer.length > 0,
        'Test 13: Regression - Existing Warehouse Assembly Request downloads cleanly'
      );
    } else {
      console.log('[SKIP] Test 13: No existing WAREHOUSE_ASSEMBLY_REQUEST in DB to test');
    }

  } finally {
    // Cleanup test documents from DB
    if (createdDocIds.length > 0) {
      await prisma.orderDocument.deleteMany({
        where: { id: { in: createdDocIds } }
      });
      console.log(`\nCleaned up ${createdDocIds.length} test documents from database.`);
    }
    await prisma.$disconnect();
  }

  console.log('\n====================================================');
  console.log(`  RESULTS: ${passedTests} PASSED, ${failedTests} FAILED`);
  console.log('====================================================\n');

  if (failedTests > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Test script crashed:', err);
  process.exit(1);
});
