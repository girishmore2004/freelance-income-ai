const value = (process.env.NEXT_PUBLIC_API_URL || '').trim();

if (!value) {
  console.error('NEXT_PUBLIC_API_URL is required for a production frontend build.');
  process.exit(1);
}

let parsed;
try {
  parsed = new URL(value);
} catch {
  console.error('NEXT_PUBLIC_API_URL must be a valid absolute URL.');
  process.exit(1);
}

if (parsed.protocol !== 'https:' || !parsed.hostname || parsed.username || parsed.password ||
    parsed.pathname !== '/' || parsed.search || parsed.hash ||
    ['localhost', '127.0.0.1', '0.0.0.0', '::1'].includes(parsed.hostname.toLowerCase())) {
  console.error('NEXT_PUBLIC_API_URL must be an HTTPS API origin without credentials, path, query or fragment.');
  process.exit(1);
}

console.log(`Production API origin configured: ${parsed.origin}`);
