import { useEffect, useRef, useState } from "react";
import { uploadImage } from "../../../lib/api";
import type { ImageAttachment } from "./shared";

export function useAttachmentState() {
  const [images, setImages] = useState<ImageAttachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const imagesRef = useRef<ImageAttachment[]>([]);

  useEffect(() => {
    imagesRef.current = images;
  }, [images]);

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
