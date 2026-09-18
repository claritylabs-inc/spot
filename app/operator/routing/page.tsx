import { redirect } from "next/navigation";
export default function RoutingRedirect() {
  redirect("/operator/settings?section=models");
}
