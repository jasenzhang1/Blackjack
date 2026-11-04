/** Minimal hash router (works from file:// and any static host without rewrites). */
import { useEffect, useState, type MouseEvent, type ReactNode } from 'react';

function current(): string {
  const h = window.location.hash.replace(/^#/, '');
  return h.startsWith('/') ? h.split('?')[0] : '/';
}

export function useRoute(): string {
  const [path, setPath] = useState(current);
  useEffect(() => {
    const on = () => {
      setPath(current());
      window.scrollTo({ top: 0 });
    };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return path;
}

export function navigate(to: string): void {
  window.location.hash = to;
}

export function Link({ to, children, className, onClick }: { to: string; children: ReactNode; className?: string; onClick?: () => void }) {
  const active = current() === to;
  return (
    <a
      href={`#${to}`}
      className={[className, active ? 'active' : ''].filter(Boolean).join(' ')}
      aria-current={active ? 'page' : undefined}
      onClick={(e: MouseEvent) => {
        if (e.metaKey || e.ctrlKey) return;
        onClick?.();
      }}
    >
      {children}
    </a>
  );
}
