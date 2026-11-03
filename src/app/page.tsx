'use client';

import { useEffect, useState } from 'react';
import Board from '@/components/Board';

export default function Home() {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return (
      <div
        style={{
          width: '100vw',
          height: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#0d1117',
          color: '#8b949e',
          fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        }}
      >
        <div
          style={{
            width: 32,
            height: 32,
            border: '3px solid rgba(255, 255, 255, 0.1)',
            borderTopColor: '#6366f1',
            borderRadius: '50%',
            animation: 'canvas-spin 0.8s linear infinite',
            marginBottom: 16,
          }}
        />
        <span style={{ fontSize: 14, fontWeight: 500, letterSpacing: '0.01em' }}>Loading canvas...</span>
        <style>{`
          @keyframes canvas-spin {
            to { transform: rotate(360deg); }
          }
        `}</style>
      </div>
    );
  }

  return <Board />;
}
