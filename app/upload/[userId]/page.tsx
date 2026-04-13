import { redirect } from "next/navigation";

export default async function UploadRedirect({
  params,
}: {
  params: Promise<{ userId: string }>;
}) {
  const { userId } = await params;
  redirect(`/app/${userId}`);
}
