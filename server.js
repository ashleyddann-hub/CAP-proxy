export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname !== "/get-entities-overdue") {
      return new Response("Not found", { status: 404 });
    }

    // Optional protection between Bubble and the Worker
    if (env.INTERNAL_KEY) {
      const incomingKey = request.headers.get("x-internal-key");
      if (incomingKey !== env.INTERNAL_KEY) {
        return new Response(
          JSON.stringify({ success: false, message: "Forbidden" }),
          {
            status: 403,
            headers: { "content-type": "application/json; charset=utf-8" },
          }
        );
      }
    }

    try {
      const baseUrl = "https://cap-mahtest.civica-cx.com.au";
      const loginPageUrl = `${baseUrl}/Account/Login?ReturnUrl=%2F`;
      const loginPostUrl = `${baseUrl}/Account/Login`;
      const dataUrl = `${baseUrl}/Overview/GetEntitiesOverdue`;

      // 1) Load login page
      const loginPageRes = await fetch(loginPageUrl, {
        headers: {
          accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "user-agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36",
        },
      });

      const loginPageHtml = await loginPageRes.text();

      // More flexible token matching
      const tokenMatch =
        loginPageHtml.match(/name="__RequestVerificationToken"[^>]*value="([^"]+)"/i) ||
        loginPageHtml.match(/value="([^"]+)"[^>]*name="__RequestVerificationToken"/i);

      if (!tokenMatch) {
        return new Response(
          JSON.stringify({
            success: false,
            message: "Could not find __RequestVerificationToken on login page",
            debug: {
              status: loginPageRes.status,
              url: loginPageRes.url,
              snippet: loginPageHtml.slice(0, 500),
            },
          }),
          {
            status: 500,
            headers: { "content-type": "application/json; charset=utf-8" },
          }
        );
      }

      const antiForgeryToken = tokenMatch[1];
      const loginPageCookies = cookiesFromHeaders(loginPageRes.headers);

      // 2) Submit login form
      const loginBody = new URLSearchParams({
        __RequestVerificationToken: antiForgeryToken,
        Username: env.CIVICA_USERNAME,
        Password: env.CIVICA_PASSWORD,
      });

      const loginRes = await fetch(loginPostUrl, {
        method: "POST",
        redirect: "manual",
        headers: {
          accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "content-type": "application/x-www-form-urlencoded",
          origin: baseUrl,
          referer: loginPageUrl,
          cookie: cookieHeaderFromJar(loginPageCookies),
          "user-agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36",
        },
        body: loginBody.toString(),
      });

      const loginResponseCookies = cookiesFromHeaders(loginRes.headers);
      const allCookies = mergeCookieJars(loginPageCookies, loginResponseCookies);

      // If login failed, return useful debug info
      if (loginRes.status !== 302 && loginRes.status !== 200) {
        const text = await loginRes.text();
        return new Response(
          JSON.stringify({
            success: false,
            message: `Login failed: ${loginRes.status}`,
            debug: {
              body: text.slice(0, 500),
              cookies: allCookies,
            },
          }),
          {
            status: 500,
            headers: { "content-type": "application/json; charset=utf-8" },
          }
        );
      }

      // 3) Call target endpoint with authenticated cookies
      const dataRes = await fetch(dataUrl, {
        method: "POST",
        headers: {
          accept: "application/json, text/plain, */*",
          origin: baseUrl,
          referer: `${baseUrl}/`,
          cookie: cookieHeaderFromJar(allCookies),
          "user-agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36",
        },
      });

      const contentType = dataRes.headers.get("content-type") || "";

      if (!dataRes.ok) {
        const text = await dataRes.text();
        return new Response(
          JSON.stringify({
            success: false,
            message: `Data call failed: ${dataRes.status}`,
            debug: {
              body: text.slice(0, 500),
              contentType,
            },
          }),
          {
            status: 500,
            headers: { "content-type": "application/json; charset=utf-8" },
          }
        );
      }

      if (!contentType.includes("application/json")) {
        const text = await dataRes.text();
        return new Response(
          JSON.stringify({
            success: false,
            message: `Unexpected response type: ${contentType}`,
            debug: {
              body: text.slice(0, 500),
            },
          }),
          {
            status: 500,
            headers: { "content-type": "application/json; charset=utf-8" },
          }
        );
      }

      const json = await dataRes.json();

      return new Response(JSON.stringify(json), {
        status: 200,
        headers: {
          "content-type": "application/json; charset=utf-8",
          "cache-control": "no-store",
        },
      });
    } catch (err) {
      return new Response(
        JSON.stringify({
          success: false,
          message: String(err?.message || err),
        }),
        {
          status: 500,
          headers: { "content-type": "application/json; charset=utf-8" },
        }
      );
    }
  },
};

function cookiesFromHeaders(headers) {
  const jar = {};
  const setCookies =
    typeof headers.getSetCookie === "function" ? headers.getSetCookie() : [];

  for (const header of setCookies) {
    const firstPart = header.split(";")[0];
    const eq = firstPart.indexOf("=");
    if (eq > 0) {
      const name = firstPart.slice(0, eq).trim();
      const value = firstPart.slice(eq + 1).trim();
      jar[name] = value;
    }
  }

  return jar;
}

function cookieHeaderFromJar(jar) {
  return Object.entries(jar)
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");
}

function mergeCookieJars(...jars) {
  return Object.assign({}, ...jars);
}
