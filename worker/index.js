const ALLOWED_ORIGIN = "https://jb1111111111.github.io";
const BUSINESS_UNITS = [6184, 6186, 6185, 6188, 6187];
const CUSTOMER_ID = 1370766;
const API_BASE = "https://friskissvettis.brpsystems.com/brponline/api/ver3";

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-App-Password",
    "Vary": "Origin"
  };
}
function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders(), "Content-Type": "application/json; charset=utf-8" }
  });
}
async function brpLogin(env) {
  const response = await fetch(`${API_BASE}/auth/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json", "Accept": "application/json",
      "X-Request-Source": "mobilityweb",
      "Origin": "https://friskissvettis.goactivebooking.com",
      "Referer": "https://friskissvettis.goactivebooking.com/"
    },
    body: JSON.stringify({ username: env.BRP_USERNAME, password: env.BRP_PASSWORD })
  });
  if (!response.ok) throw new Error(`BRP login failed (${response.status})`);
  const data = await response.json();
  if (!data.access_token) throw new Error("BRP returned no access token");
  return data.access_token;
}
function brpHeaders(token) {
  return {
    "Authorization": `Bearer ${token}`, "Accept": "application/json", "Content-Type": "application/json",
    "X-Request-Source": "mobilityweb",
    "Origin": "https://friskissvettis.goactivebooking.com",
    "Referer": "https://friskissvettis.goactivebooking.com/"
  };
}
async function readBrpResponse(response) {
  const text = await response.text();
  if (!text) return null;
  try { return JSON.parse(text); } catch { return { message: text.slice(0, 1000) }; }
}
export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    if (origin && origin !== ALLOWED_ORIGIN) return new Response("Origin not allowed", { status: 403 });
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders() });
    const url = new URL(request.url);
    if (url.pathname === "/" && request.method === "GET") return jsonResponse({ message: "Friskis API is running. Use /classes." });
    if (!env.BRP_USERNAME || !env.BRP_PASSWORD) return jsonResponse({ error: "BRP credentials are not configured" }, 500);
    try {
      if (request.method === "GET" && url.pathname === "/classes") {
        const token = await brpLogin(env);
        const now = new Date();
        const end = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
        const params = new URLSearchParams();
        for (const id of BUSINESS_UNITS) params.append("businessUnit", String(id));
        params.set("customer", String(CUSTOMER_ID));
        params.set("groupActivitiesFor", "web");
        params.set("period.start", now.toISOString());
        params.set("period.end", end.toISOString());
        params.set("webCategory", "22");
        const response = await fetch(`${API_BASE}/apps/59/groupactivities?${params.toString()}`, { headers: brpHeaders(token) });
        const data = await readBrpResponse(response);
        if (!response.ok) return jsonResponse({ error: "Could not fetch classes from BRP", status: response.status, details: data }, 502);
        const activities = Array.isArray(data) ? data : data?.groupActivities || data?.items || data?.data || data?.results || [];
        const classes = activities.filter(activity => BUSINESS_UNITS.includes(Number(activity.businessUnit?.id)) && !activity.cancelled && activity.duration?.start);
        return jsonResponse({ groupActivities: classes, count: classes.length, fetchedAt: new Date().toISOString() });
      }
      if (request.method === "POST" || request.method === "DELETE") {
        if (!env.APP_PASSWORD) return jsonResponse({ error: "APP_PASSWORD is not configured in Cloudflare" }, 503);
        const supplied = request.headers.get("X-App-Password") || "";
        if (supplied.length !== env.APP_PASSWORD.length || supplied !== env.APP_PASSWORD) return jsonResponse({ error: "Fel bokningslösenord" }, 401);
        const token = await brpLogin(env);
        if (request.method === "POST" && url.pathname === "/bookings") {
          let body;
          try { body = await request.json(); } catch { return jsonResponse({ error: "Invalid JSON body" }, 400); }
          const groupActivity = Number(body?.groupActivity);
          if (!Number.isSafeInteger(groupActivity) || groupActivity <= 0) return jsonResponse({ error: "groupActivity måste vara ett giltigt aktivitets-ID" }, 400);
          const response = await fetch(`${API_BASE}/customers/${CUSTOMER_ID}/bookings/groupactivities`, {
            method: "POST", headers: brpHeaders(token),
            body: JSON.stringify({ groupActivity, allowWaitingList: body?.allowWaitingList === true })
          });
          const data = await readBrpResponse(response);
          if (!response.ok) return jsonResponse({ error: "BRP kunde inte boka passet", status: response.status, details: data }, response.status >= 400 && response.status < 500 ? response.status : 502);
          return jsonResponse({ success: true, booking: data }, response.status);
        }
        const match = url.pathname.match(/^\/bookings\/(\d+)$/);
        if (request.method === "DELETE" && match) {
          const bookingId = match[1];
          const response = await fetch(`${API_BASE}/customers/${CUSTOMER_ID}/bookings/groupactivities/${bookingId}?allowLateCancellationWithNoShow=false&bookingType=groupActivityBooking`, {
            method: "DELETE", headers: brpHeaders(token)
          });
          const data = await readBrpResponse(response);
          if (!response.ok) return jsonResponse({ error: "BRP kunde inte avboka passet", status: response.status, details: data }, response.status >= 400 && response.status < 500 ? response.status : 502);
          return jsonResponse({ success: true, bookingId }, 200);
        }
      }
      return jsonResponse({ error: "Not found or method not allowed" }, 404);
    } catch (error) {
      return jsonResponse({ error: "Unexpected server error", message: String(error.message || error) }, 500);
    }
  }
};
