import type { SVGProps } from 'react';

/**
 * simple-icons 自 v13 起应微软商标要求移除了 Windows 品牌图标，
 * 这里内联其旧版字形（path 数据为 CC0-1.0），保证 Windows 与其它平台
 * 使用同一套 Simple Icons 品牌图标。
 */
export function SiWindows(props: SVGProps<SVGSVGElement>) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}>
      <path d="M0,0H11.377V11.372H0ZM12.623,0H24V11.372H12.623ZM0,12.623H11.377V24H0Zm12.623,0H24V24H12.623" />
    </svg>
  );
}
