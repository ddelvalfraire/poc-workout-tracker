import { addons } from "storybook/manager-api";

import { storybookTheme } from "./theme";

/**
 * The sidebar and toolbar wear the same palette as the stories they frame —
 * the app ships ONE intentional dark theme (DESIGN.md § Theme), and a catalog
 * about consistency should not be the one place that ships two.
 */
addons.setConfig({ theme: storybookTheme });
