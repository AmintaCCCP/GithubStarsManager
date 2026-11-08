'use strict';

// Repo Custom Fields 插件页面 model 的纯函数测试：数据规整、草稿校验、
// Markdown 渲染安全性与代码高亮。页面 UI（DOM 交互）不在本文件覆盖范围。
const assert = require('node:assert/strict');
const test = require('node:test');

// model.js 是给浏览器 <script> 用的 UMD 文件（package.json 为 type:module，
// Node 按 ESM 加载并把 API 挂在 globalThis）。
require('../../examples/plugins/repo-custom-fields/ui/model.js');
const model = globalThis.RepoFieldsModel;

test('sanitizeDoc normalizes stored data and survives malformed input', () => {
  assert.deepEqual(model.sanitizeDoc(null), { schema: 1, fields: [] });
  assert.deepEqual(model.sanitizeDoc('junk'), { schema: 1, fields: [] });
  assert.deepEqual(model.sanitizeDoc({ fields: 'nope' }), { schema: 1, fields: [] });

  const doc = model.sanitizeDoc({
    schema: 1,
    fields: [
      { id: 'a', type: 'link', name: '官网', value: 'https://openai.com' },
      { type: 'note', name: '说明', value: '## 标题', format: 'weird' },
      { type: 'unknown', name: 'x', value: 'y' },
      'junk',
      { id: 'b', type: 'text', name: 'x'.repeat(200), value: 'v'.repeat(30000) },
    ],
  });
  assert.equal(doc.schema, 1);
  assert.equal(doc.fields.length, 3);
  assert.deepEqual(doc.fields[0], { id: 'a', type: 'link', name: '官网', value: 'https://openai.com' });
  // 缺失 id 补齐、未知 format 回退为 markdown；未知类型与非法条目被丢弃。
  assert.equal(doc.fields[1].type, 'note');
  assert.match(doc.fields[1].id, /^f_\d+_/);
  assert.deepEqual(
    { ...doc.fields[1], id: 'fixed' },
    { id: 'fixed', type: 'note', name: '说明', value: '## 标题', format: 'markdown' },
  );
  // 超长字符串被截断到上限。
  assert.equal(doc.fields[2].name.length, model.MAX_NAME_CHARS);
  assert.equal(doc.fields[2].value.length, model.MAX_VALUE_CHARS);
});

test('sanitizeDoc caps the number of fields', () => {
  const many = Array.from({ length: model.MAX_FIELDS + 10 }, (_, index) => ({
    id: `f${index}`, type: 'text', name: `n${index}`, value: 'v',
  }));
  assert.equal(model.sanitizeDoc({ fields: many }).fields.length, model.MAX_FIELDS);
});

test('draftToDoc validates names, links and value budgets', () => {
  const ok = model.draftToDoc([
    { id: 'a', type: 'text', name: ' 备注 ', value: 'hello' },
    { id: 'b', type: 'note', name: '说明', value: 'code', format: 'code' },
    { id: 'c', type: 'link', name: '官网', value: '  https://openai.com  ' },
  ]);
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.doc.fields, [
    { id: 'a', type: 'text', name: '备注', value: 'hello' },
    { id: 'b', type: 'note', name: '说明', value: 'code', format: 'code' },
    { id: 'c', type: 'link', name: '官网', value: 'https://openai.com' },
  ]);

  assert.deepEqual(model.draftToDoc([{ id: 'a', type: 'text', name: '   ', value: 'x' }]),
    { ok: false, problems: [{ index: 0, kind: 'name' }] });
  // 链接字段可以不填名称（issue #574：无自定义名时显示链接）。
  const unnamedLink = model.draftToDoc([{ id: 'a', type: 'link', name: '', value: 'https://openai.com' }]);
  assert.equal(unnamedLink.ok, true);
  assert.deepEqual(unnamedLink.doc.fields, [{ id: 'a', type: 'link', name: '', value: 'https://openai.com' }]);
  // 但链接值本身不能为空。
  assert.deepEqual(model.draftToDoc([{ id: 'a', type: 'link', name: '', value: '  ' }]),
    { ok: false, problems: [{ index: 0, kind: 'value' }] });
  assert.deepEqual(model.draftToDoc([{ id: 'a', type: 'link', name: 'L', value: 'ftp://x' }]),
    { ok: false, problems: [{ index: 0, kind: 'value' }] });
  assert.deepEqual(model.draftToDoc([{ id: 'a', type: 'link', name: 'L', value: 'javascript:alert(1)' }]),
    { ok: false, problems: [{ index: 0, kind: 'value' }] });
  assert.deepEqual(model.draftToDoc([{ id: 'a', type: 'text', name: 'N', value: 'x'.repeat(model.MAX_VALUE_CHARS + 1) }]),
    { ok: false, problems: [{ index: 0, kind: 'value' }] });
  const tooMany = Array.from({ length: model.MAX_FIELDS + 1 }, () => ({ type: 'text', name: 'n', value: 'v' }));
  assert.equal(model.draftToDoc(tooMany).ok, false);
});

test('draftToDoc rejects documents that exceed the 64 KiB storage budget', () => {
  const big = Array.from({ length: model.MAX_FIELDS }, (_, index) => ({
    id: `f${index}`, type: 'note', name: `字段${index}`, value: 'x'.repeat(model.MAX_VALUE_CHARS),
  }));
  const result = model.draftToDoc(big);
  assert.equal(result.ok, false);
  assert.deepEqual(result.problems, [{ index: -1, kind: 'doc' }]);

  const small = Array.from({ length: model.MAX_FIELDS }, (_, index) => ({
    id: `f${index}`, type: 'text', name: `字段${index}`, value: '短内容',
  }));
  assert.equal(model.draftToDoc(small).ok, true);
});

test('isExternalUrl mirrors the host shell.openExternal whitelist', () => {
  assert.equal(model.isExternalUrl('https://openai.com'), true);
  assert.equal(model.isExternalUrl('http://example.com/a?b=1&c=2'), true);
  assert.equal(model.isExternalUrl('javascript:alert(1)'), false);
  assert.equal(model.isExternalUrl('file:///etc/passwd'), false);
  assert.equal(model.isExternalUrl('https://'), false);
  assert.equal(model.isExternalUrl(`https://example.com/${'a'.repeat(2100)}`), false);
  assert.equal(model.isExternalUrl(''), false);
  assert.equal(model.isExternalUrl(42), false);
  // 回环与链路本地目标与宿主 network:<host> 权限口径一致：一律拒绝。
  assert.equal(model.isExternalUrl('http://localhost:3000'), false);
  assert.equal(model.isExternalUrl('http://127.0.0.1:8080/'), false);
  assert.equal(model.isExternalUrl('http://[::1]/'), false);
  assert.equal(model.isExternalUrl('http://0.0.0.0/'), false);
  assert.equal(model.isExternalUrl('http://169.254.169.254/latest/meta-data'), false);
  assert.equal(model.isExternalUrl('http://app.localhost/'), false);
  assert.equal(model.isExternalUrl('http://[::]/'), false);
  assert.equal(model.isExternalUrl('http://[fe80::1]/'), false);
  assert.equal(model.isExternalUrl('http://[fd12:3456::1]/'), false);
  assert.equal(model.isExternalUrl('http://[::ffff:127.0.0.1]/'), false);
  assert.equal(model.isExternalUrl('http://[::ffff:169.254.169.254]/'), false);
  assert.equal(model.isExternalUrl('http://[2001:4860:4860::8888]/'), true);
  // 普通内网地址仍允许（外链交给系统浏览器，不是宿主代请求）。
  assert.equal(model.isExternalUrl('http://192.168.1.1/'), true);
});

test('renderMarkdown escapes everything and only emits whitelisted tags', () => {
  const html = model.renderMarkdown([
    '# 标题 <script>alert(1)</script>',
    '',
    '- **粗体** 与 *斜体* 和 ~~删除~~ 以及 `code <img>`',
    '- [链接](https://openai.com) 与 [坏链接](javascript:alert(1))',
    '> 引用 <b>x</b>',
    '',
    '```js',
    'const a = "<script>";',
    '```',
  ].join('\n'));

  assert.equal(html.includes('<script'), false);
  assert.equal(html.includes('<img'), false);
  assert.equal(html.includes('&lt;script&gt;'), true);
  assert.equal(html.includes('<h1>'), true);
  assert.equal(html.includes('<b>粗体</b>'), true);
  assert.equal(html.includes('<i>斜体</i>'), true);
  assert.equal(html.includes('<s>删除</s>'), true);
  assert.equal(html.includes('<code>code &lt;img&gt;</code>'), true);
  // 合法链接生成 data-url；非法 scheme 原样转义为文本。
  assert.equal(html.includes('data-url="https://openai.com"'), true);
  assert.equal(html.includes('[坏链接](javascript:alert(1))'), true);
  assert.equal(html.includes('<blockquote>'), true);
  assert.equal(html.includes('md-code'), true);
  assert.equal(html.includes('tok-keyword'), true);
});

test('renderMarkdown emits blockquote content instead of dropping it', () => {
  const html = model.renderMarkdown('> 第一行\n> 第二行\n\n正文');
  assert.equal(html.includes('<blockquote>'), true);
  assert.equal(html.includes('第一行'), true);
  assert.equal(html.includes('第二行'), true);
  assert.match(html, /<blockquote>[^<]*第一行<br>第二行[^<]*<\/blockquote>/);
  // 引用结束后必须回到普通段落，不能吞掉后文。
  assert.equal(html.includes('<p>正文</p>'), true);
});

test('renderMarkdown links bare URLs and keeps trailing punctuation outside', () => {
  const html = model.renderMarkdown('visit https://openai.com, then https://github.com/A。');
  // ASCII 句读尾巴留在链接外。
  assert.match(html, /data-url="https:\/\/openai\.com">[^<]*<\/span>,/);
  // CJK 句读尾巴留在链接外。
  assert.match(html, /data-url="https:\/\/github\.com\/A">[^<]*<\/span>。/);
  // 与中文直接粘连的 URL 不生成链接，整段按普通文本转义。
  const stuck = model.renderMarkdown('看https://openai.com,以及更多');
  assert.equal(stuck.includes('data-url'), false);
  assert.equal(stuck.includes('&lt;'), false);
});

test('renderMarkdown preserves URL characters that HTML would otherwise mangle', () => {
  const html = model.renderMarkdown('[API](https://example.com/a?x=1&y=2#frag)');
  assert.equal(html.includes('data-url="https://example.com/a?x=1&amp;y=2#frag"'), true);
  // data-url 解码后就是原始 URL，交给 new URL() 仍能还原查询串。
  const url = /data-url="([^"]+)"/.exec(html)[1].replace(/&amp;/g, '&');
  assert.equal(new URL(url).search, '?x=1&y=2');
});

test('highlightCode escapes output and tags strings, comments and keywords', () => {
  const html = model.highlightCode('const url = "<b>"; // trailing');
  assert.equal(html.includes('&lt;b&gt;'), true);
  assert.equal(html.includes('tok-keyword'), true);
  assert.equal(html.includes('tok-string'), true);
  assert.equal(html.includes('tok-comment'), true);
  assert.equal(model.highlightCode(''), '');
  assert.equal(model.highlightCode(null), '');
});

test('docBytes reports UTF-8 JSON size for the storage quota estimate', () => {
  const doc = { schema: 1, fields: [{ id: 'a', type: 'text', name: '名', value: '值' }] };
  assert.equal(model.docBytes(doc), Buffer.byteLength(JSON.stringify(doc), 'utf8'));
  // 浏览器运行时没有 Buffer：docBytes 必须走 TextEncoder 回退，结果一致。
  assert.equal(model.docBytes(doc), new TextEncoder().encode(JSON.stringify(doc)).length);
});

test('renderMarkdown pins data-url attribute injection resistance', () => {
  // 引号试图逃出 data-url 属性；URL 白名单与转义必须让它们失效。
  const cases = [
    '[x](https://a.com/"onmouseover="alert(1))',
    '[x](https://a.com/"><script>alert(1)</script>)',
    'https://a.com/"><img src=x onerror=alert(1)>',
    '[x](https://a.com/)" data-x="1',
    '[x](https://a.com/ onmouseover=alert(1))',
  ];
  for (const source of cases) {
    const html = model.renderMarkdown(source);
    // 处理器名称最多以转义实体出现在属性值里；不允许原始引号提前闭合属性。
    assert.equal(/["']\s*on[a-z]+\s*=/i.test(html), false, source);
    // 不产生白名单之外的原始标签。
    assert.equal(/<(script|img|iframe|svg|a\b)/i.test(html), false, source);
  }
});
