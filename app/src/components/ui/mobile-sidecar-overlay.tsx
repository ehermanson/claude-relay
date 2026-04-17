/**
 * Floating-card overlay used to host the mobile sidecar/sidebar on small
 * screens. Owns the backdrop, positioning, and click-outside behavior so
 * instance and space views share the same presentation.
 */

import type { ReactNode } from "react";

interface MobileSidecarOverlayProps {
  onClose: () => void;
  children: ReactNode;
}

export function MobileSidecarOverlay({ onClose, children }: MobileSidecarOverlayProps) {
  return (
    <div className="fixed inset-0 z-50 flex justify-end p-2" onClick={onClose}>
      <div className="animate-fade-in absolute inset-0 bg-black/50" />
      <div
        className="relative z-10 my-auto h-[calc(100%-16px)]"
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}
