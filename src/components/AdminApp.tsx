import { useEffect, useState } from 'react';

interface UserRow {
  id: number;
  naver_id: string;
  email: string | null;
  name: string | null;
  joined_at: number;
  last_login_at: number;
  marketing_consent: number;
  marketing_consent_at: number | null;
}

interface Data {
  stats: { total: number; consentCount: number; recentCount: number };
  users: UserRow[];
}

const baseUrl = (import.meta.env.BASE_URL ?? '/').replace(/\/$/, '');

function fmt(ts: number | null): string {
  if (!ts) return '-';
  const d = new Date(ts * 1000);
  return d.toISOString().slice(0, 16).replace('T', ' ');
}

export default function AdminApp() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${baseUrl}/api/admin/users`, { credentials: 'include' })
      .then(async (r) => {
        if (r.status === 403) throw new Error('admin 권한 없음');
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then(setData)
      .catch((e) => setError(e.message ?? String(e)));
  }, []);

  if (error)
    return (
      <p className="rounded border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</p>
    );
  if (!data) return <p className="text-sm text-gray-500">로딩 중…</p>;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-3 gap-3">
        <StatCard label="총 사용자" value={data.stats.total} />
        <StatCard label="마케팅 동의자" value={data.stats.consentCount} accent="emerald" />
        <StatCard label="최근 7일 신규" value={data.stats.recentCount} accent="indigo" />
      </div>

      <div className="flex gap-2">
        <a
          href={`${baseUrl}/api/admin/users.csv`}
          className="rounded border border-gray-300 bg-white px-3 py-1.5 text-xs hover:bg-gray-50"
        >
          ⬇ 전체 CSV
        </a>
        <a
          href={`${baseUrl}/api/admin/users.csv?consent=1`}
          className="rounded border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-xs text-emerald-800 hover:bg-emerald-100"
        >
          ⬇ 동의자 CSV (마케팅 발송용)
        </a>
      </div>

      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="min-w-full text-xs">
          <thead className="bg-gray-50 text-gray-600">
            <tr>
              <Th>id</Th>
              <Th>이메일</Th>
              <Th>이름</Th>
              <Th>가입</Th>
              <Th>최근 로그인</Th>
              <Th>마케팅</Th>
            </tr>
          </thead>
          <tbody>
            {data.users.map((u) => (
              <tr key={u.id} className="border-t border-gray-100">
                <Td>{u.id}</Td>
                <Td>{u.email ?? '-'}</Td>
                <Td>{u.name ?? '-'}</Td>
                <Td className="font-mono text-[11px]">{fmt(u.joined_at)}</Td>
                <Td className="font-mono text-[11px]">{fmt(u.last_login_at)}</Td>
                <Td>
                  {u.marketing_consent ? (
                    <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-emerald-800">동의</span>
                  ) : (
                    <span className="text-gray-400">미동의</span>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StatCard({ label, value, accent }: { label: string; value: number; accent?: string }) {
  const accentClass =
    accent === 'emerald'
      ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
      : accent === 'indigo'
        ? 'border-indigo-200 bg-indigo-50 text-indigo-900'
        : 'border-gray-200 bg-white text-gray-900';
  return (
    <div className={`rounded-lg border p-4 ${accentClass}`}>
      <div className="text-xs opacity-70">{label}</div>
      <div className="mt-1 text-2xl font-bold">{value.toLocaleString()}</div>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="px-3 py-2 text-left font-medium">{children}</th>;
}
function Td({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-3 py-2 ${className}`}>{children}</td>;
}
