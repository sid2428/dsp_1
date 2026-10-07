/**
 * Authenticated encryption for the hidden text: PBKDF2-SHA256 derives an AES-256 key from the shared
 * passphrase, AES-GCM encrypts. Frame = salt (16) | iv (12) | ciphertext | tag (16).
 * GCM's tag means a wrong key OR flipped bits are detected instead of silently producing garbage.
 */

const SALT_BYTES = 16
const IV_BYTES = 12
const TAG_BYTES = 16
const PBKDF2_ITERATIONS = 100_000

/** Bytes added on top of the UTF-8 plaintext. */
export const CRYPTO_OVERHEAD = SALT_BYTES + IV_BYTES + TAG_BYTES

export class DecryptError extends Error {
  constructor(message = 'Authentication failed: wrong key or corrupted bits') {
    super(message)
    this.name = 'DecryptError'
  }
}

const encoder = new TextEncoder()
const decoder = new TextDecoder()

export function utf8Length(text: string): number {
  return encoder.encode(text).length
}

async function deriveKey(passphrase: string, salt: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', encoder.encode(passphrase), 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

export async function encryptText(text: string, passphrase: string): Promise<Uint8Array<ArrayBuffer>> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES))
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES))
  const key = await deriveKey(passphrase, salt)
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoder.encode(text)))
  const frame = new Uint8Array(SALT_BYTES + IV_BYTES + ct.length)
  frame.set(salt, 0)
  frame.set(iv, SALT_BYTES)
  frame.set(ct, SALT_BYTES + IV_BYTES)
  return frame
}

export async function decryptText(frame: Uint8Array, passphrase: string): Promise<string> {
  if (frame.length < CRYPTO_OVERHEAD) throw new DecryptError('Payload too short to be a ciphertext')
  const salt = frame.slice(0, SALT_BYTES)
  const iv = frame.slice(SALT_BYTES, SALT_BYTES + IV_BYTES)
  const ct = frame.slice(SALT_BYTES + IV_BYTES)
  const key = await deriveKey(passphrase, salt)
  try {
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct)
    return decoder.decode(pt)
  } catch {
    throw new DecryptError()
  }
}
