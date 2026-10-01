/**
 * Derive a safe download-file extension from a blob's MIME type.
 *
 * `blob.type.split('/')[1]` is not sufficient: `image/svg+xml` yields `svg+xml`
 * and parameterized types yield `plain;charset=utf-8`, both of which produce
 * unusable file names. Structured subtypes are mapped explicitly and anything
 * unexpected falls back to `png`.
 */
const MIME_EXTENSION_OVERRIDES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/svg+xml': 'svg',
  'image/x-icon': 'ico',
  'image/vnd.microsoft.icon': 'ico',
  'image/bmp': 'bmp',
  'image/tiff': 'tiff',
  'image/avif': 'avif',
};

export const imageExtensionForMimeType = (mimeType: string | null | undefined): string => {
  const normalized = (mimeType ?? '').split(';')[0].trim().toLowerCase();
  const override = MIME_EXTENSION_OVERRIDES[normalized];
  if (override) return override;

  const subtype = normalized.startsWith('image/') ? normalized.slice('image/'.length) : '';
  const sanitized = subtype.split('+')[0].replace(/[^a-z0-9]/g, '');
  return sanitized || 'png';
};
