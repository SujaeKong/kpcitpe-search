/**
 * Admin 권한 체크 — ADMIN_EMAILS (CSV) 환경변수에 등록된 이메일만 통과.
 */
import type { AppUser } from './auth';

interface EnvWithAdmin {
  ADMIN_EMAILS?: string;
}

export function isAdmin(user: AppUser | null, env: EnvWithAdmin): boolean {
  if (!user?.email) return false;
  if (!env.ADMIN_EMAILS) return false;
  const list = env.ADMIN_EMAILS.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  return list.includes(user.email.toLowerCase());
}

export function getAdminEmails(env: EnvWithAdmin): string[] {
  if (!env.ADMIN_EMAILS) return [];
  return env.ADMIN_EMAILS.split(',').map((s) => s.trim()).filter(Boolean);
}
