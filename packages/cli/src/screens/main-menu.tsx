import { useInput } from "ink";
import { Layout } from "../components/layout.js";
import { Logo } from "../components/logo.js";
import { Menu, type MenuItem } from "../components/menu.js";
import { useTui } from "../context/tui-context.js";

const menuItems: MenuItem[] = [
  {
    description: "Manage installed applications",
    label: "Apps",
    value: "apps",
  },
  {
    description: "Manage installed plugins",
    label: "Plugins",
    value: "plugins",
  },
  {
    description: "Manage authentication keys",
    label: "API Keys",
    value: "keys",
  },
];

export function MainMenuScreen() {
  const { navigate } = useTui();

  useInput((_input, key) => {
    if (key.escape) {
      navigate({ type: "select_server" });
    }
  });

  const handleSelect = (value: string) => {
    switch (value) {
      case "plugins":
        navigate({ type: "plugin_list" });
        break;
      case "apps":
        navigate({ type: "app_list" });
        break;
      case "keys":
        navigate({ type: "key_list" });
        break;
    }
  };

  return (
    <Layout>
      <Logo />
      <Menu items={menuItems} title="What would you like to manage?" onSelect={handleSelect} />
    </Layout>
  );
}
