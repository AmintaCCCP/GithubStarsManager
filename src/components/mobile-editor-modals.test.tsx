import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = (name: string) => readFileSync(`src/components/${name}`, 'utf8');

describe('mobile editor modals', () => {
  it('keeps category icon and footer actions usable at mobile widths', () => {
    const category = source('CategoryEditModal.tsx');

    expect(category).toContain('size-11 p-2');
    expect(category).toContain('sm:size-auto');
    expect(category).toContain('grid-cols-4');
    expect(category).toContain('sm:grid-cols-8');
    expect(category).toContain('flex flex-col gap-2 sm:flex-row sm:items-center');
    expect(category).toContain('h-11 gap-1 px-2 py-1');
    expect(category).toContain('sm:h-8');
    expect(category).toContain('flex flex-col gap-3 pt-4');
    expect(category).toContain('sm:flex-row sm:justify-end');
    expect(category).toContain('w-full');
    expect(category).toContain('sm:w-auto');
  });

  it('keeps repository tag and action controls touch-safe and wrapping', () => {
    const repository = source('RepositoryEditModal.tsx');

    expect(repository).toContain('ml-1.5 h-11 w-11 p-0');
    expect(repository).toContain('sm:h-7 sm:w-7');
    expect(repository).toContain('flex flex-col gap-2 sm:flex-row');
    expect(repository).toContain('flex flex-col gap-3 sm:flex-row sm:justify-end');
    expect(repository).toContain('min-w-0 flex-wrap');
    expect(repository).toContain('text-base sm:text-[13px]');
    expect(repository).toContain('h-11 sm:h-auto flex items-center');
  });

  it('reflows gist file controls and preserves readable editable fields', () => {
    const gist = source('GistEditorModal.tsx');

    expect(gist).toContain('flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between');
    expect(gist).toContain('flex min-w-0 items-center gap-2');
    expect(gist).toContain('aria-label={t(`删除文件 ${index + 1}`, `Delete file ${index + 1}`)}');
    expect(gist).toContain('h-11 w-11 rounded-lg p-2');
    expect(gist).toContain('sm:h-auto sm:w-auto');
    expect(gist).toContain('text-base text-foreground');
    expect(gist).toContain('font-mono text-base text-foreground');
    expect(gist).toContain('sm:text-sm');
    expect(gist).toContain('flex flex-col gap-3 sm:flex-row sm:justify-end');
    expect(gist).toContain('w-full');
    expect(gist).toContain('sm:w-auto');
  });
});
