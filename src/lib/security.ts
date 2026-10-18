import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

/** Derives an AES key from a deployment secret with at least 256 bits of entropy. */
function deriveKey(secret: string): Buffer {
  if (typeof secret !== 'string' || Buffer.byteLength(secret, 'utf8') < 32) {
    throw new Error('Encryption key must contain at least 32 bytes.');
  }
  return crypto.createHash('sha256').update(secret, 'utf8').digest();
}

/** Authenticated backup format: v2:ivHex:tagHex:ciphertextHex. */
export function encrypt(text: string, secret: string): string {
  try {
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, deriveKey(secret), iv);
    const ciphertext = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `v2:${iv.toString('hex')}:${tag.toString('hex')}:${ciphertext.toString('hex')}`;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown encryption error';
    throw new Error(`Encryption failed: ${message}`);
  }
}

/** Legacy unauthenticated CBC backups are rejected and require offline migration. */
export function decrypt(encryptedText: string, secret: string): string {
  try {
    const parts = encryptedText.split(':');
    if (parts.length !== 4 || parts[0] !== 'v2') {
      throw new Error('Unsupported encrypted backup format.');
    }

    const iv = Buffer.from(parts[1], 'hex');
    const tag = Buffer.from(parts[2], 'hex');
    const ciphertext = Buffer.from(parts[3], 'hex');
    if (iv.length !== IV_LENGTH || tag.length !== AUTH_TAG_LENGTH || ciphertext.length === 0) {
      throw new Error('Invalid encrypted backup format.');
    }

    const decipher = crypto.createDecipheriv(ALGORITHM, deriveKey(secret), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown decryption error';
    throw new Error(`Decryption failed: ${message}`);
  }
}

/** Generates a cryptographically secure token. */
export function generateSecureToken(length: number = 32): string {
  return crypto.randomBytes(length).toString('hex');
}
