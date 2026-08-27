/*
 * The ONE public address of the app — the origin to put in a link someone will
 * click (assessment invitations, the logo in an email, any absolute URL).
 *
 * FRONTEND_URL is a COMMA-SEPARATED ALLOW-LIST for CORS: the app is reachable on
 * several domains and every backend must accept all of them. It is therefore NOT
 * a URL, and using it as one produced links like
 *
 *   https://assessment.example.com,https://testportal.example.com/assessment/<token>
 *
 * which no browser can open. The first entry is treated as canonical, and
 * PUBLIC_APP_URL overrides it when the address candidates should be sent to is
 * not the first one in the CORS list.
 */
const clean = (u) =>
  String(u || "")
    .replace(/[​-‍﻿]/g, "")
    .trim()
    .replace(/^["']|["']$/g, "")
    .trim()
    .replace(/\/+$/, "");

function publicAppUrl() {
  const explicit = clean(process.env.PUBLIC_APP_URL);
  if (explicit) return explicit;
  // First entry of the CORS allow-list = the canonical public address.
  const first = clean(String(process.env.FRONTEND_URL || "").split(",")[0]);
  return first || "http://localhost:5173";
}

module.exports = { publicAppUrl };
