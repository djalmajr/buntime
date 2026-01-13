import { Box, Text, useInput } from "ink";
import Spinner from "ink-spinner";
import { useEffect, useState } from "react";
import { Label } from "../../components/label.js";
import { Layout } from "../../components/layout.js";
import { Logo } from "../../components/logo.js";
import { TextInput } from "../../components/text-input.js";
import { useTui } from "../../context/tui-context.js";
import type { CreateKeyResult, KeyRole, Permission } from "../../lib/api-client.js";

type Step = "name" | "role" | "expiration" | "permissions" | "confirm" | "success";

const ROLES: { description: string; label: string; value: KeyRole }[] = [
  { description: "Full access + manage keys", label: "Admin", value: "admin" },
  { description: "Manage plugins/apps", label: "Editor", value: "editor" },
  { description: "Read-only access", label: "Viewer", value: "viewer" },
  { description: "Select specific permissions", label: "Custom", value: "custom" },
];

const EXPIRATIONS = [
  { label: "Never", value: "never" },
  { label: "30 days", value: "30d" },
  { label: "90 days", value: "90d" },
  { label: "1 year", value: "1y" },
];

const ALL_PERMISSIONS: Permission[] = [
  "plugins:read",
  "plugins:install",
  "plugins:remove",
  "plugins:config",
  "apps:read",
  "apps:install",
  "apps:remove",
  "keys:read",
  "keys:create",
  "keys:revoke",
  "workers:read",
  "workers:restart",
];

export function KeyCreateScreen() {
  const { api, goBack, navigate } = useTui();
  const [step, setStep] = useState<Step>("name");
  const [name, setName] = useState("");
  const [role, setRole] = useState<KeyRole>("editor");
  const [roleIndex, setRoleIndex] = useState(1);
  const [expiration, setExpiration] = useState("1y");
  const [expirationIndex, setExpirationIndex] = useState(3);
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [permIndex, setPermIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CreateKeyResult | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (copied) {
      const timer = setTimeout(() => setCopied(false), 2000);
      return () => clearTimeout(timer);
    }
  }, [copied]);

  useInput((input, key) => {
    if (loading) return;

    if (key.escape) {
      if (step === "success") {
        navigate({ type: "key_list" });
      } else if (step === "name") {
        goBack();
      } else if (step === "permissions") {
        setStep("role");
      } else if (step === "confirm") {
        setStep(role === "custom" ? "permissions" : "expiration");
      } else if (step === "expiration") {
        setStep("role");
      } else if (step === "role") {
        setStep("name");
      }
      return;
    }

    if (step === "name") {
      if (key.return && name.trim()) {
        setStep("role");
      }
      return;
    }

    if (step === "role") {
      if (key.upArrow || input === "k") {
        setRoleIndex((prev) => Math.max(0, prev - 1));
        setRole(ROLES[Math.max(0, roleIndex - 1)]!.value);
      } else if (key.downArrow || input === "j") {
        setRoleIndex((prev) => Math.min(ROLES.length - 1, prev + 1));
        setRole(ROLES[Math.min(ROLES.length - 1, roleIndex + 1)]!.value);
      } else if (key.return || input === " ") {
        if (role === "custom") {
          setStep("permissions");
        } else {
          setStep("expiration");
        }
      }
      return;
    }

    if (step === "permissions") {
      if (key.upArrow || input === "k") {
        setPermIndex((prev) => Math.max(0, prev - 1));
      } else if (key.downArrow || input === "j") {
        setPermIndex((prev) => Math.min(ALL_PERMISSIONS.length - 1, prev + 1));
      } else if (input === " ") {
        const perm = ALL_PERMISSIONS[permIndex]!;
        setPermissions((prev) =>
          prev.includes(perm) ? prev.filter((p) => p !== perm) : [...prev, perm],
        );
      } else if (input === "a") {
        setPermissions([...ALL_PERMISSIONS]);
      } else if (input === "n") {
        setPermissions([]);
      } else if (key.return) {
        if (permissions.length > 0) {
          setStep("expiration");
        }
      }
      return;
    }

    if (step === "expiration") {
      if (key.upArrow || input === "k") {
        setExpirationIndex((prev) => Math.max(0, prev - 1));
        setExpiration(EXPIRATIONS[Math.max(0, expirationIndex - 1)]!.value);
      } else if (key.downArrow || input === "j") {
        setExpirationIndex((prev) => Math.min(EXPIRATIONS.length - 1, prev + 1));
        setExpiration(EXPIRATIONS[Math.min(EXPIRATIONS.length - 1, expirationIndex + 1)]!.value);
      } else if (key.return || input === " ") {
        setStep("confirm");
      }
      return;
    }

    if (step === "confirm") {
      if (key.return) {
        createKey();
      }
      return;
    }

    if (step === "success" && result) {
      if (input === "c") {
        // Copy to clipboard
        Bun.write(Bun.stdout, `\x1b]52;c;${btoa(result.key)}\x07`);
        setCopied(true);
      } else if (key.return) {
        navigate({ type: "key_list" });
      }
      return;
    }
  });

  const createKey = async () => {
    if (!api) return;

    setLoading(true);
    setError(null);

    try {
      const data = await api.createKey({
        expiresIn: expiration,
        name: name.trim(),
        permissions: role === "custom" ? permissions : undefined,
        role,
      });
      setResult(data);
      setStep("success");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create key");
    } finally {
      setLoading(false);
    }
  };

  const shortcuts =
    step === "success"
      ? [
          { action: "Copy", key: "c" },
          { action: "Done", key: "Enter" },
        ]
      : step === "permissions"
        ? [
            { action: "Toggle", key: "Space" },
            { action: "All", key: "a" },
            { action: "None", key: "n" },
          ]
        : [];

  return (
    <Layout shortcuts={shortcuts}>
      <Logo />
      {error && (
        <Box marginBottom={1}>
          <Text color="red">Error: {error}</Text>
        </Box>
      )}
      {step === "name" && (
        <Box flexDirection="column">
          <Label bold>Create API Key</Label>
          <Box marginTop={1} flexDirection="column">
            <Label>Name</Label>
            <TextInput
              label="Name"
              placeholder="e.g., Deploy CI/CD"
              value={name}
              onChange={setName}
            />
          </Box>
          <Box marginTop={1}>
            <Label muted>Press Enter to continue</Label>
          </Box>
        </Box>
      )}
      {step === "role" && (
        <Box flexDirection="column">
          <Label bold>Select Role</Label>
          <Box marginTop={1} flexDirection="column">
            {ROLES.map((r, index) => {
              const isSelected = index === roleIndex;
              return (
                <Box key={r.value} gap={1}>
                  <Label selected={isSelected}>{isSelected ? ">" : " "}</Label>
                  <Text color={isSelected ? "cyan" : undefined}>{isSelected ? "●" : "○"}</Text>
                  <Label selected={isSelected}>{r.label.padEnd(10)}</Label>
                  <Label muted>{r.description}</Label>
                </Box>
              );
            })}
          </Box>
        </Box>
      )}
      {step === "permissions" && (
        <Box flexDirection="column">
          <Label bold>Select Permissions</Label>
          <Box marginTop={1} flexDirection="column">
            {ALL_PERMISSIONS.map((perm, index) => {
              const isSelected = index === permIndex;
              const isChecked = permissions.includes(perm);
              return (
                <Box key={perm} gap={1}>
                  <Label selected={isSelected}>{isSelected ? ">" : " "}</Label>
                  <Text color={isChecked ? "green" : "gray"}>{isChecked ? "[x]" : "[ ]"}</Text>
                  <Label selected={isSelected}>{perm}</Label>
                </Box>
              );
            })}
          </Box>
          <Box marginTop={1}>
            <Label muted>{permissions.length} selected - Press Enter to continue</Label>
          </Box>
        </Box>
      )}
      {step === "expiration" && (
        <Box flexDirection="column">
          <Label bold>Expiration</Label>
          <Box marginTop={1} flexDirection="column">
            {EXPIRATIONS.map((exp, index) => {
              const isSelected = index === expirationIndex;
              return (
                <Box key={exp.value} gap={1}>
                  <Label selected={isSelected}>{isSelected ? ">" : " "}</Label>
                  <Text color={isSelected ? "cyan" : undefined}>{isSelected ? "●" : "○"}</Text>
                  <Label selected={isSelected}>{exp.label}</Label>
                </Box>
              );
            })}
          </Box>
        </Box>
      )}
      {step === "confirm" && (
        <Box flexDirection="column">
          <Label bold>Confirm Key Creation</Label>
          <Box marginTop={1} flexDirection="column" gap={0}>
            <Box>
              <Label muted>Name: </Label>
              <Label>{name}</Label>
            </Box>
            <Box>
              <Label muted>Role: </Label>
              <Label>{role}</Label>
            </Box>
            <Box>
              <Label muted>Expires: </Label>
              <Label>{EXPIRATIONS.find((e) => e.value === expiration)?.label}</Label>
            </Box>
            {role === "custom" && (
              <Box>
                <Label muted>Permissions: </Label>
                <Label>{permissions.length}</Label>
              </Box>
            )}
          </Box>
          <Box marginTop={1}>
            {loading ? (
              <Box>
                <Text color="green">
                  <Spinner type="dots" />
                </Text>
                <Label> Creating key...</Label>
              </Box>
            ) : (
              <Label muted>Press Enter to create</Label>
            )}
          </Box>
        </Box>
      )}
      {step === "success" && result && (
        <Box flexDirection="column">
          <Text color="green" bold>
            API KEY CREATED
          </Text>
          <Box
            marginTop={1}
            flexDirection="column"
            borderStyle="round"
            borderColor="yellow"
            paddingX={2}
            paddingY={1}
          >
            <Label muted>Copy this key now. You won't be able to see it again!</Label>
            <Box marginTop={1}>
              <Text color="yellow" bold>
                {result.key}
              </Text>
            </Box>
          </Box>
          <Box marginTop={1} flexDirection="column">
            <Box>
              <Label muted>Name: </Label>
              <Label>{result.name}</Label>
            </Box>
            <Box>
              <Label muted>Role: </Label>
              <Label>{result.role}</Label>
            </Box>
          </Box>
          {copied && (
            <Box marginTop={1}>
              <Text color="green">Copied to clipboard!</Text>
            </Box>
          )}
        </Box>
      )}
    </Layout>
  );
}
