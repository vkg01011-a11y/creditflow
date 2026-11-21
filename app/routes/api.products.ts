import type {
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";

import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { toShopifySearchQuery } from "../domain/shopify-product-search.mjs";

type ProductOption = {
  id: string;
  title: string;
  handle: string;
};

type ProductCatalogPayload = {
  errors?: Array<{ message?: string }>;
  data?: {
    nodes?: Array<ProductOption | null>;
    products?: {
      nodes?: ProductOption[];
      pageInfo?: {
        hasNextPage?: boolean;
        endCursor?: string | null;
      };
    } | null;
  } | null;
};

const PRODUCT_PAGE_SIZE = 50;
const MAX_SEARCH_LENGTH = 120;
const MAX_CURSOR_LENGTH = 2048;
const MAX_SELECTED_IDS = 500;
const SELECTED_ID_BATCH_SIZE = 200;

export const loader = async ({
  request,
}: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const url = new URL(request.url);
  const rawQuery = url.searchParams.get("q") ?? "";
  const rawCursor = url.searchParams.get("after");
  const selectedParam = url.searchParams.get("selected");
  const selectedIds = selectedParam
    ? selectedParam.split(",").filter(Boolean)
    : [];

  if (rawQuery.length > MAX_SEARCH_LENGTH) {
    return Response.json(
      { error: "Product search is too long." },
      { status: 400, headers: { "Cache-Control": "private, no-store" } },
    );
  }

  if (rawCursor && rawCursor.length > MAX_CURSOR_LENGTH) {
    return Response.json(
      { error: "Product pagination cursor is invalid." },
      { status: 400, headers: { "Cache-Control": "private, no-store" } },
    );
  }

  if (
    selectedIds.length > MAX_SELECTED_IDS ||
    selectedIds.some((id) => !/^\d+$/.test(id))
  ) {
    return Response.json(
      { error: "The selected product list is invalid." },
      { status: 400, headers: { "Cache-Control": "private, no-store" } },
    );
  }

  const query = toShopifySearchQuery(rawQuery);
  const cursor = rawCursor || null;

  try {
    const catalogRequest = admin.graphql(
      `#graphql
        query CreditFlowProductOptions(
          $first: Int!,
          $after: String,
          $query: String
        ) {
          products(
            first: $first,
            after: $after,
            query: $query,
            sortKey: TITLE
          ) {
            nodes {
              id
              title
              handle
            }
            pageInfo {
              hasNextPage
              endCursor
            }
          }
        }
      `,
      {
        variables: {
          first: PRODUCT_PAGE_SIZE,
          after: cursor,
          query: query || null,
        },
      },
    );

    const selectedBatches: string[][] = [];
    for (let index = 0; index < selectedIds.length; index += SELECTED_ID_BATCH_SIZE) {
      selectedBatches.push(
        selectedIds.slice(index, index + SELECTED_ID_BATCH_SIZE),
      );
    }

    const [response, ...selectedResponses] = await Promise.all([
      catalogRequest,
      ...selectedBatches.map((batch) =>
        admin.graphql(
          `#graphql
            query CreditFlowSelectedProducts($ids: [ID!]!) {
              nodes(ids: $ids) {
                ... on Product {
                  id
                  title
                  handle
                }
              }
            }
          `,
          {
            variables: {
              ids: batch.map((id) => `gid://shopify/Product/${id}`),
            },
          },
        ),
      ),
    ]);

    if (!response.ok) {
      throw new Error(`Shopify returned HTTP ${response.status}.`);
    }

    const payload = (await response.json()) as ProductCatalogPayload;
    const connection = payload.data?.products;

    if (payload.errors?.length || !connection) {
      throw new Error(
        payload.errors
          ?.map((error) => error.message || "Unknown GraphQL error")
          .join("; ") || "Shopify did not return the product catalogue.",
      );
    }

    const selectedProducts: ProductOption[] = [];
    for (const selectedResponse of selectedResponses) {
      if (!selectedResponse.ok) {
        throw new Error(
          `Shopify returned HTTP ${selectedResponse.status} while resolving selected products.`,
        );
      }

      const selectedPayload =
        (await selectedResponse.json()) as ProductCatalogPayload;

      if (selectedPayload.errors?.length) {
        throw new Error(
          selectedPayload.errors
            .map((error) => error.message || "Unknown GraphQL error")
            .join("; "),
        );
      }

      selectedProducts.push(
        ...(selectedPayload.data?.nodes ?? []).filter(
          (node): node is ProductOption => Boolean(node),
        ),
      );
    }

    return Response.json(
      {
        products: connection.nodes ?? [],
        ...(selectedParam !== null ? { selectedProducts } : {}),
        pageInfo: {
          hasNextPage: Boolean(connection.pageInfo?.hasNextPage),
          endCursor: connection.pageInfo?.endCursor ?? null,
        },
        after: cursor,
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    console.error(
      "[CreditFlow] Product catalogue request failed:",
      error,
    );

    return Response.json(
      {
        error:
          "Shopify could not load products. Check read_products access and try again.",
      },
      {
        status: 502,
        headers: { "Cache-Control": "private, no-store" },
      },
    );
  }
};

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
