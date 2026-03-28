import { type ReactNode } from "react";

const maxWidthClasses = {
  narrow: "max-w-2xl",
  medium: "max-w-4xl",
  wide: "max-w-6xl",
  full: "",
} as const;

interface PageShellProps {
  children: ReactNode;
  maxWidth?: keyof typeof maxWidthClasses;
  toolbar?: ReactNode;
  padded?: boolean;
  className?: string;
}

export function PageShell({
  children,
  maxWidth = "full",
  toolbar,
  padded = true,
  className,
}: PageShellProps) {
  const maxWidthClass = maxWidthClasses[maxWidth];

  return (
    <div className={`flex-1 overflow-y-auto ${className ?? ""}`}>
      {padded ? (
        <div className={`mx-auto w-full px-4 py-4 sm:px-6 sm:py-6 ${maxWidthClass}`}>
          {toolbar && <div className="mb-3">{toolbar}</div>}
          {children}
        </div>
      ) : (
        <>
          {toolbar}
          {children}
        </>
      )}
    </div>
  );
}
