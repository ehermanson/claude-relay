import { getVscodeIconUrl } from "../../lib/vscode-icons";
import { useTheme } from "../../context/theme-context";

interface FileIconProps {
  path: string;
  kind?: "file" | "directory";
  size?: number;
  className?: string;
}

export function FileIcon({ path, kind = "file", size = 18, className }: FileIconProps) {
  const { theme } = useTheme();
  return (
    <img
      src={getVscodeIconUrl(path, kind, theme)}
      alt=""
      width={size}
      height={size}
      className={className ?? "shrink-0"}
      loading="lazy"
    />
  );
}
