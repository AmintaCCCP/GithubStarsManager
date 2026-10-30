import { useEffect, useMemo, useState } from 'react';
import type { DeviceTarget } from '../types/installableAsset';
import {
  detectDevicePlatformSync,
  resolveDeviceArchitectureDetails,
  type DeviceArchitectureResolution,
} from '../utils/deviceTarget';

export function useDeviceTarget(): DeviceTarget {
  const [platform] = useState(() => detectDevicePlatformSync());
  const [resolution, setResolution] = useState<DeviceArchitectureResolution>({
    architecture: undefined,
    source: 'none',
  });
  const [architectureSettled, setArchitectureSettled] = useState(false);

  useEffect(() => {
    let active = true;
    void resolveDeviceArchitectureDetails().then((next) => {
      if (!active) return;
      setResolution(next);
      setArchitectureSettled(true);
    });
    return () => {
      active = false;
    };
  }, []);

  return useMemo(() => ({
    platform,
    architecture: resolution.architecture,
    architectureSource: resolution.source,
    architectureSettled,
  }), [platform, resolution, architectureSettled]);
}
