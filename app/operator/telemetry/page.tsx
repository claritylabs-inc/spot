import { redirect } from "next/navigation";
export default function TelemetryRedirect() {
  redirect("/operator/logs");
}
