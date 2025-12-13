#!/bin/bash
set -e

# Keycloak Admin API setup script
# Creates realm, client, and user for local development

KEYCLOAK_URL="${KEYCLOAK_URL:-http://localhost:8180/auth}"
ADMIN_USER="${KEYCLOAK_ADMIN:-admin}"
ADMIN_PASS="${KEYCLOAK_ADMIN_PASSWORD:-admin}"
REALM_NAME="buntime"
CLIENT_ID="buntime-app"
TEST_USER="dev@buntime.local"
TEST_PASS="dev123"

echo "==> Waiting for Keycloak to be ready..."
until curl -sf "$KEYCLOAK_URL/health/ready" > /dev/null 2>&1; do
  echo "    Keycloak not ready, waiting..."
  sleep 5
done
echo "    Keycloak is ready!"

echo "==> Getting admin token..."
TOKEN=$(curl -sf -X POST "$KEYCLOAK_URL/realms/master/protocol/openid-connect/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "username=$ADMIN_USER" \
  -d "password=$ADMIN_PASS" \
  -d "grant_type=password" \
  -d "client_id=admin-cli" | jq -r '.access_token')

if [ "$TOKEN" = "null" ] || [ -z "$TOKEN" ]; then
  echo "ERROR: Failed to get admin token"
  exit 1
fi
echo "    Got admin token"

echo "==> Checking if realm '$REALM_NAME' exists..."
REALM_EXISTS=$(curl -sf -o /dev/null -w "%{http_code}" \
  -H "Authorization: Bearer $TOKEN" \
  "$KEYCLOAK_URL/admin/realms/$REALM_NAME")

if [ "$REALM_EXISTS" = "200" ]; then
  echo "    Realm already exists, skipping creation"
else
  echo "==> Creating realm '$REALM_NAME'..."
  curl -sf -X POST "$KEYCLOAK_URL/admin/realms" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{
      "realm": "'"$REALM_NAME"'",
      "enabled": true,
      "registrationAllowed": false,
      "loginWithEmailAllowed": true,
      "duplicateEmailsAllowed": false,
      "resetPasswordAllowed": true,
      "editUsernameAllowed": false,
      "bruteForceProtected": true
    }'
  echo "    Realm created"
fi

echo "==> Checking if client '$CLIENT_ID' exists..."
CLIENT_UUID=$(curl -sf \
  -H "Authorization: Bearer $TOKEN" \
  "$KEYCLOAK_URL/admin/realms/$REALM_NAME/clients?clientId=$CLIENT_ID" | jq -r '.[0].id // empty')

if [ -n "$CLIENT_UUID" ]; then
  echo "    Client already exists (UUID: $CLIENT_UUID)"
else
  echo "==> Creating confidential client '$CLIENT_ID'..."
  curl -sf -X POST "$KEYCLOAK_URL/admin/realms/$REALM_NAME/clients" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{
      "clientId": "'"$CLIENT_ID"'",
      "name": "Buntime Application",
      "enabled": true,
      "clientAuthenticatorType": "client-secret",
      "secret": "",
      "redirectUris": [
        "http://localhost:8000/*",
        "http://localhost:4000/*"
      ],
      "webOrigins": [
        "http://localhost:8000",
        "http://localhost:4000"
      ],
      "standardFlowEnabled": true,
      "directAccessGrantsEnabled": true,
      "publicClient": false,
      "protocol": "openid-connect",
      "attributes": {
        "post.logout.redirect.uris": "http://localhost:8000/*"
      }
    }'
  echo "    Client created"

  # Get the client UUID
  CLIENT_UUID=$(curl -sf \
    -H "Authorization: Bearer $TOKEN" \
    "$KEYCLOAK_URL/admin/realms/$REALM_NAME/clients?clientId=$CLIENT_ID" | jq -r '.[0].id')
fi

echo "==> Getting client secret..."
CLIENT_SECRET=$(curl -sf \
  -H "Authorization: Bearer $TOKEN" \
  "$KEYCLOAK_URL/admin/realms/$REALM_NAME/clients/$CLIENT_UUID/client-secret" | jq -r '.value')

echo "==> Checking if test user exists..."
USER_EXISTS=$(curl -sf \
  -H "Authorization: Bearer $TOKEN" \
  "$KEYCLOAK_URL/admin/realms/$REALM_NAME/users?email=$TEST_USER" | jq -r '.[0].id // empty')

if [ -n "$USER_EXISTS" ]; then
  echo "    Test user already exists"
else
  echo "==> Creating test user '$TEST_USER'..."
  curl -sf -X POST "$KEYCLOAK_URL/admin/realms/$REALM_NAME/users" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{
      "username": "dev",
      "email": "'"$TEST_USER"'",
      "emailVerified": true,
      "enabled": true,
      "firstName": "Dev",
      "lastName": "User",
      "credentials": [{
        "type": "password",
        "value": "'"$TEST_PASS"'",
        "temporary": false
      }]
    }'
  echo "    Test user created"
fi

echo ""
echo "========================================"
echo "  Keycloak Setup Complete!"
echo "========================================"
echo ""
echo "Keycloak Admin Console:"
echo "  URL:      $KEYCLOAK_URL/admin"
echo "  User:     $ADMIN_USER"
echo "  Password: $ADMIN_PASS"
echo ""
echo "Client Configuration:"
echo "  Realm:    $REALM_NAME"
echo "  Client:   $CLIENT_ID"
echo "  Secret:   $CLIENT_SECRET"
echo ""
echo "Test User:"
echo "  Email:    $TEST_USER"
echo "  Password: $TEST_PASS"
echo ""
echo "Add to your .env file:"
echo "  KEYCLOAK_CLIENT_SECRET=$CLIENT_SECRET"
echo ""
