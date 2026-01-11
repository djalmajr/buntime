import { useInput } from "ink";
import { Layout } from "../../components/layout.js";
import { Logo } from "../../components/logo.js";
import { Menu, type MenuItem } from "../../components/menu.js";
import { useTui } from "../../context/tui-context.js";

const menuItems: MenuItem[] = [
  {
    description: "View all installed apps",
    label: "List",
    value: "list",
  },
  {
    description: "Install app from tarball",
    label: "Install",
    value: "install",
  },
  {
    description: "Remove an installed app",
    label: "Remove",
    value: "remove",
  },
];

export function AppMenuScreen() {
  const { goBack, navigate } = useTui();

  useInput((_input, key) => {
    if (key.escape) {
      goBack();
    }
  });

  const handleSelect = (value: string) => {
    switch (value) {
      case "list":
        navigate({ type: "app_list" });
        break;
      case "install":
        navigate({ type: "app_install" });
        break;
      case "remove":
        navigate({ type: "app_remove" });
        break;
    }
  };

  return (
    <Layout>
      <Logo />
      <Menu items={menuItems} title="App Management" onSelect={handleSelect} />
    </Layout>
  );
}
