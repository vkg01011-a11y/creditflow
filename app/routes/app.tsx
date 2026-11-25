import type {
  HeadersFunction,
  LoaderFunctionArgs,
  ShouldRevalidateFunctionArgs,
} from "react-router";

import {
  Outlet,
  redirect,
  useLoaderData,
  useRouteError,
} from "react-router";

import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { authenticate } from "../shopify.server";
import { getBillingStatus, getPlanSelectionUrl } from "../services/billing.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const pathname = new URL(request.url).pathname;

  // Leave Plan & usage available so merchants can select or change a plan.
  // Once configured, every other app route requires an active Shopify plan.
  if (pathname !== "/app/billing") {
    try {
      const billing = await getBillingStatus(admin, session.shop);
      if (billing.configured && !billing.active) {
        throw redirect(getPlanSelectionUrl(session.shop));
      }
    } catch (error) {
      if (error instanceof Response) throw error;
      // Keep core Store Credit automation available during Partner API outages.
      console.error("[CreditFlow] Could not verify app subscription", {
        shop: session.shop,
        errorName: error instanceof Error ? error.name : "UnknownError",
      });
    }
  }

  return { apiKey: process.env.SHOPIFY_API_KEY || "" };
};

// The shell only provides the static Shopify API key. Each page loads its own
// shop-scoped data, so keep this loader out of in-app navigation revalidation.
export const shouldRevalidate = ({
  currentUrl,
  nextUrl,
  defaultShouldRevalidate,
}: ShouldRevalidateFunctionArgs) => {
  const isAdminAppPath = (pathname: string) =>
    pathname === "/app" || pathname.startsWith("/app/");
  const staysInsideAdminApp =
    isAdminAppPath(currentUrl.pathname) &&
    isAdminAppPath(nextUrl.pathname);

  const entersOrLeavesBilling = currentUrl.pathname === "/app/billing" || nextUrl.pathname === "/app/billing";
  return staysInsideAdminApp && !entersOrLeavesBilling ? false : defaultShouldRevalidate;
};

export default function App() {
  const { apiKey } = useLoaderData<typeof loader>();

  return (
    <AppProvider apiKey={apiKey}>
      <s-app-nav>
        <s-link href="/app">Overview</s-link>
        <s-link href="/app/setup">Setup</s-link>
        <s-link href="/app/automations">Rewards</s-link>
        <s-link href="/app/notifications">Emails</s-link>
        <s-link href="/app/billing">Plan &amp; usage</s-link>
        <s-link href="/app/automation-history">Activity</s-link>
        <s-link href="/app/reversals">Refunds</s-link>
      </s-app-nav>

      <Outlet />
    </AppProvider>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
