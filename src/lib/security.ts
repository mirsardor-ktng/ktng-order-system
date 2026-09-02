import crypto from 'crypto';

const ALGORITHM = 'aes-256-cbc';
const IV_LENGTH = 16;

/**
 * Derives a secure 32-byte key from any raw user passphrase.
 */
function deriveKey(passphrase: string): Buffer {
  return crypto.createHash('sha256').update(passphrase).digest();
}

/**
 * Encrypts a string (e.g. stringified JSON) using AES-256-CBC.
 * Returns the result in the format "ivHex:encryptedHex".
 */
export function encrypt(text: string, passphrase: string): string {
  try {
    const key = deriveKey(passphrase);
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    // Combine iv and encrypted content
    return `${iv.toString('hex')}:${encrypted}`;
  } catch (error: any) {
    throw new Error(`Encryption failed: ${error.message}`);
  }
}

/**
 * Decrypts a formatted "ivHex:encryptedHex" string back to raw text.
 */
export function decrypt(encryptedText: string, passphrase: string): string {
  try {
    const parts = encryptedText.split(':');
    if (parts.length !== 2) {
      throw new Error('Invalid encrypted format. Expected "iv:ciphertext"');
    }
    
    const iv = Buffer.from(parts[0], 'hex');
    const ciphertext = Buffer.from(parts[1], 'hex');
    const key = deriveKey(passphrase);
    
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    let decrypted = decipher.update(ciphertext);
    // Node.js typings note that decipher.final() returns Buffer or string depending on update encoding,
    // so we can concatenate Buffer elements and call toString('utf8')
    const finalBuffer = decipher.final();
    
    return Buffer.concat([decrypted, finalBuffer]).toString('utf8');
  } catch (error: any) {
    throw new Error(`Decryption failed: Check key validity. (${error.message})`);
  }
}

/**
 * Generates a random secure token (e.g., for JWT secret or API keys)
 */
export function generateSecureToken(length: number = 32): string {
  return crypto.randomBytes(length).toString('hex');
}
