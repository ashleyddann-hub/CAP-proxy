const express = require("express");
const axios = require("axios");
const cheerio = require("cheerio");
const crypto = require("crypto");

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const PORT = process.env.PORT || 3000;
const CIVICA_BASE_URL = process.env.CIVICA_BASE_URL || "https://cap-mahtest.civica-cx.com.au";

// In-memory session store: app token -> Civica cookie jar
// Note: this resets if Render restarts.
const sessions = new Map();

app.get("/", (_req, res) => {
  res.json({ success: true, message: "Civica proxy is running" });
});

app.post("/auth/login", async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({
        success: false,
        message: "Username and password are required",
      });
    }

    const loginPageUrl = `${CIVICA_BASE_URL}/Account/Login?ReturnUrl=%2F`;
    const loginPostUrl = `${CIVICA_BASE_URL}/Account/Login`;

    // 1) Get login page
    const loginPageRes = await axios.get(loginPageUrl, {
      headers: {
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36",
      },
      validateStatus: () => true,
    });

    const loginPageHtml = loginPageRes.data;

    // 2) Extract anti-forgery token
    const tokenMatch =
      String(loginPageHtml).match(/name="__RequestVerificationToken"[^>]*value="([^"]+)"/i) ||
      String(loginPageHtml).match(/value="([^"]+)"[^>]*name="__RequestVerificationToken"/i);

    if (!tokenMatch) {
      return res.status(500).json({
        success: false,
        message: "Could not find __RequestVerificationToken on login page",
      });
    }

    const antiForgeryToken = tokenMatch[1];

    // 3) Collect cookies from login page
    const loginPageCookies = cookiesFromSetCookie(loginPageRes.headers["set-cookie"]);

    // 4) Submit login form
    const loginBody = new URLSearchParams({
      __RequestVerificationToken: antiForgeryToken,
      Username: username,
      Password: password,
    });

    const loginRes = await axios.post(loginPostUrl, loginBody.toString(), {
      headers: {
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "content-type": "application/x-www-form-urlencoded",
        origin: CIVICA_BASE_URL,
        referer: loginPageUrl,
        cookie: cookieHeaderFromJar(loginPageCookies),
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36",
      },
      maxRedirects: 0,
      validateStatus: (status) => status >= 200 && status < 400,
    });

    const loginResponseCookies = cookiesFromSetCookie(loginRes.headers["set-cookie"]);
    const allCookies = mergeCookieJars(loginPageCookies, loginResponseCookies);
    const cookieHeader = cookieHeaderFromJar(allCookies);

    // 5) Basic check: if auth cookie is missing, login likely failed
    if (!allCookies[".AspNet.ApplicationCookie"]) {
      return res.status(401).json({
        success: false,
        message: "Login did not return application cookie",
      });
    }

    // 6) Create app session token
    const sessionToken = crypto.randomUUID();

    sessions.set(sessionToken, {
      cookieHeader,
      createdAt: Date.now(),
      username,
    });

    return res.json({
      success: true,
      session_token: sessionToken,
      user_name: username,
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: String(err?.message || err),
    });
  }
});

app.get("/get-entities-overdue", async (req, res) => {
  try {
    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

    if (!token) {
      return res.status(401).json({
        success: false,
        message: "Missing Bearer token",
      });
    }

    const session = sessions.get(token);
    if (!session) {
      return res.status(401).json({
        success: false,
        message: "Invalid or expired session token",
      });
    }

    const dataUrl = `${CIVICA_BASE_URL}/Overview/GetEntitiesOverdue`;

    const dataRes = await axios.post(dataUrl, null, {
      headers: {
        accept: "application/json, text/plain, */*",
        origin: CIVICA_BASE_URL,
        referer: `${CIVICA_BASE_URL}/`,
        cookie: session.cookieHeader,
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36",
      },
      validateStatus: () => true,
    });

    if (dataRes.status < 200 || dataRes.status >= 300) {
      return res.status(dataRes.status).json({
        success: false,
        message: "Civica data call failed",
        status: dataRes.status,
      });
    }

    return res.json(dataRes.data);
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: String(err?.message || err),
    });
  }
});

app.post("/logout", (req, res) => {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

  if (token) {
    sessions.delete(token);
  }

  res.json({ success: true });
});

app.listen(PORT, () => {
  console.log(`Listening on ${PORT}`);
});

function cookiesFromSetCookie(setCookieHeaders = []) {
  const jar = {};
  for (const header of setCookieHeaders) {
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
