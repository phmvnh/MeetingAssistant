const fs = require("node:fs/promises");
const http = require("node:http");
const path = require("node:path");
const { randomBytes } = require("node:crypto");

const { google } = require("googleapis");

const GOOGLE_WORKSPACE_SCOPES = Object.freeze([
  "https://www.googleapis.com/auth/documents",
  "https://www.googleapis.com/auth/drive",
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/calendar",
]);
const GOOGLE_SCOPES = Object.freeze([
  "openid",
  "https://www.googleapis.com/auth/userinfo.email",
  ...GOOGLE_WORKSPACE_SCOPES,
]);

const GOOGLE_AUTH_REQUIRED_MESSAGE =
  "Google OAuth chưa được cấp quyền. Bấm “Đăng nhập Google” trong ứng dụng.";
const GOOGLE_REAUTH_REQUIRED_MESSAGE =
  "Phiên đăng nhập Google đã hết hạn hoặc bị thu hồi. Hãy kết nối lại tài khoản Google.";
const GOOGLE_AUTH_TIMEOUT_MS = 5 * 60 * 1000;

function resolveProjectPath(filePath) {
  return path.isAbsolute(filePath) ? filePath : path.join(process.cwd(), filePath);
}

function getDependencies(options = {}) {
  const dependencies = options.dependencies || {};

  return {
    fs: dependencies.fs || fs,
    google: dependencies.google || google,
    http: dependencies.http || http,
    randomBytes: dependencies.randomBytes || randomBytes,
  };
}

function createGoogleAuthError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function createAuthRequiredError() {
  return createGoogleAuthError(
    "GOOGLE_AUTH_REQUIRED",
    GOOGLE_AUTH_REQUIRED_MESSAGE,
  );
}

function createReauthRequiredError() {
  return createGoogleAuthError(
    "GOOGLE_REAUTH_REQUIRED",
    GOOGLE_REAUTH_REQUIRED_MESSAGE,
  );
}

function createAuthCancelledError(message = "Đã hủy phiên đăng nhập Google cũ.") {
  return createGoogleAuthError("GOOGLE_AUTH_CANCELLED", message);
}

function getErrorStatus(error) {
  const status = Number(
    error?.response?.status || error?.response?.statusCode || error?.status,
  );

  return Number.isFinite(status) ? status : null;
}

function isGoogleReauthFailure(error) {
  if (error?.code === "GOOGLE_REAUTH_REQUIRED") {
    return true;
  }

  if (getErrorStatus(error) === 401 || Number(error?.code) === 401) {
    return true;
  }

  const errorDetails = [
    error?.code,
    error?.message,
    error?.response?.data?.error,
    error?.response?.data?.error_description,
    error?.response?.data?.error?.status,
    error?.response?.data?.error?.message,
  ]
    .filter((value) => value !== undefined && value !== null)
    .map((value) => (typeof value === "string" ? value : JSON.stringify(value)))
    .join(" ");

  return /invalid[_ -]grant|invalid[_ -]token|token[^.]{0,40}(expired|revoked)|no refresh token/i.test(
    errorDetails,
  );
}

async function readJson(filePath, label, fsApi = fs) {
  try {
    return JSON.parse(await fsApi.readFile(filePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new Error(`Không tìm thấy ${label}: ${filePath}`);
    }

    throw new Error(`${label} không phải JSON hợp lệ: ${error.message}`);
  }
}

async function readStoredOAuthToken(tokenPath, fsApi = fs) {
  try {
    const token = JSON.parse(await fsApi.readFile(tokenPath, "utf8"));

    if (!token || typeof token !== "object" || Array.isArray(token)) {
      throw new Error("Token phải là một JSON object.");
    }

    return token;
  } catch (error) {
    if (error.code === "ENOENT") {
      return null;
    }

    // A corrupt token is equivalent to a revoked one. Do not expose its raw
    // content or parser details to the renderer/logs.
    throw createReauthRequiredError();
  }
}

function getOAuthAppCredentials(credentials) {
  const appCredentials = credentials.installed || credentials.web;

  if (!appCredentials?.client_id || !appCredentials?.client_secret) {
    throw new Error(
      "oauth_credentials.json phải là OAuth Client ID loại Desktop app.",
    );
  }

  return appCredentials;
}

async function saveToken(tokenPath, credentials, options = {}) {
  const { fs: fsApi, randomBytes: randomBytesFn } = getDependencies(options);
  const tokenDirectory = path.dirname(tokenPath);
  const temporaryPath = path.join(
    tokenDirectory,
    `${path.basename(tokenPath)}.${process.pid}.${randomBytesFn(8).toString("hex")}.tmp`,
  );
  let renamed = false;

  await fsApi.mkdir(tokenDirectory, { recursive: true });

  try {
    await fsApi.writeFile(temporaryPath, JSON.stringify(credentials, null, 2), {
      encoding: "utf8",
      mode: 0o600,
    });

    if (options.signal?.aborted) {
      throw createAuthCancelledError();
    }

    await fsApi.rename(temporaryPath, tokenPath);
    renamed = true;
  } finally {
    if (!renamed) {
      await fsApi.unlink(temporaryPath).catch(() => {});
    }
  }
}

function createOAuthClientInstance(appCredentials, redirectUri, googleApi = google) {
  return new googleApi.auth.OAuth2(
    appCredentials.client_id,
    appCredentials.client_secret,
    redirectUri,
  );
}

function attachTokenPersistence(client, tokenPath, initialToken, options = {}) {
  if (typeof client.on !== "function") {
    return;
  }

  let persistedToken = { ...initialToken };

  client.on("tokens", (newTokens) => {
    persistedToken = { ...persistedToken, ...newTokens };
    void saveToken(tokenPath, persistedToken, options).catch(() => {
      // A later authenticated operation can still succeed with the token in
      // memory. Persistence errors must never leak credentials to the UI.
    });
  });
}

async function validateStoredOAuthClient(client, storedToken) {
  const hasRefreshToken = Boolean(storedToken.refresh_token);
  const hasAccessToken = Boolean(storedToken.access_token);
  const expiryDate = Number(storedToken.expiry_date);
  const isExpiredAccessToken =
    Number.isFinite(expiryDate) && expiryDate <= Date.now() + 30_000;

  if (!hasRefreshToken && (!hasAccessToken || isExpiredAccessToken)) {
    throw createReauthRequiredError();
  }

  try {
    const accessTokenResult = await client.getAccessToken();
    const accessToken =
      typeof accessTokenResult === "string"
        ? accessTokenResult
        : accessTokenResult?.token;

    if (!accessToken) {
      throw createReauthRequiredError();
    }

    // getAccessToken refreshes expired credentials. getTokenInfo additionally
    // detects a still-unexpired access token that was revoked out-of-band.
    if (typeof client.getTokenInfo === "function") {
      await client.getTokenInfo(accessToken);
    }

    return client;
  } catch (error) {
    if (isGoogleReauthFailure(error)) {
      throw createReauthRequiredError();
    }

    throw createGoogleAuthError(
      "GOOGLE_AUTH_CHECK_FAILED",
      "Không thể kiểm tra phiên đăng nhập Google. Hãy kiểm tra kết nối mạng và thử lại.",
    );
  }
}

function shouldForceInteractiveAuthorization(options = {}) {
  return Boolean(
    options.forceAccountSelection ||
      options.forceInteractive ||
      options.forceReauth ||
      options.switchAccount,
  );
}

async function createOAuthClient(config, options = {}) {
  const dependencies = getDependencies(options);
  const credentialsPath = resolveProjectPath(config.oauthCredentialsPath);
  const tokenPath = resolveProjectPath(config.tokenPath);
  const credentials = await readJson(
    credentialsPath,
    "OAuth credentials",
    dependencies.fs,
  );
  const appCredentials = getOAuthAppCredentials(credentials);
  const forceInteractive = shouldForceInteractiveAuthorization(options);
  let token = null;

  try {
    token = await readStoredOAuthToken(tokenPath, dependencies.fs);
  } catch (error) {
    if (
      error.code !== "GOOGLE_REAUTH_REQUIRED" ||
      (!options.interactive && !forceInteractive)
    ) {
      throw error;
    }
    // Keep even a corrupt token file in place until replacement authorization
    // succeeds; saveToken will atomically replace it at the end of the flow.
  }

  if (token && !forceInteractive) {
    const client = createOAuthClientInstance(
      appCredentials,
      undefined,
      dependencies.google,
    );
    client.setCredentials(token);

    try {
      await validateStoredOAuthClient(client, token);
      const refreshedToken = { ...token, ...client.credentials };

      if (JSON.stringify(refreshedToken) !== JSON.stringify(token)) {
        await saveToken(tokenPath, refreshedToken, { dependencies });
      }

      attachTokenPersistence(client, tokenPath, refreshedToken, {
        dependencies,
      });
      return client;
    } catch (error) {
      if (
        error.code !== "GOOGLE_REAUTH_REQUIRED" ||
        !options.interactive
      ) {
        throw error;
      }
      // An explicit login click may repair a stale token. The old token file is
      // intentionally kept until the replacement flow completes successfully.
    }
  }

  const interactive = Boolean(options.interactive || forceInteractive);

  if (!interactive) {
    if (token) {
      throw createReauthRequiredError();
    }

    throw createAuthRequiredError();
  }

  if (typeof options.openExternal !== "function") {
    throw new Error("Thiếu hàm mở trình duyệt cho Google OAuth.");
  }

  const authorize = options.authorizeWithLoopback || authorizeWithLoopback;

  return authorize({
    appCredentials,
    tokenPath,
    openExternal: options.openExternal,
    dependencies,
    signal: options.signal,
    timeoutMs: options.authorizationTimeoutMs,
  });
}

function createOAuthAuthorizationUrl(client, state) {
  return client.generateAuthUrl({
    access_type: "offline",
    include_granted_scopes: true,
    prompt: "select_account consent",
    scope: GOOGLE_SCOPES,
    state,
  });
}

function toPublicInteractiveError(error) {
  if (error?.code?.startsWith?.("GOOGLE_")) {
    return error;
  }

  return createGoogleAuthError(
    "GOOGLE_AUTH_FAILED",
    "Không thể hoàn tất đăng nhập Google. Hãy đóng tab này và thử lại.",
  );
}

async function authorizeWithLoopback({
  appCredentials,
  tokenPath,
  openExternal,
  dependencies: providedDependencies,
  signal,
  timeoutMs = GOOGLE_AUTH_TIMEOUT_MS,
}) {
  const dependencies = getDependencies({
    dependencies: providedDependencies,
  });
  const state = dependencies.randomBytes(24).toString("hex");

  return new Promise((resolve, reject) => {
    const server = dependencies.http.createServer();
    let settled = false;
    let timeoutHandle = null;

    const finish = (error, client) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeoutHandle);
      signal?.removeEventListener("abort", handleAbort);

      if (server.listening) {
        server.close();
      }

      if (error) {
        reject(error);
      } else {
        resolve(client);
      }
    };

    const handleAbort = () => finish(createAuthCancelledError());

    if (signal?.aborted) {
      handleAbort();
      return;
    }

    signal?.addEventListener("abort", handleAbort, { once: true });
    timeoutHandle = setTimeout(() => {
      finish(
        createGoogleAuthError(
          "GOOGLE_AUTH_TIMEOUT",
          "Phiên đăng nhập Google đã hết thời gian chờ. Hãy bấm Đăng nhập Google để thử lại.",
        ),
      );
    }, Math.max(1_000, Number(timeoutMs) || GOOGLE_AUTH_TIMEOUT_MS));

    server.on("request", async (request, response) => {
      try {
        if (settled || signal?.aborted) {
          response.writeHead(410, {
            "Content-Type": "text/plain; charset=utf-8",
          });
          response.end("Phiên đăng nhập Google này không còn hiệu lực.");
          return;
        }

        const requestUrl = new URL(request.url, "http://127.0.0.1");

        if (requestUrl.pathname !== "/oauth2callback") {
          response.writeHead(404).end("Not found");
          return;
        }

        if (requestUrl.searchParams.get("state") !== state) {
          throw createGoogleAuthError(
            "GOOGLE_AUTH_FAILED",
            "Google OAuth state không hợp lệ.",
          );
        }

        const oauthError = requestUrl.searchParams.get("error");

        if (oauthError) {
          throw createGoogleAuthError(
            oauthError === "access_denied"
              ? "GOOGLE_AUTH_CANCELLED"
              : "GOOGLE_AUTH_FAILED",
            oauthError === "access_denied"
              ? "Bạn đã hủy đăng nhập Google."
              : "Google từ chối cấp quyền.",
          );
        }

        const code = requestUrl.searchParams.get("code");

        if (!code) {
          throw createGoogleAuthError(
            "GOOGLE_AUTH_FAILED",
            "Google OAuth không trả về authorization code.",
          );
        }

        const address = server.address();
        const redirectUri = `http://127.0.0.1:${address.port}/oauth2callback`;
        const client = createOAuthClientInstance(
          appCredentials,
          redirectUri,
          dependencies.google,
        );
        const { tokens } = await client.getToken(code);

        if (settled || signal?.aborted) {
          response.writeHead(410, {
            "Content-Type": "text/plain; charset=utf-8",
          });
          response.end("Phiên đăng nhập Google này đã bị hủy.");
          return;
        }

        if (!tokens?.access_token && !tokens?.refresh_token) {
          throw createGoogleAuthError(
            "GOOGLE_AUTH_FAILED",
            "Google OAuth không trả về token hợp lệ.",
          );
        }

        client.setCredentials(tokens);

        // Atomic replacement means a failed account switch never destroys the
        // previously working token.
        await saveToken(tokenPath, tokens, { dependencies, signal });

        if (settled || signal?.aborted) {
          response.writeHead(410, {
            "Content-Type": "text/plain; charset=utf-8",
          });
          response.end("Phiên đăng nhập Google này đã bị hủy.");
          return;
        }

        attachTokenPersistence(client, tokenPath, tokens, { dependencies });

        response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        response.end(
          "<h1>Đăng nhập Google thành công</h1><p>Bạn có thể đóng tab này và quay lại Meeting Assistant.</p>",
        );
        finish(null, client);
      } catch (error) {
        const publicError = toPublicInteractiveError(error);
        response.writeHead(400, {
          "Content-Type": "text/plain; charset=utf-8",
        });
        response.end(publicError.message);
        finish(publicError);
      }
    });

    server.on("error", () =>
      finish(
        createGoogleAuthError(
          "GOOGLE_AUTH_FAILED",
          "Không thể mở cổng đăng nhập Google trên máy này.",
        ),
      ),
    );
    server.listen(0, "127.0.0.1", async () => {
      try {
        if (settled || signal?.aborted) {
          server.close();
          return;
        }

        const address = server.address();
        const redirectUri = `http://127.0.0.1:${address.port}/oauth2callback`;
        const client = createOAuthClientInstance(
          appCredentials,
          redirectUri,
          dependencies.google,
        );
        const authUrl = createOAuthAuthorizationUrl(client, state);

        await openExternal(authUrl);
      } catch (error) {
        finish(toPublicInteractiveError(error));
      }
    });
  });
}

function profileFromIdToken(auth) {
  const idToken = auth?.credentials?.id_token;

  if (typeof idToken !== "string") {
    return null;
  }

  try {
    const payload = JSON.parse(
      Buffer.from(idToken.split(".")[1], "base64url").toString("utf8"),
    );

    return {
      email: payload.email || null,
      displayName: payload.name || null,
      photoUrl: payload.picture || null,
    };
  } catch {
    return null;
  }
}

function normalizeAccountProfile(profile = {}) {
  const normalized = {
    email: profile.email || profile.emailAddress || null,
    displayName: profile.name || profile.displayName || null,
    photoUrl: profile.picture || profile.photoLink || profile.photoUrl || null,
  };

  return Object.values(normalized).some(Boolean) ? normalized : null;
}

async function getGoogleAccountProfile(auth, options = {}) {
  const dependencies = getDependencies(options);
  const idTokenProfile = profileFromIdToken(auth);
  const localProfile = normalizeAccountProfile({
    ...(idTokenProfile || {}),
    email: idTokenProfile?.email || auth?.email || null,
  });
  let oauthProfile = null;
  let driveProfile = null;

  try {
    if (typeof dependencies.google.oauth2 === "function") {
      const oauth2 = dependencies.google.oauth2({ version: "v2", auth });
      const response = await oauth2.userinfo.get();
      oauthProfile = normalizeAccountProfile(response?.data);
    }
  } catch (error) {
    if (isGoogleReauthFailure(error)) {
      throw createReauthRequiredError();
    }
  }

  // Older stored grants do not have userinfo.email, but Drive's about endpoint
  // can still identify the account because this app already has Drive scope.
  if (!oauthProfile?.email) {
    try {
      if (typeof dependencies.google.drive === "function") {
        const drive = dependencies.google.drive({ version: "v3", auth });
        const response = await drive.about.get({
          fields: "user(displayName,emailAddress,photoLink)",
        });
        driveProfile = normalizeAccountProfile(response?.data?.user);
      }
    } catch (error) {
      if (isGoogleReauthFailure(error)) {
        throw createReauthRequiredError();
      }
    }
  }

  return normalizeAccountProfile({
    ...(localProfile || {}),
    ...(driveProfile || {}),
    ...(oauthProfile || {}),
  });
}

async function getGoogleAuthClient(config, options = {}) {
  if (config.authMode === "oauth") {
    return createOAuthClient(config, options);
  }

  const dependencies = getDependencies(options);
  const keyFile = resolveProjectPath(config.serviceAccountPath);
  const auth = new dependencies.google.auth.GoogleAuth({
    keyFile,
    scopes: GOOGLE_WORKSPACE_SCOPES,
  });

  return auth.getClient();
}

async function getGoogleAuthStatus(config, options = {}) {
  const authMode = config?.authMode || "unknown";

  try {
    const auth = await getGoogleAuthClient(config, {
      dependencies: options.dependencies,
      interactive: false,
    });
    const account =
      authMode === "oauth"
        ? await getGoogleAccountProfile(auth, {
            dependencies: options.dependencies,
          })
        : normalizeAccountProfile({
            email: auth?.email || auth?.credentials?.client_email || null,
          });

    return {
      authMode,
      authorized: true,
      requiresAuthorization: false,
      requiresReauth: false,
      account,
      accountEmail: account?.email || null,
      errorCode: null,
      message: null,
    };
  } catch (error) {
    const knownCode = [
      "GOOGLE_AUTH_REQUIRED",
      "GOOGLE_REAUTH_REQUIRED",
      "GOOGLE_AUTH_CHECK_FAILED",
    ].includes(error?.code);

    return {
      authMode,
      authorized: false,
      requiresAuthorization: error?.code === "GOOGLE_AUTH_REQUIRED",
      requiresReauth: error?.code === "GOOGLE_REAUTH_REQUIRED",
      account: null,
      accountEmail: null,
      errorCode: knownCode ? error.code : "GOOGLE_AUTH_UNAVAILABLE",
      message: knownCode
        ? error.message
        : "Không thể kiểm tra cấu hình đăng nhập Google.",
    };
  }
}

async function disconnectGoogleAccount(config, options = {}) {
  if (config.authMode !== "oauth") {
    return {
      authMode: config.authMode,
      disconnected: false,
      revoked: false,
    };
  }

  const dependencies = getDependencies(options);
  const tokenPath = resolveProjectPath(config.tokenPath);
  let tokenExists = false;

  try {
    await dependencies.fs.readFile(tokenPath, "utf8");
    tokenExists = true;
  } catch (error) {
    if (error.code !== "ENOENT") {
      tokenExists = true;
    }
  }

  try {
    await dependencies.fs.unlink(tokenPath);
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw createGoogleAuthError(
        "GOOGLE_DISCONNECT_FAILED",
        "Không thể xóa phiên đăng nhập Google trên máy này.",
      );
    }
  }

  return {
    authMode: config.authMode,
    disconnected: tokenExists,
    revoked: false,
  };
}

module.exports = {
  GOOGLE_AUTH_TIMEOUT_MS,
  GOOGLE_AUTH_REQUIRED_MESSAGE,
  GOOGLE_REAUTH_REQUIRED_MESSAGE,
  GOOGLE_SCOPES,
  GOOGLE_WORKSPACE_SCOPES,
  authorizeWithLoopback,
  createOAuthAuthorizationUrl,
  createOAuthClient,
  disconnectGoogleAccount,
  getGoogleAccountProfile,
  getGoogleAuthClient,
  getGoogleAuthStatus,
  isGoogleReauthFailure,
  resolveProjectPath,
  saveToken,
  validateStoredOAuthClient,
};
