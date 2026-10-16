"use client";

import type { CSSProperties, ReactNode } from "react";
import type { IconType } from "react-icons";
import { BsOpenai } from "react-icons/bs";
import {
  SiClaude,
  SiGooglegemini,
  SiMistralai,
  SiX,
} from "react-icons/si";
import { scaledSvgWordmarkTypography } from "@/lib/typography";

export type ModelProviderId =
  | "openai"
  | "anthropic"
  | "google"
  | "xai"
  | "mistral"
  | "cohere"
  | "fireworks"
  | "deepseek";

const PROVIDER_BRAND_COLORS: Record<ModelProviderId, string> = {
  openai: "#000000",
  anthropic: "#D97757",
  google: "#4285F4",
  xai: "#111111",
  mistral: "#FA520F",
  cohere: "#39594D",
  fireworks: "rgb(42.8% 13% 96.9%)",
  deepseek: "#4D6BFE",
};

function FireworksMark({
  className,
  size,
}: {
  className?: string;
  size: number;
}) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="currentColor"
      height={size}
      viewBox="0 0 24 24"
      width={size}
    >
      <path
        clipRule="evenodd"
        d="M14.8 5l-2.801 6.795L9.195 5H7.397l3.072 7.428a1.64 1.64 0 003.038.002L16.598 5H14.8zm1.196 10.352l5.124-5.244-.699-1.669-5.596 5.739a1.664 1.664 0 00-.343 1.807 1.642 1.642 0 001.516 1.012L16 17l8-.02-.699-1.669-7.303.041h-.002zM2.88 10.104l.699-1.669 5.596 5.739c.468.479.603 1.189.343 1.807a1.643 1.643 0 01-1.516 1.012l-8-.018-.002.002.699-1.669 7.303.042-5.122-5.246z"
        fillRule="evenodd"
      />
    </svg>
  );
}

function CohereMark({
  className,
  size,
}: {
  className?: string;
  size: number;
}) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="currentColor"
      height={size}
      viewBox="0 0 24 24"
      width={size}
    >
      <path
        clipRule="evenodd"
        d="M8.128 14.099c.592 0 1.77-.033 3.398-.703 1.897-.781 5.672-2.2 8.395-3.656 1.905-1.018 2.74-2.366 2.74-4.18A4.56 4.56 0 0018.1 1H7.549A6.55 6.55 0 001 7.55c0 3.617 2.745 6.549 7.128 6.549z"
        fillRule="evenodd"
      />
      <path
        clipRule="evenodd"
        d="M9.912 18.61a4.387 4.387 0 012.705-4.052l3.323-1.38c3.361-1.394 7.06 1.076 7.06 4.715a5.104 5.104 0 01-5.105 5.104l-3.597-.001a4.386 4.386 0 01-4.386-4.387z"
        fillRule="evenodd"
      />
      <path
        d="M4.776 14.962A3.775 3.775 0 001 18.738v.489a3.776 3.776 0 007.551 0v-.49a3.775 3.775 0 00-3.775-3.775z"
      />
    </svg>
  );
}

function DeepSeekMark({
  className,
  size,
}: {
  className?: string;
  size: number;
}) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="currentColor"
      height={size}
      viewBox="0 0 24 24"
      width={size}
    >
      <path
        d="M23.748 4.482c-.254-.124-.364.113-.512.234-.051.039-.094.09-.137.136-.372.397-.806.657-1.373.626-.829-.046-1.537.214-2.163.848-.133-.782-.575-1.248-1.247-1.548-.352-.156-.708-.311-.955-.65-.172-.241-.219-.51-.305-.774-.055-.16-.11-.323-.293-.35-.2-.031-.278.136-.356.276-.313.572-.434 1.202-.422 1.84.027 1.436.633 2.58 1.838 3.393.137.093.172.187.129.323-.082.28-.18.552-.266.833-.055.179-.137.217-.329.14a5.526 5.526 0 01-1.736-1.18c-.857-.828-1.631-1.742-2.597-2.458a11.365 11.365 0 00-.689-.471c-.985-.957.13-1.743.388-1.836.27-.098.093-.432-.779-.428-.872.004-1.67.295-2.687.684a3.055 3.055 0 01-.465.137 9.597 9.597 0 00-2.883-.102c-1.885.21-3.39 1.102-4.497 2.623C.082 8.606-.231 10.684.152 12.85c.403 2.284 1.569 4.175 3.36 5.653 1.858 1.533 3.997 2.284 6.438 2.14 1.482-.085 3.133-.284 4.994-1.86.47.234.962.327 1.78.397.63.059 1.236-.03 1.705-.128.735-.156.684-.837.419-.961-2.155-1.004-1.682-.595-2.113-.926 1.096-1.296 2.746-2.642 3.392-7.003.05-.347.007-.565 0-.845-.004-.17.035-.237.23-.256a4.173 4.173 0 001.545-.475c1.396-.763 1.96-2.015 2.093-3.517.02-.23-.004-.467-.247-.588zM11.581 18c-2.089-1.642-3.102-2.183-3.52-2.16-.392.024-.321.471-.235.763.09.288.207.486.371.739.114.167.192.416-.113.603-.673.416-1.842-.14-1.897-.167-1.361-.802-2.5-1.86-3.301-3.307-.774-1.393-1.224-2.887-1.298-4.482-.02-.386.093-.522.477-.592a4.696 4.696 0 011.529-.039c2.132.312 3.946 1.265 5.468 2.774.868.86 1.525 1.887 2.202 2.891.72 1.066 1.494 2.082 2.48 2.914.348.292.625.514.891.677-.802.09-2.14.11-3.054-.614zm1-6.44a.306.306 0 01.415-.287.302.302 0 01.2.288.306.306 0 01-.31.307.303.303 0 01-.304-.308zm3.11 1.596c-.2.081-.399.151-.59.16a1.245 1.245 0 01-.798-.254c-.274-.23-.47-.358-.552-.758a1.73 1.73 0 01.016-.588c.07-.327-.008-.537-.239-.727-.187-.156-.426-.199-.688-.199a.559.559 0 01-.254-.078c-.11-.054-.2-.19-.114-.358.028-.054.16-.186.192-.21.356-.202.767-.136 1.146.016.352.144.618.408 1.001.782.391.451.462.576.685.914.176.265.336.537.445.848.067.195-.019.354-.25.452z"
      />
    </svg>
  );
}

const ICONS: Partial<Record<ModelProviderId, IconType>> = {
  openai: BsOpenai,
  anthropic: SiClaude,
  google: SiGooglegemini,
  xai: SiX,
  mistral: SiMistralai,
};

const SVG_MARKS: Partial<
  Record<
    ModelProviderId,
    (props: { className?: string; size: number }) => ReactNode
  >
> = {
  cohere: CohereMark,
  fireworks: FireworksMark,
  deepseek: DeepSeekMark,
};

const TEXT_MARKS: Partial<Record<ModelProviderId, string>> = {
  openai: "OA",
  anthropic: "A",
  google: "G",
  xai: "X",
  mistral: "M",
};

export function ModelProviderLogo({
  provider,
  className,
  size = 16,
}: {
  provider: ModelProviderId;
  className?: string;
  size?: number;
}) {
  const color = PROVIDER_BRAND_COLORS[provider];
  const Icon = ICONS[provider];
  if (Icon) {
    return (
      <Icon
        aria-hidden="true"
        className={className}
        size={size}
        style={{ color }}
      />
    );
  }
  const SvgMark = SVG_MARKS[provider];
  if (SvgMark) {
    return (
      <span
        aria-hidden="true"
        className={["inline-flex shrink-0", className]
          .filter(Boolean)
          .join(" ")}
        style={{ color, height: size, width: size }}
      >
        <SvgMark size={size} />
      </span>
    );
  }

  const style: CSSProperties = {
    width: size,
    height: size,
    color,
    ...scaledSvgWordmarkTypography(size),
  };

  return (
    <span
      aria-hidden="true"
      className={[
        "inline-flex shrink-0 items-center justify-center rounded-[3px] border border-current/20",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      style={style}
    >
      {TEXT_MARKS[provider] ?? provider.slice(0, 2).toUpperCase()}
    </span>
  );
}
