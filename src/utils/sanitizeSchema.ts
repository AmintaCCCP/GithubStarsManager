import { defaultSchema } from 'rehype-sanitize';

/**
 * Sanitize schema for markdown rendered with `enableHtml`.
 *
 * Extends hast-util-sanitize's DEFAULT schema just enough to let GitHub Alerts
 * (produced by remark-github-blockquote-alert) survive rehype-sanitize:
 *
 *   <div class="markdown-alert markdown-alert-note" dir="auto">
 *     <p class="markdown-alert-title" dir="auto"><svg class="octicon" viewBox="…" …><path d="…"/></svg>NOTE</p>
 *     …
 *   </div>
 *
 * Remark plugins always run before sanitize, so anything the alert plugin emits
 * must be allow-listed here or it gets stripped. Property names are camelCase
 * because they match hast properties (ariaHidden, not aria-hidden).
 */
export const githubMarkdownSchema = {
  ...defaultSchema,
  tagNames: [...(defaultSchema.tagNames ?? []), 'svg', 'path'],
  attributes: {
    ...defaultSchema.attributes,
    // className is restricted by regex so arbitrary classes in remote README
    // HTML are still stripped — only what the alert plugin emits survives.
    div: [
      ...(defaultSchema.attributes?.div ?? []),
      ['className', /^markdown-alert(-[a-z]+)?$/],
      'dir',
    ],
    p: [
      ...(defaultSchema.attributes?.p ?? []),
      ['className', /^markdown-alert-title$/],
      'dir',
    ],
    svg: [...(defaultSchema.attributes?.svg ?? []), 'className', 'viewBox', 'width', 'height', 'ariaHidden'],
    path: [...(defaultSchema.attributes?.path ?? []), 'd'],
  },
};
