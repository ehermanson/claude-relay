/**
 * Maps SuggestionIcon string enum values to Lucide React components.
 * Used at render time for both built-in and custom suggestions.
 */

import {
  Eye,
  FlaskConical,
  Play,
  ScrollText,
  Sparkles,
  Bug,
  Code,
  FileText,
  GitBranch,
  Lightbulb,
  ListChecks,
  MessageSquare,
  Pencil,
  Rocket,
  Search,
  Settings,
  Shield,
  Trash2,
  Wrench,
  Zap,
  type LucideIcon,
} from "lucide-react";
import type { SuggestionIcon } from "@shared/types";

export const SUGGESTION_ICON_MAP: Record<SuggestionIcon, LucideIcon> = {
  Eye,
  FlaskConical,
  Play,
  ScrollText,
  Sparkles,
  Bug,
  Code,
  FileText,
  GitBranch,
  Lightbulb,
  ListChecks,
  MessageSquare,
  Pencil,
  Rocket,
  Search,
  Settings,
  Shield,
  Trash2,
  Wrench,
  Zap,
};

/** All icon names available for custom suggestion selection. */
export const SUGGESTION_ICON_NAMES: SuggestionIcon[] = Object.keys(
  SUGGESTION_ICON_MAP,
) as SuggestionIcon[];

/** Get the Lucide component for an icon name, with fallback. */
export function getSuggestionIcon(name: SuggestionIcon): LucideIcon {
  return SUGGESTION_ICON_MAP[name] ?? Sparkles;
}
