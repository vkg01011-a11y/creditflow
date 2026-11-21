import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { listPrivacyRequests } from "../services/privacy.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const requestId = url.searchParams.get("requestId") ?? undefined;

  if (requestId && requestId.length > 100) {
    return Response.json(
      { error: "Invalid privacy request ID." },
      { status: 400 },
    );
  }

  if (requestId) {
    const privacyRequest = await listPrivacyRequests(session.shop, requestId);

    if (!privacyRequest) {
      return Response.json(
        { error: "Privacy request not found." },
        { status: 404 },
      );
    }

    return Response.json(
      { request: privacyRequest },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  }

  const requests = await listPrivacyRequests(session.shop);
  return Response.json(
    { requests },
    { headers: { "Cache-Control": "private, no-store" } },
  );
};
