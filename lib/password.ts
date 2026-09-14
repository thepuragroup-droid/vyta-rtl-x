/**
 * Password utility functions for user management
 */

/**
 * Generate a secure random password
 * @param length - Password length (default: 16)
 * @returns Random password string
 */
export function generatePassword(length: number = 16): string {
  const uppercase = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const lowercase = 'abcdefghijklmnopqrstuvwxyz';
  const numbers = '0123456789';
  const symbols = '!@#$%^&*-_=+';

  const allChars = uppercase + lowercase + numbers + symbols;

  let password = '';

  // Ensure at least one of each type
  password += uppercase[Math.floor(Math.random() * uppercase.length)];
  password += lowercase[Math.floor(Math.random() * lowercase.length)];
  password += numbers[Math.floor(Math.random() * numbers.length)];
  password += symbols[Math.floor(Math.random() * symbols.length)];

  // Fill the rest randomly
  for (let i = password.length; i < length; i++) {
    password += allChars[Math.floor(Math.random() * allChars.length)];
  }

  // Shuffle the password
  return password.split('').sort(() => Math.random() - 0.5).join('');
}

/**
 * Hash a password using bcrypt
 * Note: This should be done on the server side in production
 * For now, we'll use Supabase Auth for password hashing
 *
 * @param password - Plain text password
 * @returns Hashed password (placeholder - use Supabase Auth in production)
 */
export async function hashPassword(password: string): Promise<string> {
  // In production, this should use bcrypt or Supabase Auth
  // For now, we return a placeholder hash
  // TODO: Implement proper password hashing with bcrypt
  return `hashed_${password}`;
}

/**
 * Validate password strength
 * @param password - Password to validate
 * @returns Object with validation result and message
 */
export function validatePassword(password: string): { valid: boolean; message: string } {
  if (password.length < 8) {
    return { valid: false, message: 'Password must be at least 8 characters long' };
  }

  if (!/[A-Z]/.test(password)) {
    return { valid: false, message: 'Password must contain at least one uppercase letter' };
  }

  if (!/[a-z]/.test(password)) {
    return { valid: false, message: 'Password must contain at least one lowercase letter' };
  }

  if (!/[0-9]/.test(password)) {
    return { valid: false, message: 'Password must contain at least one number' };
  }

  if (!/[!@#$%^&*\-_=+]/.test(password)) {
    return { valid: false, message: 'Password must contain at least one special character (!@#$%^&*-_=+)' };
  }

  return { valid: true, message: 'Password is strong' };
}

/**
 * Copy text to clipboard
 * @param text - Text to copy
 * @returns Promise<boolean> - Success status
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (err) {
    console.error('Failed to copy:', err);
    return false;
  }
}
