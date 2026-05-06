import { useEffect, useRef, useState } from "react";
import { uploadImage } from "../../../lib/api";
import type { ImageAttachment } from "./shared";
import { deleteAttachments, loadAttachments, saveAttachments } from "./draft-attachment-store";

export function useAttachmentState(draftKey?: string) {
  const [images, setImages] = useState<ImageAttachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const imagesRef = useRef<ImageAttachment[]>([]);
  const hydratedRef = useRef(false);

  useEffect(() => {
    imagesRef.current = images;
  }, [images]);

  // Hydrate from IDB whenever the draft key changes (chat switch).
  useEffect(() => {
    let cancelled = false;
    hydratedRef.current = false;

    // Drop previews from the prior draft before swapping in new state.
    imagesRef.current.forEach((image) => URL.revokeObjectURL(image.preview));
    setImages([]);

    if (!draftKey) {
      hydratedRef.current = true;
      return;
    }

    loadAttachments(draftKey).then((stored) => {
      if (cancelled) return;
      const restored = stored.map((entry) => {
        const file = new File([entry.blob], entry.name, { type: entry.type });
        return { file, preview: URL.createObjectURL(file) };
      });
      setImages(restored);
      hydratedRef.current = true;
    });

    return () => {
      cancelled = true;
    };
  }, [draftKey]);

  // Persist after every mutation, but only once hydration is finished —
  // otherwise the initial setImages([]) during chat-switch would clobber the
  // newly-selected draft's stored attachments.
  useEffect(() => {
    if (!draftKey || !hydratedRef.current) return;
    const items = images.map((image) => ({
      name: image.file.name,
      type: image.file.type,
      blob: image.file,
    }));
    saveAttachments(draftKey, items);
  }, [draftKey, images]);

  // Final cleanup of preview URLs on unmount.
  useEffect(() => {
    return () => {
      imagesRef.current.forEach((image) => URL.revokeObjectURL(image.preview));
    };
  }, []);

  const addImages = (files: File[]) => {
    const imageFiles = files.filter((file) => file.type.startsWith("image/"));
    if (imageFiles.length === 0) return;
    setImages((prev) => [
      ...prev,
      ...imageFiles.map((file) => ({
        file,
        preview: URL.createObjectURL(file),
      })),
    ]);
  };

  const removeImage = (index: number) => {
    setImages((prev) => {
      const removed = prev[index];
      if (removed) URL.revokeObjectURL(removed.preview);
      return prev.filter((_, currentIndex) => currentIndex !== index);
    });
  };

  const clearImages = () => {
    setImages((prev) => {
      prev.forEach((image) => URL.revokeObjectURL(image.preview));
      return [];
    });
    if (draftKey) {
      // Don't wait for the persistence effect — wipe the stored draft now so
      // a quick chat-switch right after send can't reload the just-sent images.
      void deleteAttachments(draftKey);
    }
  };

  const uploadAttachedImages = async () => {
    if (images.length === 0) return undefined;

    setUploading(true);
    try {
      return await Promise.all(images.map((image) => uploadImage(image.file)));
    } finally {
      setUploading(false);
    }
  };

  return {
    images,
    uploading,
    addImages,
    removeImage,
    clearImages,
    uploadAttachedImages,
  };
}
