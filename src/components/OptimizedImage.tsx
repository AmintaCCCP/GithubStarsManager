import React, { useState, useRef, useEffect, memo, useCallback } from 'react';

interface OptimizedImageProps {
  src: string;
  alt: string;
  className?: string;
  width?: number;
  height?: number;
  placeholder?: string;
  lazy?: boolean;
  onLoad?: () => void;
  onError?: () => void;
}

const placeholderSrc = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"%3E%3Crect fill="%23f3f4f6" width="40" height="40"/%3E%3C/svg%3E';

export const OptimizedImage: React.FC<OptimizedImageProps> = memo(({
  src,
  alt,
  className = '',
  width,
  height,
  placeholder = placeholderSrc,
  lazy = true,
  onLoad,
  onError,
}) => {
  const [isLoaded, setIsLoaded] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [isInView, setIsInView] = useState(!lazy);
  const imgRef = useRef<HTMLImageElement>(null);
  const observerRef = useRef<IntersectionObserver | null>(null);

  useEffect(() => {
    if (!lazy || !imgRef.current) return;

    observerRef.current = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsInView(true);
          observerRef.current?.disconnect();
        }
      },
      {
        rootMargin: '50px',
        threshold: 0.01,
      }
    );

    observerRef.current.observe(imgRef.current);

    return () => {
      observerRef.current?.disconnect();
    };
  }, [lazy]);

  const handleLoad = useCallback(() => {
    setIsLoaded(true);
    onLoad?.();
  }, [onLoad]);

  const handleError = useCallback(() => {
    setHasError(true);
    onError?.();
  }, [onError]);

  const actualSrc = isInView ? src : placeholder;
  const showPlaceholder = !isLoaded && !hasError;

  return (
    <div
      className={`relative overflow-hidden ${className}`}
      style={{ width, height }}
    >
      {showPlaceholder && (
        <div
          className="absolute inset-0 bg-gray-200 dark:bg-gray-700 animate-pulse"
          style={{ width, height }}
        />
      )}
      <img
        ref={imgRef}
        src={hasError ? placeholder : actualSrc}
        alt={alt}
        width={width}
        height={height}
        loading={lazy ? 'lazy' : 'eager'}
        decoding="async"
        onLoad={handleLoad}
        onError={handleError}
        className={`
          transition-opacity duration-200
          ${isLoaded ? 'opacity-100' : 'opacity-0'}
          ${className}
        `}
        style={{
          width: width || '100%',
          height: height || 'auto',
        }}
      />
    </div>
  );
});

OptimizedImage.displayName = 'OptimizedImage';

interface AvatarImageProps {
  src: string;
  alt: string;
  size?: number;
  className?: string;
}

export const AvatarImage: React.FC<AvatarImageProps> = memo(({
  src,
  alt,
  size = 40,
  className = '',
}) => {
  return (
    <OptimizedImage
      src={src}
      alt={alt}
      width={size}
      height={size}
      className={`rounded-full object-cover ${className}`}
      lazy
    />
  );
});

AvatarImage.displayName = 'AvatarImage';

interface ResourcePreloader {
  preloadImage: (src: string) => Promise<void>;
  preloadImages: (srcs: string[]) => Promise<void>;
  prefetchComponent: (importFn: () => Promise<unknown>) => void;
}

export const resourcePreloader: ResourcePreloader = {
  preloadImage: (src: string): Promise<void> => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve();
      img.onerror = reject;
      img.src = src;
    });
  },

  preloadImages: async (srcs: string[]): Promise<void> => {
    await Promise.all(srcs.map(src => resourcePreloader.preloadImage(src)));
  },

  prefetchComponent: (importFn: () => Promise<unknown>): void => {
    if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
      requestIdleCallback(() => {
        importFn();
      });
    } else {
      setTimeout(() => {
        importFn();
      }, 100);
    }
  },
};

export const useImagePreloader = () => {
  const preloadedImages = useRef(new Set<string>());

  const preloadImage = useCallback(async (src: string) => {
    if (preloadedImages.current.has(src)) return;
    
    try {
      await resourcePreloader.preloadImage(src);
      preloadedImages.current.add(src);
    } catch (error) {
      console.warn('Failed to preload image:', src, error);
    }
  }, []);

  const preloadImages = useCallback(async (srcs: string[]) => {
    await Promise.all(srcs.map(preloadImage));
  }, [preloadImage]);

  return { preloadImage, preloadImages };
};

export const useComponentPrefetch = () => {
  const prefetchedComponents = useRef(new Set<string>());

  const prefetchComponent = useCallback((name: string, importFn: () => Promise<unknown>) => {
    if (prefetchedComponents.current.has(name)) return;
    
    resourcePreloader.prefetchComponent(importFn);
    prefetchedComponents.current.add(name);
  }, []);

  return { prefetchComponent };
};
