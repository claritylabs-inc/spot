"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { LogoIcon } from "@/components/ui/logo-icon";
import { OperationalPanel } from "@/components/ui/operational-panel";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api } from "@/convex/_generated/api";
import {
  type OperatorRouterCapabilities,
  useCachedOperatorGlobalToolSettings,
  useOperatorGlobalToolSettingsCacheActions,
} from "@/lib/sync/operator-cached-queries";
import { getUserFacingErrorMessage } from "@/lib/user-facing-error";
import { typeStyle } from "@/lib/typography";

type WebRetrievalProviderId = "parallel" | "exa" | "model_default";
type WebRetrieval = { primary: WebRetrievalProviderId };
type WebRetrievalProviderConfig = {
  id: WebRetrievalProviderId;
  label: string;
};
const PROVIDER_SELECT_WIDTH_CLASS = "w-full xl:w-44";
const WEB_RETRIEVAL_PRIORITY: WebRetrievalProviderId[] = [
  "parallel",
  "exa",
  "model_default",
];
const NATIVE_WEB_RETRIEVAL_PROVIDERS = new Set([
  "openai",
  "google",
  "anthropic",
  "xai",
]);

export function modelDefaultRetrievalConfigured(
  providers: Array<{ provider: string; configured: boolean }>,
  selectedModelProvider: string | null,
) {
  if (
    !selectedModelProvider ||
    !NATIVE_WEB_RETRIEVAL_PROVIDERS.has(selectedModelProvider)
  ) {
    return false;
  }
  return (
    providers.find((item) => item.provider === selectedModelProvider)
      ?.configured ?? false
  );
}

function ExaLogo({ size = 14 }: { size?: number }) {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height={size}
      viewBox="0 0 151 182"
      width={size}
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M150.5 14.1064C150.5 14.3356 150.421 14.5579 150.277 14.736L88.4766 91L150.277 167.264C150.421 167.442 150.5 167.664 150.5 167.894V181C150.5 181.552 150.052 182 149.5 182H1C0.44772 182 0 181.552 0 181V0.999995C0 0.44771 0.447715 0 1 0H149.5C150.052 0 150.5 0.447715 150.5 1V14.1064ZM30.4059 162.719H121.728L76.0664 106.326L30.4059 162.719ZM19.2949 100.261V145.787L56.1572 100.261H19.2949ZM19.2949 80.9801H55.5434L19.2949 36.2121V80.9801ZM76.0664 75.6731L121.728 19.281H30.4059L76.0664 75.6731Z"
        fill="#0143D9"
      />
    </svg>
  );
}

function ParallelLogo({ size = 14 }: { size?: number }) {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height={size}
      viewBox="0 0 271 270"
      width={size}
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M267.804 105.65H193.828C194.026 106.814 194.187 107.996 194.349 109.178H76.6703C76.4546 110.736 76.2388 112.312 76.0591 113.87H1.63342C1.27387 116.198 0.950289 118.543 0.698608 120.925H75.3759C75.2501 122.483 75.1602 124.059 75.0703 125.617H195.949C196.003 126.781 196.057 127.962 196.093 129.144H270.68V125.384C270.195 118.651 269.242 112.061 267.804 105.65Z"
        fill="currentColor"
      />
      <path
        d="M195.949 144.401H75.0703C75.1422 145.977 75.2501 147.535 75.3759 149.093H0.698608C0.950289 151.457 1.2559 153.802 1.63342 156.148H76.0591C76.2388 157.724 76.4366 159.282 76.6703 160.84H194.349C194.187 162.022 194.008 163.186 193.828 164.367H267.804C269.242 157.957 270.195 151.367 270.68 144.634V140.874H196.093C196.057 142.055 196.003 143.219 195.949 144.401Z"
        fill="currentColor"
      />
      <path
        d="M190.628 179.642H80.3559C80.7514 181.218 81.1828 182.776 81.6143 184.334H9.30994C10.2448 186.715 11.2515 189.061 12.3121 191.389H83.7536C84.2749 192.965 84.7962 194.523 85.3535 196.08H185.594C185.163 197.262 184.732 198.426 184.282 199.608H254.519C258.6 192.177 261.98 184.316 264.604 176.114H191.455C191.185 177.296 190.898 178.46 190.61 179.642H190.628Z"
        fill="currentColor"
      />
      <path
        d="M177.666 214.883H93.3352C94.1082 216.458 94.9172 218.034 95.7441 219.574H29.8756C31.8351 221.992 33.8666 224.337 35.9699 226.63H99.6632C100.598 228.205 101.551 229.781 102.522 231.321H168.498C167.761 232.503 167.006 233.685 166.233 234.849H226.762C234.474 227.847 241.36 219.95 247.292 211.355H179.356C178.799 212.537 178.26 213.719 177.684 214.883H177.666Z"
        fill="currentColor"
      />
      <path
        d="M154.943 250.106H116.058C117.371 251.699 118.701 253.257 120.067 254.797H73.021C91.6094 264.431 112.715 269.946 135.096 270C135.24 270 135.366 270 135.492 270C135.618 270 135.761 270 135.887 270C164.04 269.911 190.178 261.28 211.805 246.56H157.748C156.813 247.742 155.878 248.924 154.925 250.088L154.943 250.106Z"
        fill="currentColor"
      />
      <path
        d="M116.059 19.9124H154.943C155.896 21.0764 156.831 22.2582 157.766 23.4401H211.823C190.179 8.72065 164.058 0.0895344 135.906 0C135.762 0 135.636 0 135.51 0C135.384 0 135.24 0 135.115 0C112.715 0.0716275 91.6277 5.56904 73.0393 15.2029H120.086C118.719 16.7429 117.389 18.3187 116.077 19.8945L116.059 19.9124Z"
        fill="currentColor"
      />
      <path
        d="M93.3356 55.1532H177.667C178.242 56.3171 178.799 57.499 179.339 58.6808H247.274C241.342 50.0855 234.457 42.1886 226.744 35.187H166.215C166.988 36.351 167.743 37.5328 168.48 38.7147H102.504C101.533 40.2726 100.58 41.8305 99.6456 43.4063H35.9523C33.831 45.6804 31.7996 48.0262 29.858 50.4616H95.7265C94.8996 52.0195 94.1086 53.5774 93.3176 55.1532H93.3356Z"
        fill="currentColor"
      />
      <path
        d="M80.3736 90.3758H190.646C190.933 91.5398 191.221 92.7216 191.491 93.9035H264.64C262.015 85.7021 258.636 77.841 254.555 70.4097H184.318C184.767 71.5736 185.199 72.7555 185.63 73.9373H85.3893C84.832 75.4952 84.2927 77.0531 83.7893 78.6289H12.3479C11.2872 80.9389 10.2805 83.2847 9.3457 85.6842H81.65C81.2186 87.2421 80.7871 88.8 80.3916 90.3758H80.3736Z"
        fill="currentColor"
      />
    </svg>
  );
}

function usesDedicatedSearchApi(provider: WebRetrievalProviderId) {
  return provider === "parallel" || provider === "exa";
}

function WebRetrievalLogo({
  provider,
  size = 14,
}: {
  provider: WebRetrievalProviderId;
  size?: number;
}) {
  if (provider === "parallel") return <ParallelLogo size={size} />;
  if (provider === "exa") return <ExaLogo size={size} />;
  return <LogoIcon size={size} static />;
}

function providerSortIndex(provider: WebRetrievalProviderId) {
  const index = WEB_RETRIEVAL_PRIORITY.indexOf(provider);
  return index === -1 ? WEB_RETRIEVAL_PRIORITY.length : index;
}

function providerOptions(
  providers: WebRetrievalProviderConfig[],
  selectedProvider: WebRetrievalProviderId,
  availability: (provider: WebRetrievalProviderId) => boolean | null,
) {
  return providers
    .filter(
      (provider) =>
        availability(provider.id) !== false || provider.id === selectedProvider,
    )
    .sort(
      (left, right) => providerSortIndex(left.id) - providerSortIndex(right.id),
    );
}

function SearchProviderRow({
  webRetrieval,
  providers,
  saving,
  onCommit,
  capabilities,
  selectedModelProvider,
}: {
  webRetrieval: WebRetrieval;
  providers: WebRetrievalProviderConfig[];
  saving: boolean;
  onCommit: (next: WebRetrieval) => void | Promise<void>;
  capabilities: OperatorRouterCapabilities | undefined;
  selectedModelProvider: string | null;
}) {
  const selectedProvider = providers.find(
    (provider) => provider.id === webRetrieval.primary,
  );

  function commitProvider(primary: WebRetrievalProviderId) {
    void onCommit({ primary });
  }

  function providerAvailability(provider: WebRetrievalProviderId) {
    if (capabilities?.availability !== "available") return null;
    if (provider === "model_default") {
      return modelDefaultRetrievalConfigured(
        capabilities.webRetrieval.providers,
        selectedModelProvider,
      );
    }
    return (
      capabilities.webRetrieval.providers.find(
        (item) => item.provider === provider,
      )?.configured ?? false
    );
  }

  return (
    <div className="grid gap-3 py-3.5 xl:grid-cols-[1fr_auto] xl:items-center">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <p className={`text-foreground ${typeStyle("body.medium")}`}>
            Web search
          </p>
          {webRetrieval.primary !== "parallel" ? (
            <span
              className={`rounded-full bg-muted/55 px-2 py-0.5 text-muted-foreground ${typeStyle("label.tag")}`}
            >
              Override
            </span>
          ) : null}
        </div>
      </div>
      <div className="flex w-full flex-col gap-2 justify-self-start xl:w-auto xl:flex-row xl:justify-self-end">
        {saving ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground xl:self-center" />
        ) : null}
        <Select
          value={webRetrieval.primary}
          onValueChange={(nextProvider) => {
            if (!nextProvider) return;
            commitProvider(nextProvider as WebRetrievalProviderId);
          }}
          disabled={saving}
        >
          <SelectTrigger className={PROVIDER_SELECT_WIDTH_CLASS}>
            <SelectValue>
              <span className="flex min-w-0 items-center gap-2">
                <WebRetrievalLogo provider={webRetrieval.primary} size={15} />
                <span className={`truncate ${typeStyle("body.large")}`}>
                  {selectedProvider?.label ?? webRetrieval.primary}
                </span>
              </span>
            </SelectValue>
          </SelectTrigger>
          <SelectContent className="min-w-56">
            {providerOptions(
              providers,
              webRetrieval.primary,
              providerAvailability,
            ).map((provider) => (
              <SelectItem
                key={provider.id}
                value={provider.id}
                disabled={providerAvailability(provider.id) === false}
              >
                <span className="flex min-w-0 flex-1 items-center gap-2">
                  <WebRetrievalLogo provider={provider.id} size={15} />
                  <span className={`truncate ${typeStyle("body.large")}`}>
                    {provider.label}
                  </span>
                  <span
                    className={`ml-auto shrink-0 text-muted-foreground/60 ${typeStyle("caption.default")}`}
                  >
                    {providerAvailability(provider.id) === false
                      ? "Unavailable"
                      : providerAvailability(provider.id) === null
                        ? "Unknown"
                        : usesDedicatedSearchApi(provider.id)
                          ? "Router"
                          : "Available"}
                  </span>
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

export function ToolsTab({
  capabilities,
}: {
  capabilities: OperatorRouterCapabilities | undefined;
}) {
  const settings = useCachedOperatorGlobalToolSettings();
  const updateWebRetrieval = useMutation(
    api.modelSettings.updateGlobalWebRetrieval,
  );
  const { patchWebRetrieval } = useOperatorGlobalToolSettingsCacheActions();
  const [saving, setSaving] = useState(false);
  const selectedChatRoute =
    settings?.routes.chat ??
    settings?.tasks.find((task) => task.id === "chat")?.defaultRoute;

  async function commitWebRetrieval(next: WebRetrieval) {
    setSaving(true);
    try {
      await updateWebRetrieval({ webRetrieval: next });
      await patchWebRetrieval(next);
      toast.success("Search provider updated");
    } catch (error) {
      toast.error(
        getUserFacingErrorMessage(error, "Failed to update search provider"),
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex w-full flex-col gap-4">
      {capabilities?.availability === "unavailable" ? (
        <OperationalPanel>
          <div
            className={`px-4 py-3.5 text-muted-foreground ${typeStyle("body.default")}`}
          >
            {capabilities.message}
          </div>
        </OperationalPanel>
      ) : null}
      {settings === undefined ? (
        <OperationalPanel>
          <div className="flex h-40 items-center justify-center text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        </OperationalPanel>
      ) : (
        <OperationalPanel>
          <div className="px-4">
            <SearchProviderRow
              webRetrieval={settings.webRetrieval}
              providers={settings.webRetrievalProviders}
              saving={saving}
              onCommit={commitWebRetrieval}
              capabilities={capabilities}
              selectedModelProvider={selectedChatRoute?.provider ?? null}
            />
          </div>
        </OperationalPanel>
      )}
    </div>
  );
}
