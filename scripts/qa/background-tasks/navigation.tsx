import { useSyncExternalStore, type AnchorHTMLAttributes } from "react";
function subscribe(listener: () => void) {
  window.addEventListener("popstate", listener);
  return () => window.removeEventListener("popstate", listener);
}
export function usePathname() {
  return useSyncExternalStore(subscribe, () => location.pathname);
}
const router = {
  push(path: string) {
    history.pushState({}, "", path);
    window.dispatchEvent(new PopStateEvent("popstate"));
  },
};
export function useRouter() {
  return router;
}
export default function Link({
  href = "",
  ...props
}: AnchorHTMLAttributes<HTMLAnchorElement>) {
  return (
    <a
      {...props}
      href={href}
      onClick={(event) => {
        event.preventDefault();
        router.push(href);
      }}
    />
  );
}
