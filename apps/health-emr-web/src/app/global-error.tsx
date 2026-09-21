'use client';

export default function GlobalError({ reset }: { error: Error; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: 'system-ui, sans-serif', padding: '4rem', textAlign: 'center' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700 }}>Something went wrong</h1>
        <p style={{ marginTop: '0.5rem', color: '#3F4653' }}>Please reload the page.</p>
        <button
          onClick={reset}
          style={{
            marginTop: '1.5rem',
            padding: '0.625rem 1.25rem',
            borderRadius: '0.5rem',
            border: 'none',
            background: '#155EEF',
            color: 'white',
            cursor: 'pointer',
          }}
        >
          Try again
        </button>
      </body>
    </html>
  );
}
