import { X } from "lucide-react";
import type { ImageAttachment } from "./shared";
import { Tooltip } from "../../ui/tooltip";

export function ImageAttachmentStrip({
  images,
  onRemove,
}: {
  images: ImageAttachment[];
  onRemove: (index: number) => void;
}) {
  if (images.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2 px-3 pt-3">
      {images.map((img, index) => (
        <div key={index} className="group relative">
          <img
            src={img.preview}
            alt="Attachment"
            className="h-16 w-16 rounded-lg border border-border object-cover"
          />
          <Tooltip content="Remove">
            <button
              onClick={() => onRemove(index)}
              className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-error text-white opacity-0 transition-opacity group-hover:opacity-100"
            >
              <X size={10} strokeWidth={3} />
            </button>
          </Tooltip>
        </div>
      ))}
    </div>
  );
}
