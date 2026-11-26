const ALLOWED_ORIGIN = "https://jb1111111111.github.io";

const BUSINESS_UNITS = [6184, 6186, 6185, 6188, 6187];

const API_BASE =
  "https://friskissvettis.brpsystems.com/brponline/api/ver3";

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Vary": "Origin"
  };
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders(),
      "Content-Type": "application/json; charset=utf-8"
    }
  });
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";

    if (origin && origin !== ALLOWED_ORIGIN) {
      return new Response("Origin not allowed", { status: 403 });
    }

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders()
      });
    }

    if (request.method !== "GET") {
      return jsonResponse({ error: "Method not allowed" }, 405);
    }

    const url = new URL(request.url);

    if (url.pathname !== "/classes") {
      return jsonResponse({
        message: "Friskis API is running. Use /classes to fetch classes."
      });
    }

    if (!env.BRP_USERNAME || !env.BRP_PASSWORD) {
      return jsonResponse({
        error: "BRP credentials are not configured"
      }, 500);
    }

    try {
      // 1. Logga in hos BRP.
      const loginResponse = await fetch(`${API_BASE}/auth/login`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json",
          "X-Request-Source": "mobilityweb",
          "Origin": "https://friskissvettis.goactivebooking.com",
          "Referer": "https://friskissvettis.goactivebooking.com/"
        },
        body: JSON.stringify({
          username: env.BRP_USERNAME,
          password: env.BRP_PASSWORD
        })
      });

      if (!loginResponse.ok) {
        return jsonResponse({
          error: "BRP login failed",
          status: loginResponse.status
        }, 502);
      }

      const loginData = await loginResponse.json();
      const token = loginData.access_token;

      if (!token) {
        return jsonResponse({
          error: "No access token received from BRP"
        }, 502);
      }

      // BRP kräver att sökperioden är högst 14 dagar.
      const now = new Date();
      const end = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);

      const params = new URLSearchParams();

      for (const id of BUSINESS_UNITS) {
        params.append("businessUnit", String(id));
      }

      params.set("customer", "1370766");
      params.set("groupActivitiesFor", "web");
      params.set("period.start", now.toISOString());
      params.set("period.end", end.toISOString());
      params.set("webCategory", "22");

      // 2. Hämta gruppaktiviteter.
      const classesResponse = await fetch(
        `${API_BASE}/apps/59/groupactivities?${params.toString()}`,
        {
          headers: {
            "Authorization": `Bearer ${token}`,
            "Accept": "application/json",
            "X-Request-Source": "mobilityweb",
            "Origin": "https://friskissvettis.goactivebooking.com",
            "Referer": "https://friskissvettis.goactivebooking.com/"
          }
        }
      );

      if (!classesResponse.ok) {
        const errorText = await classesResponse.text();

        return jsonResponse({
          error: "Could not fetch classes from BRP",
          status: classesResponse.status,
          details: errorText.slice(0, 1000)
        }, 502);
      }

      const data = await classesResponse.json();

      // 3. Hitta listan med aktiviteter.
      const activities = Array.isArray(data)
        ? data
        : data.groupActivities ||
          data.items ||
          data.data ||
          data.results ||
          [];

      // Behåll alla ej inställda pass, även fullbokade.
      const classes = activities.filter(activity =>
        BUSINESS_UNITS.includes(Number(activity.businessUnit?.id)) &&
        !activity.cancelled &&
        activity.duration?.start
      );

      return jsonResponse({
        groupActivities: classes,
        count: classes.length,
        fetchedAt: new Date().toISOString()
      });
    } catch (error) {
      return jsonResponse({
        error: "Unexpected server error",
        message: String(error.message || error)
      }, 500);
    }
  }
};
