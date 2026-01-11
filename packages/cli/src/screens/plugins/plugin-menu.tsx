import { useInput } from "ink";
import { Layout } from "../../components/layout.js";
import { Logo } from "../../components/logo.js";
import { Menu, type MenuItem } from "../../components/menu.js";
import { useTui } from "../../context/tui-context.js";

const menuItems: MenuItem[] = [
  {
    description: "View all installed plugins",
    label: "List",
    value: "list",
  },
  {
    description: "Install plugin from tarball",
    label: "Install",
    value: "install",
  },
  {
    description: "Remove an installed plugin",
    label: "Remove",
    value: "remove",
  },
];

export function PluginMenuScreen() {
  const { goBack, navigate } = useTui();

  useInput((_input, key) => {
    if (key.escape) {
      goBack();
    }
  });

  const handleSelect = (value: string) => {
    switch (value) {
      case "list":
        navigate({ type: "plugin_list" });
        break;
      case "install":
        navigate({ type: "plugin_install" });
        break;
      case "remove":
        navigate({ type: "plugin_remove" });
        break;
    }
  };

  return (
    <Layout>
      <Logo />
      <Menu items={menuItems} title="Plugin Management" onSelect={handleSelect} />
    </Layout>
  );
}
