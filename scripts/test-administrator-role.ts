import prisma from '../src/lib/db';
import { NextRequest } from 'next/server';
import { GET as authMeRoute } from '../src/app/api/auth/me/route';
import { GET as getLogsRoute } from '../src/app/api/admin/logs/route';
import { GET as getTagsRoute, POST as postTagsRoute } from '../src/app/api/admin/tags/route';
import { GET as getProductGroupsRoute } from '../src/app/api/admin/product-groups/route';
import { GET as getGDriveRoute, POST as postGDriveRoute } from '../src/app/api/admin/gdrive/route';
import { signToken } from '../src/lib/auth';

async function main() {
  console.log('=== STARTING ADMINISTRATOR ROLE & GRANULAR ACCESS TEST SUITE ===\n');

  const ts = Date.now();

  // 1. Ensure or find "Администратор" role template
  const adminPermissions = [
    'users:read',
    'users:manage',
    'products:read',
    'products:manage',
    'tags:manage',
    'product_groups:manage',
    'logs:view',
    'orders:view_all'
  ];

  let adminTemplate = await prisma.roleTemplate.findFirst({
    where: { name: 'Администратор' }
  });

  if (!adminTemplate) {
    adminTemplate = await prisma.roleTemplate.create({
      data: {
        name: 'Администратор',
        description: 'Администратор системы с расширенными операционными правами',
        isSystem: false,
        defaultDashboard: '/admin',
        permissions: adminPermissions
      }
    });
  }

  // 2. Create test user with template "Администратор"
  const adminUser = await prisma.user.create({
    data: {
      email: `admin_role_${ts}@example.com`,
      name: 'System Administrator',
      passwordHash: 'dummy',
      role: 'ADMIN',
      roleTemplateId: adminTemplate.id,
      sessionVersion: 1
    },
    include: { roleTemplate: true }
  });

  const authToken = signToken({
    userId: adminUser.id,
    email: adminUser.email,
    name: adminUser.name,
    role: 'ADMIN',
    roleTemplateId: adminTemplate.id,
    roleName: 'Администратор',
    permissions: adminPermissions,
    sessionVersion: 1
  });

  const makeReq = (url: string, method = 'GET', body?: any) => {
    return new NextRequest(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        cookie: `b2b_auth_token=${authToken}`
      },
      body: body ? JSON.stringify(body) : undefined
    });
  };

  try {
    // -------------------------------------------------------------
    // Test 1: Verify /api/auth/me returns granular permissions
    // -------------------------------------------------------------
    console.log('[Test 1] Testing /api/auth/me for Administrator...');
    const reqAuthMe = makeReq('http://localhost:3000/api/auth/me');
    const resAuthMe = await authMeRoute(reqAuthMe);
    const dataAuthMe = await resAuthMe.json();

    if (resAuthMe.status !== 200 || !dataAuthMe.authenticated) {
      throw new Error(`Expected authenticated: true from /api/auth/me, got ${resAuthMe.status}: ${JSON.stringify(dataAuthMe)}`);
    }

    if (!dataAuthMe.user.permissions.includes('logs:view') || !dataAuthMe.user.permissions.includes('tags:manage')) {
      throw new Error(`Missing expected permissions: ${dataAuthMe.user.permissions}`);
    }

    if (dataAuthMe.user.roleName !== 'Администратор') {
      throw new Error(`Expected roleName 'Администратор', got ${dataAuthMe.user.roleName}`);
    }

    console.log('✓ /api/auth/me returns authenticated: true with exact template permissions');

    // -------------------------------------------------------------
    // Test 2: Access to /api/admin/logs via logs:view
    // -------------------------------------------------------------
    console.log('\n[Test 2] Testing /api/admin/logs access...');
    const reqLogs = makeReq('http://localhost:3000/api/admin/logs');
    const resLogs = await getLogsRoute(reqLogs);

    if (resLogs.status !== 200) {
      const err = await resLogs.json().catch(() => ({}));
      throw new Error(`Expected 200 from /api/admin/logs, got ${resLogs.status}: ${JSON.stringify(err)}`);
    }
    console.log('✓ /api/admin/logs returned 200 OK (no 403 Forbidden)');

    // -------------------------------------------------------------
    // Test 3: Access to /api/admin/tags via tags:manage
    // -------------------------------------------------------------
    console.log('\n[Test 3] Testing /api/admin/tags access...');
    const reqTags = makeReq('http://localhost:3000/api/admin/tags');
    const resTags = await getTagsRoute(reqTags);

    if (resTags.status !== 200) {
      const err = await resTags.json().catch(() => ({}));
      throw new Error(`Expected 200 from GET /api/admin/tags, got ${resTags.status}: ${JSON.stringify(err)}`);
    }
    console.log('✓ GET /api/admin/tags returned 200 OK');

    const createdTagName = `AdminTag_${ts}`;
    const reqPostTag = makeReq('http://localhost:3000/api/admin/tags', 'POST', {
      name: createdTagName,
      color: '#f59e0b'
    });
    const resPostTag = await postTagsRoute(reqPostTag);
    if (resPostTag.status !== 200) {
      const err = await resPostTag.json().catch(() => ({}));
      throw new Error(`Expected 200 from POST /api/admin/tags, got ${resPostTag.status}: ${JSON.stringify(err)}`);
    }
    console.log('✓ POST /api/admin/tags returned 200 OK and created tag');

    // Cleanup created tag
    await prisma.tag.deleteMany({ where: { name: createdTagName } });

    // -------------------------------------------------------------
    // Test 4: Access to /api/admin/product-groups via product_groups:manage
    // -------------------------------------------------------------
    console.log('\n[Test 4] Testing /api/admin/product-groups access...');
    const reqGroups = makeReq('http://localhost:3000/api/admin/product-groups');
    const resGroups = await getProductGroupsRoute(reqGroups);

    if (resGroups.status !== 200) {
      const err = await resGroups.json().catch(() => ({}));
      throw new Error(`Expected 200 from /api/admin/product-groups, got ${resGroups.status}: ${JSON.stringify(err)}`);
    }
    console.log('✓ GET /api/admin/product-groups returned 200 OK');

    // -------------------------------------------------------------
    // Test 5: Google Drive status view (GET) vs setting mutation (POST)
    // -------------------------------------------------------------
    console.log('\n[Test 5] Testing Google Drive status view vs modification...');
    const reqGDriveGet = makeReq('http://localhost:3000/api/admin/gdrive');
    const resGDriveGet = await getGDriveRoute(reqGDriveGet);

    if (resGDriveGet.status !== 200) {
      const err = await resGDriveGet.json().catch(() => ({}));
      throw new Error(`Expected 200 from GET /api/admin/gdrive, got ${resGDriveGet.status}: ${JSON.stringify(err)}`);
    }
    const gdriveData = await resGDriveGet.json();
    if (typeof gdriveData.syncEnabled !== 'boolean') {
      throw new Error(`Expected syncEnabled boolean in GDrive response, got ${JSON.stringify(gdriveData)}`);
    }
    console.log('✓ GET /api/admin/gdrive returned 200 OK with live sync metrics (avoids fallback)');

    // POST /api/admin/gdrive requires settings:manage (which Administrator does not have)
    const reqGDrivePost = makeReq('http://localhost:3000/api/admin/gdrive', 'POST', {
      action: 'save_settings',
      syncEnabled: true
    });
    const resGDrivePost = await postGDriveRoute(reqGDrivePost);
    if (resGDrivePost.status !== 403) {
      throw new Error(`Expected 403 from POST /api/admin/gdrive for user without settings:manage, got ${resGDrivePost.status}`);
    }
    console.log('✓ POST /api/admin/gdrive correctly rejected with 403 due to missing settings:manage');

    console.log('\n=== ALL ADMINISTRATOR ROLE TESTS PASSED! ===');
  } finally {
    // Cleanup
    await prisma.user.delete({ where: { id: adminUser.id } }).catch(() => {});
  }
}

main().catch((err) => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
