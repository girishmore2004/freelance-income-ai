import http from 'k6/http';
import { check, sleep } from 'k6';

const base = (__ENV.API_BASE_URL || 'http://127.0.0.1:8000').replace(/\\/$/, '');
const token = __ENV.API_TOKEN || '';

export const options = {
  stages: [
    { duration: '20s', target: 2 },
    { duration: '40s', target: 5 },
    { duration: '20s', target: 0 },
  ],
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<1500'],
  },
};

export default function () {
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  const response = http.get(`${base}/health`, { headers, tags: { endpoint: 'health' } });
  check(response, {
    'health returns HTTP 200': (r) => r.status === 200,
    'health response is JSON': (r) => (r.headers['Content-Type'] || '').includes('application/json'),
  });
  sleep(1);
}
