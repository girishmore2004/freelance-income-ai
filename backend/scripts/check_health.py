#!/usr/bin/env python3
"""Small deployment health probe; uses only Python's standard library."""
import argparse
import sys
import urllib.error
import urllib.request


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--url', default='http://127.0.0.1:8000/health')
    parser.add_argument('--timeout', type=float, default=8.0)
    args = parser.parse_args()
    request = urllib.request.Request(args.url, headers={'Accept': 'application/json'})
    try:
        with urllib.request.urlopen(request, timeout=args.timeout) as response:
            body = response.read(4096).decode('utf-8', errors='replace')
            if response.status != 200:
                print(f'Health check failed: HTTP {response.status}')
                return 1
            print(f'Health check passed: HTTP {response.status}')
            print(body)
            return 0
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        print(f'Health check failed: {exc}', file=sys.stderr)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
