/**
 * Cryptographically secure random ID and string generator.
 * Avoids Math.random() in security or persistent identifier contexts.
 */

/**
 * Generates a cryptographically secure random hex string.
 *
 * @param bytesCount - The number of random bytes to generate (default: 8).
 * @returns A lowercase hexadecimal string representation of the random bytes.
 * @throws {Error} If no secure random generator is available in the environment.
 */
export const secureRandomString = (bytesCount = 8): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const bytes = new Uint8Array(bytesCount);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  }
  throw new Error('Secure random generator is unavailable');
};

/**
 * Creates a cryptographically secure unique identifier, optionally prefixed.
 * Uses `crypto.randomUUID()` when available with a timestamp and secure random fallback.
 *
 * @param prefix - An optional string prefix to prepend to the generated ID.
 * @returns A unique identifier string formatted with the optional prefix.
 */
export const createSecureId = (prefix?: string): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    const uuid = crypto.randomUUID();
    return prefix ? `${prefix}-${uuid}` : uuid;
  }
  const suffix = secureRandomString(8);
  return prefix ? `${prefix}-${Date.now().toString(36)}-${suffix}` : `${Date.now().toString(36)}-${suffix}`;
};
