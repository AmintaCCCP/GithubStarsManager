import React, { memo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize from 'rehype-sanitize';
import { useAppStore } from '../store/useAppStore';

interface MarkdownRendererProps {
  content: string;
  className?: string;
  shouldRender?: boolean;
  enableHtml?: boolean;
  baseUrl?: string;
}

const MarkdownLink: React.FC<{ href?: string; children?: React.ReactNode; baseUrl?: string }> = ({ 
  href, 
  children, 
  baseUrl 
}) => {
  if (!href) return <>{children}</>;

  const resolveHref = (link: string): string => {
    if (link.startsWith('http://') || link.startsWith('https://') || link.startsWith('//')) {
      return link;
    }
    if (link.startsWith('#')) {
      return link;
    }
    if (baseUrl) {
      try {
        return new URL(link, baseUrl + '/blob/HEAD/').href;
      } catch {
        return link;
      }
    }
    return link;
  };

  const resolvedHref = resolveHref(href);
  const isHashLink = href.startsWith('#');

  return (
    <a
      href={resolvedHref}
      target={isHashLink ? undefined : "_blank"}
      rel={isHashLink ? undefined : "noopener noreferrer"}
      className="text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 underline decoration-blue-400 hover:decoration-blue-600 transition-colors"
      onClick={(e) => e.stopPropagation()}
    >
      {children}
    </a>
  );
};

const MarkdownImage: React.FC<{ src?: string; alt?: string; baseUrl?: string }> = ({ 
  src, 
  alt, 
  baseUrl 
}) => {
  const [hasError, setHasError] = React.useState(false);
  const { language } = useAppStore();
  
  if (!src) return null;

  const resolveImageSrc = (imageSrc: string): string => {
    if (imageSrc.startsWith('http://') || imageSrc.startsWith('https://') || imageSrc.startsWith('//')) {
      return imageSrc;
    }
    if (baseUrl) {
      try {
        return new URL(imageSrc, baseUrl + '/raw/HEAD/').href;
      } catch {
        return imageSrc;
      }
    }
    return imageSrc;
  };

  const imageUrl = resolveImageSrc(src);

  if (hasError) {
    return (
      <span className="text-gray-500 italic">
        [{language === 'zh' ? '图片加载失败' : 'Image failed to load'}: {alt || 'image'}]
      </span>
    );
  }

  return (
    <img
      src={imageUrl}
      alt={alt || ''}
      className="max-w-full h-auto rounded-lg my-4"
      onError={() => setHasError(true)}
    />
  );
};

const MarkdownRenderer: React.FC<MarkdownRendererProps> = memo(({ 
  content, 
  className = '', 
  shouldRender = true,
  enableHtml = false,
  baseUrl
}) => {
  if (!shouldRender) {
    return <div className="h-32 flex items-center justify-center text-gray-400">Loading...</div>;
  }

  const remarkPlugins = [remarkGfm, remarkBreaks];
  const rehypePlugins = enableHtml ? [rehypeRaw, rehypeSanitize] : [];

  return (
    <div className={`prose prose-sm dark:prose-invert max-w-none ${className}`}>
      <ReactMarkdown
        remarkPlugins={remarkPlugins}
        rehypePlugins={rehypePlugins}
        components={{
          a: (props) => <MarkdownLink {...props} baseUrl={baseUrl} />,
          img: (props) => <MarkdownImage {...props} baseUrl={baseUrl} />,
          h1: ({ children }) => <h1 className="text-lg font-bold text-gray-900 dark:text-white mt-4 mb-2">{children}</h1>,
          h2: ({ children }) => <h2 className="text-base font-semibold text-gray-800 dark:text-gray-200 mt-3 mb-2">{children}</h2>,
          h3: ({ children }) => <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mt-2 mb-1">{children}</h3>,
          p: ({ children }) => <p className="text-gray-700 dark:text-gray-300 mb-2 leading-relaxed">{children}</p>,
          ul: ({ children }) => <ul className="list-disc list-inside text-gray-700 dark:text-gray-300 mb-2 space-y-1">{children}</ul>,
          ol: ({ children }) => <ol className="list-decimal list-inside text-gray-700 dark:text-gray-300 mb-2 space-y-1">{children}</ol>,
          li: ({ children }) => <li className="ml-2">{children}</li>,
          code: ({ className, children, ...props }) => {
            const isInline = !className;
            return isInline ? (
              <code className="px-1.5 py-0.5 bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200 rounded text-xs font-mono" {...props}>
                {children}
              </code>
            ) : (
              <code className="text-xs font-mono text-gray-800 dark:text-gray-200" {...props}>
                {children}
              </code>
            );
          },
          pre: ({ children }) => (
            <pre className="bg-gray-100 dark:bg-gray-800 p-3 rounded-lg overflow-x-auto my-3">
              {children}
            </pre>
          ),
          blockquote: ({ children }) => (
            <blockquote className="border-l-4 border-blue-400 dark:border-blue-600 pl-4 py-1 my-2 text-gray-600 dark:text-gray-400 italic bg-gray-50 dark:bg-gray-800/50 rounded-r">
              {children}
            </blockquote>
          ),
          hr: () => <hr className="my-4 border-gray-200 dark:border-gray-700" />,
          table: ({ children }) => (
            <div className="overflow-x-auto my-3">
              <table className="min-w-full border-collapse border border-gray-200 dark:border-gray-700 text-sm">
                {children}
              </table>
            </div>
          ),
          thead: ({ children }) => <thead className="bg-gray-100 dark:bg-gray-800">{children}</thead>,
          th: ({ children }) => (
            <th className="border border-gray-200 dark:border-gray-700 px-3 py-2 text-left font-semibold text-gray-800 dark:text-gray-200">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="border border-gray-200 dark:border-gray-700 px-3 py-2 text-gray-700 dark:text-gray-300">
              {children}
            </td>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
});

MarkdownRenderer.displayName = 'MarkdownRenderer';

export default MarkdownRenderer;
