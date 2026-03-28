import { getFileIconUrl } from "../../lib/file-icons";
import { useTheme } from "@/stores/theme-store";

interface FileIconProps {
  path: string;
  kind?: "file" | "directory";
  size?: number;
  className?: string;
}

export function FileIcon({ path, kind = "file", size = 16, className }: FileIconProps) {
  const { theme } = useTheme();
  return (
    <img
      src={getFileIconUrl(path, kind, theme)}
      alt=""
      width={size}
      height={size}
      className={`shrink-0 opacity-80 [filter:saturate(0.88)] ${className ?? ""}`}
      loading="lazy"
    />
  );
}
