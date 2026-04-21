type MetricType = 'render' | 'network' | 'interaction' | 'custom';

interface PerformanceMetric {
  name: string;
  type: MetricType;
  value: number;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

interface PerformanceSummary {
  totalMetrics: number;
  render: { count: number; avgValue: number; maxValue: number };
  network: { count: number; avgValue: number; maxValue: number };
  interaction: { count: number; avgValue: number; maxValue: number };
  custom: { count: number; avgValue: number; maxValue: number };
}

class PerformanceMonitor {
  private metrics: PerformanceMetric[] = [];
  private maxMetrics = 1000;
  private enabled = true;

  enable() {
    this.enabled = true;
  }

  disable() {
    this.enabled = false;
  }

  startMeasure(name: string): () => number {
    if (!this.enabled) {
      return () => 0;
    }

    const startTime = performance.now();
    
    return () => {
      const duration = performance.now() - startTime;
      this.addMetric(name, 'custom', duration);
      return duration;
    };
  }

  measureRender(componentName: string, duration: number) {
    this.addMetric(`render:${componentName}`, 'render', duration);
  }

  measureNetwork(url: string, duration: number, success: boolean) {
    this.addMetric(`network:${url}`, 'network', duration, { success });
  }

  measureInteraction(action: string, duration: number) {
    this.addMetric(`interaction:${action}`, 'interaction', duration);
  }

  private addMetric(
    name: string,
    type: MetricType,
    value: number,
    metadata?: Record<string, unknown>
  ) {
    if (!this.enabled) return;

    if (this.metrics.length >= this.maxMetrics) {
      this.metrics = this.metrics.slice(-Math.floor(this.maxMetrics / 2));
    }

    this.metrics.push({
      name,
      type,
      value,
      timestamp: Date.now(),
      metadata,
    });
  }

  getMetrics(): PerformanceMetric[] {
    return [...this.metrics];
  }

  getMetricsByType(type: MetricType): PerformanceMetric[] {
    return this.metrics.filter((m) => m.type === type);
  }

  getSummary(): PerformanceSummary {
    const calculateStats = (metrics: PerformanceMetric[]) => {
      if (metrics.length === 0) {
        return { count: 0, avgValue: 0, maxValue: 0 };
      }
      const values = metrics.map((m) => m.value);
      return {
        count: metrics.length,
        avgValue: values.reduce((a, b) => a + b, 0) / values.length,
        maxValue: Math.max(...values),
      };
    };

    return {
      totalMetrics: this.metrics.length,
      render: calculateStats(this.getMetricsByType('render')),
      network: calculateStats(this.getMetricsByType('network')),
      interaction: calculateStats(this.getMetricsByType('interaction')),
      custom: calculateStats(this.getMetricsByType('custom')),
    };
  }

  clearMetrics() {
    this.metrics = [];
  }

  logReport() {
    const summary = this.getSummary();
    console.log('📊 Performance Report');
    console.log('=====================');
    console.log(`Total Metrics: ${summary.totalMetrics}`);
    console.log(`\nRender Metrics:`);
    console.log(`  Count: ${summary.render.count}`);
    console.log(`  Avg: ${summary.render.avgValue.toFixed(2)}ms`);
    console.log(`  Max: ${summary.render.maxValue.toFixed(2)}ms`);
    console.log(`\nNetwork Metrics:`);
    console.log(`  Count: ${summary.network.count}`);
    console.log(`  Avg: ${summary.network.avgValue.toFixed(2)}ms`);
    console.log(`  Max: ${summary.network.maxValue.toFixed(2)}ms`);
    console.log(`\nInteraction Metrics:`);
    console.log(`  Count: ${summary.interaction.count}`);
    console.log(`  Avg: ${summary.interaction.avgValue.toFixed(2)}ms`);
    console.log(`  Max: ${summary.interaction.maxValue.toFixed(2)}ms`);
  }

  getWebVitals() {
    if (typeof window === 'undefined') return null;

    const navigation = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;
    if (!navigation) return null;

    return {
      dns: navigation.domainLookupEnd - navigation.domainLookupStart,
      tcp: navigation.connectEnd - navigation.connectStart,
      request: navigation.responseStart - navigation.requestStart,
      response: navigation.responseEnd - navigation.responseStart,
      domProcessing: navigation.domComplete - navigation.domInteractive,
      totalLoad: navigation.loadEventEnd - navigation.fetchStart,
    };
  }
}

export const performanceMonitor = new PerformanceMonitor();

export const measureRender = (componentName: string) => {
  return performanceMonitor.startMeasure(`render:${componentName}`);
};

export const measureAsync = async <T>(
  name: string,
  fn: () => Promise<T>
): Promise<T> => {
  const endMeasure = performanceMonitor.startMeasure(name);
  try {
    return await fn();
  } finally {
    endMeasure();
  }
};

if (typeof window !== 'undefined') {
  (window as unknown as { __performanceMonitor__: typeof performanceMonitor }).__performanceMonitor__ = performanceMonitor;
}
