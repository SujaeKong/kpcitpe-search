import type { ReactNode } from 'react';

interface Props {
  variant?: 'source' | 'cert' | 'academy' | 'round' | 'session' | 'default';
  children: ReactNode;
}

const VARIANT_CLASS: Record<NonNullable<Props['variant']>, string> = {
  source: 'bg-indigo-100 text-indigo-800',
  cert: 'bg-emerald-100 text-emerald-800',
  academy: 'bg-amber-100 text-amber-800',
  round: 'bg-slate-100 text-slate-700',
  session: 'bg-slate-100 text-slate-700',
  default: 'bg-gray-100 text-gray-700',
};

export default function Badge({ variant = 'default', children }: Props) {
  return (
    <span
      className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium ${VARIANT_CLASS[variant]}`}
    >
      {children}
    </span>
  );
}
