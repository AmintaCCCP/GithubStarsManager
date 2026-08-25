import { useCallback, useLayoutEffect, useRef } from 'react';

export interface AuthSessionGeneration {
  generation: number;
}

/**
 * Produces a monotonic in-memory generation for the active authentication
 * session. The counter changes even when a user signs out and signs back in
 * with the same credentials, so async work started by the earlier session
 * cannot update the later one.
 */
export const useAuthSessionGeneration = (sessionIdentity: string) => {
  const observedIdentityRef = useRef(sessionIdentity);
  const generationRef = useRef(0);

  useLayoutEffect(() => {
    if (observedIdentityRef.current !== sessionIdentity) {
      observedIdentityRef.current = sessionIdentity;
      generationRef.current += 1;
    }
  }, [sessionIdentity]);

  const captureSession = useCallback((): AuthSessionGeneration => ({
    generation: generationRef.current,
  }), []);

  const isCurrentSession = useCallback((session: AuthSessionGeneration): boolean => (
    session.generation === generationRef.current
  ), []);

  return { captureSession, isCurrentSession };
};
