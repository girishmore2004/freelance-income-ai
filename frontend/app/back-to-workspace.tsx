'use client';
import Link from 'next/link';
import { useWorkspace } from '@/lib/mode';

/** "Back" from an account page to the workspace the person came from (Admin goes back to Admin). */
export function BackToWorkspace({ className = 'link', label = '← Back to workspace' }: { className?: string; label?: string }) {
  const ws = useWorkspace();
  return <Link className={className} href={ws === 'admin' ? '/admin' : '/workspace'}>{label}</Link>;
}
