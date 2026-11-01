import type { ComponentType } from "react";
import type { SettingsSectionId } from "../pages";
import { AppearanceSection } from "./AppearanceSection";
import { BackupsSection } from "./BackupsSection";
import { BrowserSection } from "./BrowserSection";
import { BudgetsSection } from "./BudgetsSection";
import { GeneralSection } from "./GeneralSection";
import { InstallSection } from "./InstallSection";
import { ImportExportSection } from "./ImportExportSection";
import { McpSection } from "./McpSection";
import { ModsSection } from "./ModsSection";
import { PresetsSection } from "./PresetsSection";
import { ProjectsSection } from "./ProjectsSection";
import { ResetSection } from "./ResetSection";
import { ShortcutsSection } from "./ShortcutsSection";
import { SkillsSection } from "./SkillsSection";
import { TeamsSection } from "./TeamsSection";
import { TerminalSection, TilesSection } from "./TerminalSection";
import { TerminalsSection } from "./TerminalsSection";
import { TokensSection } from "./TokensSection";
import { TopBarSection } from "./TopBarSection";

// Each settings section component, by its section id. The pages in ../pages.ts compose these.
export const SECTION_COMPONENTS: Record<SettingsSectionId, ComponentType> = {
  general: GeneralSection,
  appearance: AppearanceSection,
  projects: ProjectsSection,
  topbar: TopBarSection,
  terminals: TerminalsSection,
  terminal: TerminalSection,
  tiles: TilesSection,
  mods: ModsSection,
  tokens: TokensSection,
  budgets: BudgetsSection,
  presets: PresetsSection,
  teams: TeamsSection,
  backups: BackupsSection,
  superpowers: SkillsSection,
  mcp: McpSection,
  import: ImportExportSection,
  shortcuts: ShortcutsSection,
  browser: BrowserSection,
  reset: ResetSection,
  install: InstallSection,
};
