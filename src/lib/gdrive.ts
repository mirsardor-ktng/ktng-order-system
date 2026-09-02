import fs from 'fs';
import path from 'path';
import { drive, auth } from '@googleapis/drive';

// Define paths for Local File System Mock Fallback
const LOCAL_MOCK_ROOT = path.join(process.cwd(), 'local-gdrive-mock');
const LOCAL_ORDERS = path.join(LOCAL_MOCK_ROOT, 'Orders');
const LOCAL_TEMPLATES = path.join(LOCAL_MOCK_ROOT, 'Templates');
const LOCAL_USERS = path.join(LOCAL_MOCK_ROOT, 'Users');
const LOCAL_LOGS = path.join(LOCAL_MOCK_ROOT, 'Logs');

// Helper to ensure directories exist
function ensureLocalDirs() {
  if (!fs.existsSync(LOCAL_MOCK_ROOT)) fs.mkdirSync(LOCAL_MOCK_ROOT, { recursive: true });
  if (!fs.existsSync(LOCAL_ORDERS)) fs.mkdirSync(LOCAL_ORDERS);
  if (!fs.existsSync(LOCAL_TEMPLATES)) fs.mkdirSync(LOCAL_TEMPLATES);
  if (!fs.existsSync(LOCAL_USERS)) fs.mkdirSync(LOCAL_USERS);
  if (!fs.existsSync(LOCAL_LOGS)) fs.mkdirSync(LOCAL_LOGS);
}

export interface GDriveConfig {
  enabled: boolean;
  folderId?: string; // Root Folder ID in Google Drive
  refreshToken?: string;
}

/**
 * Resolves the configuration from environment variables or a DB settings lookup.
 */
export async function getGDriveConfig(): Promise<GDriveConfig> {
  let enabled = process.env.GDRIVE_SYNC_ENABLED === 'true';
  let folderId = process.env.GDRIVE_FOLDER_ID;
  let refreshToken: string | undefined;

  try {
    const prisma = (await import('./db')).default;
    const settings = await prisma.systemSetting.findMany({
      where: {
        key: {
          in: ['GDRIVE_SYNC_ENABLED', 'GDRIVE_FOLDER_ID', 'GDRIVE_REFRESH_TOKEN']
        }
      }
    });

    const settingsMap = new Map(settings.map(s => [s.key, s.value]));
    
    if (settingsMap.has('GDRIVE_SYNC_ENABLED')) {
      enabled = settingsMap.get('GDRIVE_SYNC_ENABLED') === 'true';
    }
    if (settingsMap.has('GDRIVE_FOLDER_ID')) {
      folderId = settingsMap.get('GDRIVE_FOLDER_ID');
    }
    if (settingsMap.has('GDRIVE_REFRESH_TOKEN')) {
      refreshToken = settingsMap.get('GDRIVE_REFRESH_TOKEN');
    }
  } catch (err) {
    console.warn('[GDrive Settings warning] Database settings lookup failed, using ENV defaults:', err);
  }

  return {
    enabled: enabled && !!refreshToken,
    folderId,
    refreshToken
  };
}

/**
 * Returns a Google Drive Client instance via OAuth 2.0.
 */
function getDriveClient(config: GDriveConfig) {
  if (!config.refreshToken) {
    throw new Error('Google Drive credentials (Refresh Token) missing. Please authorize Google Drive in Settings.');
  }
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    throw new Error('Missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET in .env file.');
  }

  const oauth2Client = new auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/api/admin/gdrive/callback'
  );

  oauth2Client.setCredentials({
    refresh_token: config.refreshToken
  });

  return drive({ version: 'v3', auth: oauth2Client });
}

/**
 * Uploads a file to Google Drive (with local fallback).
 */
export async function uploadFile(
  fileName: string,
  content: Buffer | string,
  mimeType: string,
  folderName: 'Orders' | 'Templates' | 'Users' | 'Logs'
): Promise<{ success: boolean; fileId: string; path?: string; message: string }> {
  const config = await getGDriveConfig();

  // Local File System Mock Fallback
  if (!config.enabled) {
    ensureLocalDirs();
    const targetFolder = path.join(LOCAL_MOCK_ROOT, folderName);
    const filePath = path.join(targetFolder, fileName);
    
    fs.writeFileSync(filePath, content);
    console.log(`[GDrive Mock] File uploaded to: ${filePath}`);
    
    return {
      success: true,
      fileId: `mock-gdrive-id-${Date.now()}`,
      path: `/local-gdrive-mock/${folderName}/${fileName}`,
      message: 'Загружено в локальное хранилище (режим отладки)'
    };
  }

  // Real Google Drive API
  try {
    const gDrive = getDriveClient(config);
    
    // 1. Find or create the subfolder inside the root OrderSystem folder
    const subFolderId = await getOrCreateSubfolder(gDrive, config.folderId, folderName);
    
    // 2. Upload file
    const fileMetadata = {
      name: fileName,
      parents: subFolderId ? [subFolderId] : undefined
    };
    
    // We convert the content to a readable stream for Google API
    const { Readable } = require('stream');
    const media = {
      mimeType,
      body: Readable.from(Buffer.isBuffer(content) ? content : Buffer.from(content))
    };
    
    const response = await gDrive.files.create({
      requestBody: fileMetadata,
      media: media,
      fields: 'id'
    });
    
    return {
      success: true,
      fileId: response.data.id || '',
      message: 'Файл успешно загружен на Google Drive'
    };
  } catch (error: any) {
    console.error('[GDrive Error] Failed to upload:', error);
    
    // If sync is explicitly enabled, we should not fallback to local storage (write permission constraints on Vercel)
    throw new Error(`Ошибка загрузки на Google Drive: ${error.message}`);
  }
}

/**
 * Downloads a file from Google Drive (with local fallback).
 */
export async function downloadFile(
  fileId: string,
  fileName: string,
  folderName: 'Orders' | 'Templates' | 'Users' | 'Logs'
): Promise<Buffer> {
  const config = await getGDriveConfig();

  // Mock Fallback
  if (!config.enabled || fileId.startsWith('mock-')) {
    ensureLocalDirs();
    const filePath = path.join(LOCAL_MOCK_ROOT, folderName, fileName);
    if (!fs.existsSync(filePath)) {
      if (folderName === 'Templates' && fileName === 'default_order_template.xlsx') {
        const rootTemplate = path.join(process.cwd(), 'templates', 'default_order_template.xlsx');
        if (fs.existsSync(rootTemplate)) {
          return fs.readFileSync(rootTemplate);
        }
      }
      throw new Error(`File not found in local mock: ${filePath}`);
    }
    return fs.readFileSync(filePath);
  }

  // Real Google Drive API
  try {
    const gDrive = getDriveClient(config);
    const response = await gDrive.files.get(
      { fileId, alt: 'media' },
      { responseType: 'arraybuffer' }
    );
    
    return Buffer.from(response.data as ArrayBuffer);
  } catch (error: any) {
    console.error('[GDrive Error] Failed to download:', error);
    
    // If it is mock or local fallback, check local storage. Otherwise throw error.
    const filePath = path.join(LOCAL_MOCK_ROOT, folderName, fileName);
    if (fs.existsSync(filePath)) {
      return fs.readFileSync(filePath);
    }
    throw error;
  }
}

/**
 * Deletes a file from Google Drive.
 */
export async function deleteFile(fileId: string): Promise<boolean> {
  const config = await getGDriveConfig();
  if (!config.enabled || fileId.startsWith('mock-')) {
    return true;
  }

  try {
    const gDrive = getDriveClient(config);
    await gDrive.files.delete({ fileId });
    console.log(`[GDrive] File deleted successfully from drive: ${fileId}`);
    return true;
  } catch (error: any) {
    console.error(`[GDrive Error] Failed to delete file ${fileId}:`, error);
    return false;
  }
}

/**
 * Lists templates available in Google Drive Templates folder.
 */
export async function listTemplates(): Promise<Array<{ id: string; name: string }>> {
  const config = await getGDriveConfig();

  if (!config.enabled) {
    ensureLocalDirs();
    const files = fs.readdirSync(LOCAL_TEMPLATES);
    return files.map((f, i) => ({ id: `mock-template-id-${i}`, name: f }));
  }

  try {
    const gDrive = getDriveClient(config);
    const subFolderId = await getOrCreateSubfolder(gDrive, config.folderId, 'Templates');
    
    const response = await gDrive.files.list({
      q: `'${subFolderId}' in parents and trashed = false`,
      fields: 'files(id, name)',
      spaces: 'drive'
    });
    
    return (response.data.files || []).map(f => ({ id: f.id || '', name: f.name || '' }));
  } catch (error) {
    console.error('[GDrive Error] Failed to list templates:', error);
    return [];
  }
}

/**
 * Helper to get or create a folder by name inside the parents folder.
 */
async function getOrCreateSubfolder(gDrive: any, parentId: string | undefined, folderName: string): Promise<string> {
  const query = parentId 
    ? `'${parentId}' in parents and name = '${folderName}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`
    : `name = '${folderName}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;

  const listResponse = await gDrive.files.list({
    q: query,
    fields: 'files(id)',
    spaces: 'drive'
  });

  const files = listResponse.data.files || [];
  if (files.length > 0) {
    return files[0].id;
  }

  // Create folder
  const folderMetadata = {
    name: folderName,
    mimeType: 'application/vnd.google-apps.folder',
    parents: parentId ? [parentId] : undefined
  };

  const createResponse = await gDrive.files.create({
    requestBody: folderMetadata,
    fields: 'id'
  });

  return createResponse.data.id;
}
