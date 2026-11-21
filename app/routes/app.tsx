
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

// This route only provides the static Shopify API key to AppProvider.
// Dashboard, Automations, and API resource routes authenticate their own data.
// Keep this shell loader out of revalidation while navigation stays inside /app.
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
        <s-link href="/app">
          Dashboard
        </s-link>

        <s-link href="/app/automations">
          Automations
        </s-link>

        <s-link href="/app/privacy-requests">
          Privacy requests
        </s-link>
        <s-link href="/app/reversals">
          Refund reversals
        </s-link>
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
