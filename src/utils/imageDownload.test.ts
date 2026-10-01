import { describe, expect, it } from 'vitest';
import { imageExtensionForMimeType } from './imageDownload';

describe('imageExtensionForMimeType', () => {
  it('keeps simple image subtypes', () => {
    expect(imageExtensionForMimeType('image/png')).toBe('png');
    expect(imageExtensionForMimeType('image/gif')).toBe('gif');
    expect(imageExtensionForMimeType('image/webp')).toBe('webp');
  });

  it('maps structured subtypes to usable extensions', () => {
    expect(imageExtensionForMimeType('image/svg+xml')).toBe('svg');
    expect(imageExtensionForMimeType('image/jpeg')).toBe('jpg');
    expect(imageExtensionForMimeType('image/vnd.microsoft.icon')).toBe('ico');
  });

  it('strips MIME parameters before deriving the extension', () => {
    expect(imageExtensionForMimeType('image/png;charset=utf-8')).toBe('png');
    expect(imageExtensionForMimeType('text/plain;charset=utf-8')).toBe('png');
  });

  it('falls back to png for missing or non-image types', () => {
    expect(imageExtensionForMimeType('')).toBe('png');
    expect(imageExtensionForMimeType(undefined)).toBe('png');
    expect(imageExtensionForMimeType(null)).toBe('png');
    expect(imageExtensionForMimeType('application/octet-stream')).toBe('png');
  });

  it('never returns characters that are invalid in a file name', () => {
    for (const mime of ['image/svg+xml', 'image/png;charset=utf-8', 'image/x-weird+yaml', 'nonsense']) {
      expect(imageExtensionForMimeType(mime)).toMatch(/^[a-z0-9]+$/);
    }
  });
});
