import type {
  HeadersFunction,
  LoaderFunctionArgs,
  ShouldRevalidateFunctionArgs,
} from "react-router";

import {
  Outlet,
  useLoaderData,
  useRouteError,
} from "react-router";

import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);

  return {
    apiKey: process.env.SHOPIFY_API_KEY || "",
  };
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

  return staysInsideAdminApp ? false : defaultShouldRevalidate;
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
