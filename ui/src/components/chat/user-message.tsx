import { formatTimestamp } from "../../lib/utils";
import { MarkdownContent, ImageThumbnail, IMAGE_PATTERN } from "./markdown-content";

interface UserMessageProps {
  text: string;
  timestamp?: number;
}

function splitTextAndImages(text: string): { textPart: string; images: string[] } {
  const images: string[] = [];
  const textPart = text
    .replace(IMAGE_PATTERN, (_match, filePath: string) => {
      images.push(filePath.trim());
      return "";
    })
    .trim();
  return { textPart, images };
}

function ImageRow({ images }: { images: string[] }) {
  return (
    <div className="flex flex-wrap gap-2">
      {images.map((filePath, i) => (
        <ImageThumbnail
          key={i}
          src={`/api/file?path=${encodeURIComponent(filePath)}`}
          alt="Image"
        />
      ))}
    </div>
  );
}

export function UserMessage({ text, timestamp }: UserMessageProps) {
  const { textPart, images } = splitTextAndImages(text);
  const hasText = textPart.length > 0;
  const hasImages = images.length > 0;

  return (
    <div className="flex max-w-[80%] flex-col items-end gap-1.5 self-end">
      {hasText && (
        <div className="rounded-2xl rounded-br-sm border border-border/50 bg-user-bg p-2 text-sm leading-relaxed text-user-text">
          <MarkdownContent text={textPart} />
        </div>
      )}
      {hasImages && <ImageRow images={images} />}
      {timestamp && (
        <span className="px-1 text-[10px] text-muted/45">{formatTimestamp(timestamp)}</span>
      )}
    </div>
  );
}
