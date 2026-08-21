const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { EventEmitter } = require("node:events");

const {
  authorizeWithLoopback,
  createOAuthAuthorizationUrl,
  disconnectGoogleAccount,
  getGoogleAuthClient,
  getGoogleAuthStatus,
  saveToken,
} = require("../src/google/auth");

async function createFixture(token) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "meeting-auth-test-"));
  const credentialsPath = path.join(directory, "oauth_credentials.json");
  const tokenPath = path.join(directory, "token.json");
  await fs.writeFile(
    credentialsPath,
    JSON.stringify({
      installed: {
        client_id: "test-client-id",
        client_secret: "test-client-secret",
      },
    }),
  );

  if (token) {
    await fs.writeFile(tokenPath, JSON.stringify(token));
  }

  return {
    config: {
      authMode: "oauth",
      oauthCredentialsPath: credentialsPath,
      tokenPath,
    },
    directory,
    tokenPath,
  };
}

function createFakeGoogle(options = {}) {
  const clients = [];

  class OAuth2 extends EventEmitter {
    constructor() {
      super();
      this.credentials = {};
      clients.push(this);
    }

    setCredentials(credentials) {
      this.credentials = { ...credentials };
    }

    async getAccessToken() {
      if (options.accessTokenError) {
        throw options.accessTokenError;
      }

      if (options.refreshedToken) {
        this.credentials = { ...this.credentials, ...options.refreshedToken };
      }

      return { token: this.credentials.access_token || "valid-access-token" };
    }

    async getTokenInfo(token) {
      assert.ok(token);
      if (options.tokenInfoError) {
        throw options.tokenInfoError;
      }
      return { scopes: [] };
    }

    generateAuthUrl(authOptions) {
      this.authOptions = authOptions;
      return "https://accounts.google.test/authorize";
    }
  }

  class GoogleAuth {
    constructor(authOptions) {
      this.options = authOptions;
    }

    async getClient() {
      return options.serviceClient || { email: "service@example.test" };
    }
  }

  return {
    clients,
    google: {
      auth: { GoogleAuth, OAuth2 },
      oauth2: () => ({
        userinfo: {
          get: async () => ({
            data: options.profile || {
              email: "person@example.test",
              name: "Test Person",
            },
          }),
        },
      }),
    },
  };
}

test("stored OAuth token is validated, refreshed, and persisted", async (t) => {
  const fixture = await createFixture({
    access_token: "expired-access-token",
    refresh_token: "refresh-token",
    expiry_date: Date.now() - 60_000,
  });
  t.after(() => fs.rm(fixture.directory, { recursive: true, force: true }));
  const fake = createFakeGoogle({
    refreshedToken: {
      access_token: "fresh-access-token",
      expiry_date: Date.now() + 3_600_000,
    },
  });

  const client = await getGoogleAuthClient(fixture.config, {
    dependencies: { google: fake.google },
  });
  const persisted = JSON.parse(await fs.readFile(fixture.tokenPath, "utf8"));

  assert.equal(client.credentials.access_token, "fresh-access-token");
  assert.equal(persisted.access_token, "fresh-access-token");
  assert.equal(persisted.refresh_token, "refresh-token");
});

test("invalid_grant becomes one safe GOOGLE_REAUTH_REQUIRED error", async (t) => {
  const fixture = await createFixture({
    refresh_token: "sensitive-refresh-token",
  });
  t.after(() => fs.rm(fixture.directory, { recursive: true, force: true }));
  const fake = createFakeGoogle({
    accessTokenError: {
      response: {
        data: {
          error: "invalid_grant",
          error_description: "secret server details",
        },
      },
    },
  });

  await assert.rejects(
    getGoogleAuthClient(fixture.config, {
      dependencies: { google: fake.google },
    }),
    (error) => {
      assert.equal(error.code, "GOOGLE_REAUTH_REQUIRED");
      assert.match(error.message, /kết nối lại tài khoản Google/i);
      assert.doesNotMatch(error.message, /secret|refresh-token|invalid_grant/i);
      return true;
    },
  );
});

test("forced account selection keeps the old token when login fails", async (t) => {
  const oldToken = {
    access_token: "old-access-token",
    refresh_token: "old-refresh-token",
    expiry_date: Date.now() + 3_600_000,
  };
  const fixture = await createFixture(oldToken);
  t.after(() => fs.rm(fixture.directory, { recursive: true, force: true }));
  const fake = createFakeGoogle();

  await assert.rejects(
    getGoogleAuthClient(fixture.config, {
      dependencies: { google: fake.google },
      forceAccountSelection: true,
      interactive: true,
      openExternal: async () => {},
      authorizeWithLoopback: async () => {
        throw new Error("login cancelled");
      },
    }),
    /login cancelled/,
  );

  assert.deepEqual(
    JSON.parse(await fs.readFile(fixture.tokenPath, "utf8")),
    oldToken,
  );
});

test("forced reconnect is not blocked by a corrupt stored token", async (t) => {
  const fixture = await createFixture();
  t.after(() => fs.rm(fixture.directory, { recursive: true, force: true }));
  await fs.writeFile(fixture.tokenPath, "not-json");
  const fake = createFakeGoogle();
  const replacementClient = { credentials: { access_token: "replacement" } };

  const client = await getGoogleAuthClient(fixture.config, {
    dependencies: { google: fake.google },
    forceAccountSelection: true,
    interactive: true,
    openExternal: async () => {},
    authorizeWithLoopback: async () => replacementClient,
  });

  assert.equal(client, replacementClient);
});

test("authorization URL always asks for account selection and consent", () => {
  let receivedOptions;
  const url = createOAuthAuthorizationUrl(
    {
      generateAuthUrl(options) {
        receivedOptions = options;
        return "https://accounts.google.test/authorize";
      },
    },
    "state-value",
  );

  assert.equal(url, "https://accounts.google.test/authorize");
  assert.equal(receivedOptions.prompt, "select_account consent");
  assert.equal(receivedOptions.access_type, "offline");
  assert.equal(receivedOptions.state, "state-value");
});

test("loopback authorization can be aborted when the browser tab is abandoned", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "meeting-auth-abort-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const controller = new AbortController();
  let openedUrl = "";

  const authorization = authorizeWithLoopback({
    appCredentials: {
      client_id: "test-client-id",
      client_secret: "test-client-secret",
    },
    tokenPath: path.join(directory, "token.json"),
    signal: controller.signal,
    timeoutMs: 10_000,
    openExternal: async (url) => {
      openedUrl = url;
      controller.abort();
    },
  });

  await assert.rejects(authorization, (error) => {
    assert.equal(error.code, "GOOGLE_AUTH_CANCELLED");
    return true;
  });
  assert.match(openedUrl, /^https:\/\/accounts\.google\.com\//);
});

test("loopback authorization times out instead of waiting forever", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "meeting-auth-timeout-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));

  await assert.rejects(
    authorizeWithLoopback({
      appCredentials: {
        client_id: "test-client-id",
        client_secret: "test-client-secret",
      },
      tokenPath: path.join(directory, "token.json"),
      timeoutMs: 1,
      openExternal: async () => {},
    }),
    (error) => {
      assert.equal(error.code, "GOOGLE_AUTH_TIMEOUT");
      return true;
    },
  );
});

test("aborting during token exchange does not replace the stored account", async (t) => {
  const oldToken = {
    access_token: "old-access-token",
    refresh_token: "old-refresh-token",
  };
  const fixture = await createFixture(oldToken);
  t.after(() => fs.rm(fixture.directory, { recursive: true, force: true }));
  const controller = new AbortController();
  let redirectUri = "";
  let oauthState = "";
  let releaseTokenExchange;
  let markTokenExchangeStarted;
  const tokenExchangeStarted = new Promise((resolve) => {
    markTokenExchangeStarted = resolve;
  });
  const tokenExchange = new Promise((resolve) => {
    releaseTokenExchange = resolve;
  });

  class OAuth2 extends EventEmitter {
    constructor(_clientId, _clientSecret, callbackUri) {
      super();
      redirectUri = callbackUri;
      this.credentials = {};
    }

    generateAuthUrl(options) {
      oauthState = options.state;
      return "https://accounts.google.test/authorize";
    }

    async getToken() {
      markTokenExchangeStarted();
      return tokenExchange;
    }

    setCredentials(credentials) {
      this.credentials = credentials;
    }
  }

  let callbackCompleted;
  const callbackFinished = new Promise((resolve, reject) => {
    callbackCompleted = { resolve, reject };
  });
  const authorization = authorizeWithLoopback({
    appCredentials: {
      client_id: "test-client-id",
      client_secret: "test-client-secret",
    },
    tokenPath: fixture.tokenPath,
    signal: controller.signal,
    timeoutMs: 10_000,
    dependencies: {
      google: { auth: { OAuth2 } },
    },
    openExternal: async () => {
      const callbackUrl = `${redirectUri}?state=${oauthState}&code=test-code`;
      http
        .get(
          callbackUrl,
          { agent: false, headers: { Connection: "close" } },
          (response) => {
            response.resume();
            response.on("end", callbackCompleted.resolve);
          },
        )
        .on("error", callbackCompleted.reject);
      await tokenExchangeStarted;
      controller.abort();
      releaseTokenExchange({
        tokens: {
          access_token: "new-access-token",
          refresh_token: "new-refresh-token",
        },
      });
    },
  });

  await assert.rejects(authorization, (error) => {
    assert.equal(error.code, "GOOGLE_AUTH_CANCELLED");
    return true;
  });
  await callbackFinished;
  assert.deepEqual(
    JSON.parse(await fs.readFile(fixture.tokenPath, "utf8")),
    oldToken,
  );
});

test("auth status reports the connected Google account email", async (t) => {
  const fixture = await createFixture({
    access_token: "valid-access-token",
    refresh_token: "refresh-token",
    expiry_date: Date.now() + 3_600_000,
  });
  t.after(() => fs.rm(fixture.directory, { recursive: true, force: true }));
  const fake = createFakeGoogle({
    profile: { email: "owner@example.test", name: "Owner" },
  });

  const status = await getGoogleAuthStatus(fixture.config, {
    dependencies: { google: fake.google },
  });

  assert.equal(status.authorized, true);
  assert.equal(status.accountEmail, "owner@example.test");
  assert.deepEqual(status.account, {
    email: "owner@example.test",
    displayName: "Owner",
    photoUrl: null,
  });
});

test("disconnect removes the local OAuth token", async (t) => {
  const fixture = await createFixture({ access_token: "valid-access-token" });
  t.after(() => fs.rm(fixture.directory, { recursive: true, force: true }));

  const result = await disconnectGoogleAccount(fixture.config);

  assert.equal(result.disconnected, true);
  await assert.rejects(fs.access(fixture.tokenPath), { code: "ENOENT" });
});

test("service-account authentication remains supported", async () => {
  const serviceClient = { email: "service@example.test" };
  const fake = createFakeGoogle({ serviceClient });
  const client = await getGoogleAuthClient(
    {
      authMode: "service_account",
      serviceAccountPath: "credentials.json",
    },
    { dependencies: { google: fake.google } },
  );

  assert.equal(client, serviceClient);
});

test("service-account status does not require a userinfo request", async () => {
  const serviceClient = { email: "service@example.test" };
  const fake = createFakeGoogle({ serviceClient });
  const status = await getGoogleAuthStatus(
    {
      authMode: "service_account",
      serviceAccountPath: "credentials.json",
    },
    { dependencies: { google: fake.google } },
  );

  assert.equal(status.authorized, true);
  assert.equal(status.accountEmail, "service@example.test");
});

test("atomic token writer replaces a token only after the temporary write", async (t) => {
  const fixture = await createFixture({ access_token: "old" });
  t.after(() => fs.rm(fixture.directory, { recursive: true, force: true }));

  await saveToken(fixture.tokenPath, { access_token: "new" });

  assert.deepEqual(JSON.parse(await fs.readFile(fixture.tokenPath, "utf8")), {
    access_token: "new",
  });
});
