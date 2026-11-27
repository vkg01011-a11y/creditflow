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

function statusClass(status: string) {
  if (status === "COMPLETED") return "cfp-status cfp-status--completed";
  if (status === "FAILED" || status === "REVIEW_REQUIRED") {
    return "cfp-status cfp-status--failed";
  }
  return "cfp-status";
}

function humanize(value: string) {
  return value.toLowerCase().replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export default function PrivacyRequestsPage() {
  const { requests } = useLoaderData<typeof loader>();

  return (
    <s-page heading="Privacy requests">
      <div className="cfp-page">
        <p className="cfp-intro">
          Customer data requests received from Shopify are listed here. Open a
          completed export to review the Pikmora Perks data associated with that
          customer, then transfer any requested information through your
          approved privacy-response process.
        </p>

        <section className="cfp-panel">
          <div className="cfp-panel-head">
            <div className="cfp-panel-title">Customer data requests</div>
            <span className="cfp-count">{requests.length} {requests.length === 1 ? "request" : "requests"}</span>
          </div>

          {requests.length === 0 ? (
            <div className="cfp-empty">
              <div className="cfp-empty-title">No customer data requests</div>
              <p className="cfp-empty-copy">
                New Shopify privacy data requests will appear here after they
                have been processed.
              </p>
            </div>
          ) : (
            <div className="cfp-table-wrap">
              <table className="cfp-table">
                <thead>
                  <tr>
                    <th>Request</th>
                    <th>Customer reference</th>
                    <th>Received</th>
                    <th>Status</th>
                    <th>Export</th>
                  </tr>
                </thead>
                <tbody>
                  {requests.map((item) => (
                    <tr key={item.id}>
                      <td><span className="cfp-request-id">{item.id}</span></td>
                      <td><span className="cfp-reference">{item.customerKey ?? "—"}</span></td>
                      <td><span className="cfp-date">{formatDate(item.receivedAt)}</span></td>
                      <td>
                        <span className={statusClass(item.status)}>{humanize(item.status)}</span>
                        {item.lastError ? <div className="cfp-error">{item.lastError}</div> : null}
                      </td>
                      <td>
                        {item.status === "COMPLETED" ? (
                          <a
                            className="cfp-export"
                            href={"/api/privacy-requests?requestId=" + encodeURIComponent(item.id)}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            View JSON export
                          </a>
                        ) : (
                          <span className="cfp-muted">Not ready</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <p className="cfp-privacy-note">
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
