import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { listPrivacyRequests } from "../services/privacy.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const requests = await listPrivacyRequests(session.shop);

  return {
    requests: requests.map((item) => ({
      ...item,
      receivedAt: item.receivedAt.toISOString(),
      processedAt: item.processedAt?.toISOString() ?? null,
    })),
  };
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export default function PrivacyRequestsPage() {
  const { requests } = useLoaderData<typeof loader>();

  return (
    <s-page heading="Privacy requests">
      <div style={{ display: "grid", gap: 16, padding: "8px 0 32px" }}>
        <p style={{ color: "#626b73", maxWidth: 760, lineHeight: 1.6 }}>
          Customer data requests received from Shopify are listed here. Open a
          completed export to review the CreditFlow data associated with that
          customer, then transfer any requested information through your
          approved privacy-response process.
        </p>

        {requests.length === 0 ? (
          <section
            style={{
              border: "1px solid #e4e7e9",
              borderRadius: 12,
              padding: 24,
              background: "#fff",
            }}
          >
            <strong>No customer data requests</strong>
            <p style={{ color: "#69727a", marginBottom: 0 }}>
              New Shopify privacy data requests will appear here after they
              have been processed.
            </p>
          </section>
        ) : (
          <section
            style={{
              border: "1px solid #e4e7e9",
              borderRadius: 12,
              overflowX: "auto",
              background: "#fff",
            }}
          >
            <table
              style={{
                borderCollapse: "collapse",
                width: "100%",
                minWidth: 680,
                fontSize: 13,
              }}
            >
              <thead>
                <tr style={{ background: "#f8f9fa", textAlign: "left" }}>
                  <th style={{ padding: 14 }}>Request</th>
                  <th style={{ padding: 14 }}>Customer reference</th>
                  <th style={{ padding: 14 }}>Received</th>
                  <th style={{ padding: 14 }}>Status</th>
                  <th style={{ padding: 14 }}>Export</th>
                </tr>
              </thead>
              <tbody>
                {requests.map((item) => (
                  <tr key={item.id} style={{ borderTop: "1px solid #edf0f1" }}>
                    <td style={{ padding: 14 }}>{item.id}</td>
                    <td style={{ padding: 14 }}>
                      {item.customerKey ?? "—"}
                    </td>
                    <td style={{ padding: 14 }}>
                      {formatDate(item.receivedAt)}
                    </td>
                    <td style={{ padding: 14 }}>
                      <span>{item.status}</span>
                      {item.lastError ? (
                        <div style={{ color: "#a33", fontSize: 11, marginTop: 4 }}>
                          {item.lastError}
                        </div>
                      ) : null}
                    </td>
                    <td style={{ padding: 14 }}>
                      {item.status === "COMPLETED" ? (
                        <a
                          href={
                            "/api/privacy-requests?requestId=" +
                            encodeURIComponent(item.id)
                          }
                          target="_blank"
                          rel="noreferrer"
                        >
                          View JSON export
                        </a>
                      ) : (
                        <span style={{ color: "#7b848b" }}>Not ready</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        <p style={{ color: "#7b848b", fontSize: 12, maxWidth: 760 }}>
          Exports contain customer-linked information. Restrict access and
          retain or transfer exports only as required by your privacy process.
        </p>
      </div>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
