/**
 * Setup Keycloak for Buntime development
 * Creates realm, client, and test user
 */

const KEYCLOAK_URL = "http://localhost:8180/auth";
const ADMIN_USER = "admin";
const ADMIN_PASS = "admin";
const REALM_NAME = "buntime";
const CLIENT_ID = "buntime-app";
const CLIENT_SECRET = "buntime-secret"; // For development only

async function getAdminToken(): Promise<string> {
  const res = await fetch(
    `${KEYCLOAK_URL}/realms/master/protocol/openid-connect/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        username: ADMIN_USER,
        password: ADMIN_PASS,
        grant_type: "password",
        client_id: "admin-cli",
      }),
    },
  );

  if (!res.ok) {
    throw new Error(`Failed to get admin token: ${res.status}`);
  }

  const data = await res.json();
  return data.access_token;
}

async function createRealm(token: string): Promise<void> {
  // Check if realm exists
  const checkRes = await fetch(`${KEYCLOAK_URL}/admin/realms/${REALM_NAME}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (checkRes.ok) {
    console.log(`✓ Realm '${REALM_NAME}' already exists`);
    return;
  }

  const res = await fetch(`${KEYCLOAK_URL}/admin/realms`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      realm: REALM_NAME,
      enabled: true,
      registrationAllowed: true,
      loginWithEmailAllowed: true,
      duplicateEmailsAllowed: false,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to create realm: ${res.status} - ${text}`);
  }

  console.log(`✓ Created realm '${REALM_NAME}'`);
}

async function createClient(token: string): Promise<void> {
  // Check if client exists
  const checkRes = await fetch(
    `${KEYCLOAK_URL}/admin/realms/${REALM_NAME}/clients?clientId=${CLIENT_ID}`,
    {
      headers: { Authorization: `Bearer ${token}` },
    },
  );

  if (checkRes.ok) {
    const clients = await checkRes.json();
    if (clients.length > 0) {
      console.log(`✓ Client '${CLIENT_ID}' already exists`);
      return;
    }
  }

  const res = await fetch(`${KEYCLOAK_URL}/admin/realms/${REALM_NAME}/clients`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      clientId: CLIENT_ID,
      name: "Buntime Application",
      enabled: true,
      protocol: "openid-connect",
      publicClient: false,
      secret: CLIENT_SECRET,
      standardFlowEnabled: true,
      directAccessGrantsEnabled: true,
      serviceAccountsEnabled: false,
      authorizationServicesEnabled: false,
      redirectUris: [
        "http://localhost:8000/*",
        "http://localhost:4000/*",
      ],
      webOrigins: [
        "http://localhost:8000",
        "http://localhost:4000",
      ],
      attributes: {
        "pkce.code.challenge.method": "S256",
        "post.logout.redirect.uris": "http://localhost:8000/*##http://localhost:4000/*",
      },
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to create client: ${res.status} - ${text}`);
  }

  console.log(`✓ Created client '${CLIENT_ID}'`);
}

async function createTestUser(token: string): Promise<void> {
  const username = "test";
  const email = "test@buntime.dev";
  const password = "test";

  // Check if user exists
  const checkRes = await fetch(
    `${KEYCLOAK_URL}/admin/realms/${REALM_NAME}/users?username=${username}`,
    {
      headers: { Authorization: `Bearer ${token}` },
    },
  );

  if (checkRes.ok) {
    const users = await checkRes.json();
    if (users.length > 0) {
      console.log(`✓ User '${username}' already exists`);
      return;
    }
  }

  // Create user
  const createRes = await fetch(
    `${KEYCLOAK_URL}/admin/realms/${REALM_NAME}/users`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        username,
        email,
        emailVerified: true,
        enabled: true,
        firstName: "Test",
        lastName: "User",
      }),
    },
  );

  if (!createRes.ok) {
    const text = await createRes.text();
    throw new Error(`Failed to create user: ${createRes.status} - ${text}`);
  }

  // Get user ID
  const usersRes = await fetch(
    `${KEYCLOAK_URL}/admin/realms/${REALM_NAME}/users?username=${username}`,
    {
      headers: { Authorization: `Bearer ${token}` },
    },
  );
  const users = await usersRes.json();
  const userId = users[0]?.id;

  if (!userId) {
    throw new Error("Failed to get user ID after creation");
  }

  // Set password
  const pwdRes = await fetch(
    `${KEYCLOAK_URL}/admin/realms/${REALM_NAME}/users/${userId}/reset-password`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        type: "password",
        value: password,
        temporary: false,
      }),
    },
  );

  if (!pwdRes.ok) {
    const text = await pwdRes.text();
    throw new Error(`Failed to set password: ${pwdRes.status} - ${text}`);
  }

  console.log(`✓ Created test user '${username}' (password: ${password})`);
}

async function main() {
  console.log("🔧 Setting up Keycloak for Buntime...\n");

  try {
    const token = await getAdminToken();
    console.log("✓ Got admin token\n");

    await createRealm(token);
    await createClient(token);
    await createTestUser(token);

    console.log("\n✅ Keycloak setup complete!\n");
    console.log("Configuration:");
    console.log(`  Realm: ${REALM_NAME}`);
    console.log(`  Client ID: ${CLIENT_ID}`);
    console.log(`  Client Secret: ${CLIENT_SECRET}`);
    console.log(`  Test User: test / test`);
    console.log(`\nSet KEYCLOAK_CLIENT_SECRET=${CLIENT_SECRET} in your environment.`);
  } catch (error) {
    console.error("\n❌ Error:", error);
    process.exit(1);
  }
}

main();
