"use client";

import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@claritylabs-inc/ui/components/hover-card";

const IMAGE_EXTENSION = /\.(png|jpe?g|gif|webp|avif|bmp|svg)$/i;

export function isImageAttachment(file: {
  filename?: string;
  contentType?: string;
  mediaType?: string;
}) {
  return (
    (file.contentType ?? file.mediaType)?.toLowerCase().startsWith("image/") === true ||
    IMAGE_EXTENSION.test(file.filename ?? "")
  );
}

/** Shows the image in a hover card over its trigger; renders the trigger alone without a URL. */
export function AttachmentImagePreview({
  url,
  filename,
  children,
}: {
  url?: string | null;
  filename: string;
  children: React.ReactElement<Record<string, unknown>>;
}) {
  if (!url) return children;
  return (
    <HoverCard>
      <HoverCardTrigger render={children} delay={200} closeDelay={0} />
      <HoverCardContent side="top" className="w-auto max-w-80 p-1">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={url}
          alt={filename}
          className="block max-h-64 max-w-full rounded-md object-contain"
        />
      </HoverCardContent>
    </HoverCard>
  );
}
