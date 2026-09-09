import { createClient, SupabaseClient } from '@supabase/supabase-js';
import sharp from 'sharp';

export const STORAGE_BUCKET = 'product-images';
export const MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

export const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp'
]);

export const ALLOWED_IMAGE_FORMATS = new Set([
  'jpeg',
  'jpg',
  'png',
  'webp'
]);

let supabaseAdminClient: SupabaseClient | null = null;
let bucketEnsured = false;

/**
 * Resolves Supabase credentials from environment variables.
 * Fallback to deriving project URL from DATABASE_URL if not explicitly set.
 */
function getSupabaseConfig(): { url: string; serviceKey: string } {
  let url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;

  if (!url && process.env.DATABASE_URL) {
    const dbUrl = process.env.DATABASE_URL;
    const match = dbUrl.match(/postgres\.([a-z0-9]+):/i) || dbUrl.match(/@([a-z0-9]+)\.supabase/i);
    if (match && match[1]) {
      url = `https://${match[1]}.supabase.co`;
    }
  }

  if (!url || !serviceKey) {
    throw new Error(
      'STORAGE_CONFIG_ERROR: Переменные окружения NEXT_PUBLIC_SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY должны быть установлены для работы с Supabase Storage.'
    );
  }

  return { url, serviceKey };
}

/**
 * Returns a server-side Supabase client with administrative privileges.
 * NEVER expose this client or the service role key to the frontend.
 */
export function getSupabaseAdmin(): SupabaseClient {
  if (supabaseAdminClient) return supabaseAdminClient;

  const { url, serviceKey } = getSupabaseConfig();
  supabaseAdminClient = createClient(url, serviceKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  });

  return supabaseAdminClient;
}

/**
 * Ensures the target public storage bucket exists in Supabase.
 */
export async function ensureStorageBucket(): Promise<void> {
  if (bucketEnsured) return;

  const supabase = getSupabaseAdmin();
  try {
    const { data: bucket, error: getErr } = await supabase.storage.getBucket(STORAGE_BUCKET);
    if (bucket && !getErr) {
      bucketEnsured = true;
      return;
    }

    // Try to create public bucket if missing
    const { error: createErr } = await supabase.storage.createBucket(STORAGE_BUCKET, {
      public: true,
      fileSizeLimit: MAX_IMAGE_SIZE_BYTES,
      allowedMimeTypes: Array.from(ALLOWED_MIME_TYPES)
    });

    if (createErr && !createErr.message.includes('already exists')) {
      console.warn(`[Supabase Storage] Could not create bucket "${STORAGE_BUCKET}":`, createErr.message);
    } else {
      bucketEnsured = true;
    }
  } catch (err: any) {
    console.warn(`[Supabase Storage] ensureStorageBucket check failed:`, err?.message);
  }
}

export interface ProcessedImage {
  buffer: Buffer;
  width?: number;
  height?: number;
  format: string;
}

/**
 * Validates file size and real image format, then processes and converts to WebP.
 * Runs completely in memory (Buffer) without touching the local filesystem.
 */
export async function validateAndProcessImage(fileBuffer: Buffer): Promise<ProcessedImage> {
  if (!fileBuffer || fileBuffer.length === 0) {
    throw new Error('Файл изображения пуст.');
  }

  if (fileBuffer.length > MAX_IMAGE_SIZE_BYTES) {
    throw new Error('Размер изображения не должен превышать 10 MB.');
  }

  let metadata: sharp.Metadata;
  try {
    metadata = await sharp(fileBuffer).metadata();
  } catch (err) {
    throw new Error('Поддерживаются только JPG, PNG и WebP.');
  }

  const format = metadata.format?.toLowerCase();
  if (!format || !ALLOWED_IMAGE_FORMATS.has(format)) {
    throw new Error('Поддерживаются только JPG, PNG и WebP.');
  }

  try {
    const webpBuffer = await sharp(fileBuffer)
      .rotate() // Auto-orient based on EXIF
      .resize(1200, 1200, {
        fit: 'inside',
        withoutEnlargement: true
      })
      .webp({ quality: 82 })
      .toBuffer();

    return {
      buffer: webpBuffer,
      width: metadata.width,
      height: metadata.height,
      format: 'webp'
    };
  } catch (err: any) {
    console.error('[Sharp Processing Error]', err);
    throw new Error('Не удалось обработать изображение.');
  }
}

/**
 * Uploads an image to Supabase Storage and returns its public URL.
 */
export async function uploadProductImage(
  productId: string,
  fileBuffer: Buffer
): Promise<{ success: boolean; imageUrl: string; objectKey: string }> {
  await ensureStorageBucket();
  const supabase = getSupabaseAdmin();

  // Validate and optimize in memory
  const processed = await validateAndProcessImage(fileBuffer);

  // Safe unique filename: {productId}-{timestamp}.webp
  const cleanId = productId.replace(/[^a-zA-Z0-9_-]/g, '');
  const objectKey = `${cleanId}-${Date.now()}.webp`;

  const { error: uploadError } = await supabase.storage
    .from(STORAGE_BUCKET)
    .upload(objectKey, processed.buffer, {
      contentType: 'image/webp',
      cacheControl: '31536000',
      upsert: true
    });

  if (uploadError) {
    console.error('[Supabase Storage Upload Error]', uploadError);
    throw new Error(`Не удалось загрузить изображение в хранилище: ${uploadError.message}`);
  }

  const { data: publicData } = supabase.storage
    .from(STORAGE_BUCKET)
    .getPublicUrl(objectKey);

  return {
    success: true,
    imageUrl: publicData.publicUrl,
    objectKey
  };
}

/**
 * Extracts object key from a Supabase Storage public URL.
 */
export function extractStorageObjectKey(imageUrlOrKey: string): string | null {
  if (!imageUrlOrKey || imageUrlOrKey === 'default-pack') return null;

  // Pattern 1: Raw object key
  if (!imageUrlOrKey.startsWith('http') && !imageUrlOrKey.startsWith('/')) {
    return imageUrlOrKey;
  }

  // Pattern 2: Supabase Storage public URL: .../storage/v1/object/public/product-images/{objectKey}
  const bucketMarker = `/${STORAGE_BUCKET}/`;
  const idx = imageUrlOrKey.indexOf(bucketMarker);
  if (idx !== -1) {
    const rawKey = imageUrlOrKey.substring(idx + bucketMarker.length);
    // Strip query parameters if any
    return rawKey.split('?')[0];
  }

  return null;
}

/**
 * Deletes an image from Supabase Storage by URL or key.
 * Safely catches and logs errors without throwing so product operations continue.
 */
export async function deleteProductImage(imageUrlOrKey: string): Promise<boolean> {
  const objectKey = extractStorageObjectKey(imageUrlOrKey);
  if (!objectKey) return false;

  try {
    const supabase = getSupabaseAdmin();
    const { error } = await supabase.storage.from(STORAGE_BUCKET).remove([objectKey]);
    if (error) {
      console.warn(`[Supabase Storage Delete Warning] Failed to delete ${objectKey}:`, error.message);
      return false;
    }
    return true;
  } catch (err: any) {
    console.warn(`[Supabase Storage Delete Warning] Error removing ${objectKey}:`, err?.message);
    return false;
  }
}
