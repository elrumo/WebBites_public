const allowedExtensions = [`chrome-extension://${process.env.VITE_CHROME_EXTENSION_ID}`]

/**
 * Verifies that the request origin is from an allowed Chrome extension
 * @param origin The origin header from the request
 * @returns true if origin is allowed, false otherwise
 */
export function verifyExtensionOrigin(origin: string | undefined): boolean {
  return !!origin && allowedExtensions.includes(origin)
}
