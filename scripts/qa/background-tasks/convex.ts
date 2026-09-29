import { useMemo } from "react";
import { getFunctionName } from "convex/server";

const details = {
  _id: "request-1",
  title: "Synthetic request",
  status: "submitted",
  createdAt: 1790683200000,
  packet: { markdown: "Synthetic supporting files." },
  files: [],
};
export function useQuery() {
  return details;
}
export function useMutation(reference: Parameters<typeof getFunctionName>[0]) {
  const name = getFunctionName(reference);
  return useMemo(
    () => async (args: unknown) => {
      const response = await fetch(`/rpc/${name}`, {
        method: "POST",
        body: JSON.stringify(args),
      });
      if (!response.ok) throw new Error("Synthetic request failed");
      return response.json();
    },
    [name],
  );
}
export const useAction = useMutation;
