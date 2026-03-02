import { useState, useEffect } from 'react';

export function useNow(updateInterval = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), updateInterval);
    return () => clearInterval(id);
  }, [updateInterval]);
  return now;
}
