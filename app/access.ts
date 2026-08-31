import { env } from "cloudflare:workers";
import { cookies } from "next/headers";

const COOKIE_NAME = "matchlab_access";

async function tokenFor(password: string) {
  const bytes = new TextEncoder().encode(`matchlab:${password}`);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash)).map(x=>x.toString(16).padStart(2,"0")).join("");
}

export function configuredPassword() {
  return String((env as any).MATCHLAB_ACCESS_PASSWORD || "");
}

export async function hasMatchLabAccess() {
  const password = configuredPassword();
  if (!password) return false;
  const jar = await cookies();
  return jar.get(COOKIE_NAME)?.value === await tokenFor(password);
}

export async function accessCookieValue() {
  return tokenFor(configuredPassword());
}

export { COOKIE_NAME };
