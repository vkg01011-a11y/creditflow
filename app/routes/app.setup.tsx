import type { LoaderFunctionArgs } from "react-router";
import { Link, useLoaderData } from "react-router";

import { authenticate } from "../shopify.server";
import db from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const [
    rewardRuleCount,
    activeRewardCount,
    emailSettings,
    executionCount,
    issuedCount,
  ] = await Promise.all([
    db.automationRule.count({
      where: { shop, archivedAt: null },
    }),
    db.automationRule.count({
      where: { shop, archivedAt: null, enabled: true },
    }),
    db.emailNotificationSettings.findUnique({
      where: { shop },
      select: {
        issuedEmailMode: true,
        expiryReminderEnabled: true,
      },
    }),
    db.automationExecution.count({ where: { shop } }),
    db.automationExecution.count({ where: { shop, status: "ISSUED" } }),
  ]);

  const emailMode = emailSettings?.issuedEmailMode ?? "SHOPIFY_NATIVE";
  const customEmailProviderReady = Boolean(
    process.env.RESEND_API_KEY && process.env.CREDITFLOW_EMAIL_FROM,
  );

  const emailReady =
    emailMode === "SHOPIFY_NATIVE" ||
    (emailMode === "CREDITFLOW_CUSTOM" && customEmailProviderReady);

  const readySteps = [
    rewardRuleCount > 0,
    emailReady,
    activeRewardCount > 0,
  ].filter(Boolean).length;

  return {
    rewardRuleCount,
    activeRewardCount,
    pausedRewardCount: Math.max(0, rewardRuleCount - activeRewardCount),
    emailMode,
    emailReady,
    customEmailProviderReady,
    expiryReminderEnabled: emailSettings?.expiryReminderEnabled ?? false,
    executionCount,
    issuedCount,
    readySteps,
  };
};

export default function SetupPage() {
  const data = useLoaderData<typeof loader>();
  const progress = Math.round((data.readySteps / 3) * 100);

  const rewardStatus =
    data.rewardRuleCount === 0
      ? "Not started"
      : data.activeRewardCount > 0
        ? "Rewards available"
        : "Saved · paused";

  const emailStatus =
    data.emailMode === "SHOPIFY_NATIVE"
      ? "Shopify notifications"
      : data.emailMode === "CREDITFLOW_CUSTOM"
        ? data.customEmailProviderReady
          ? "Custom emails ready"
          : "Email provider needs setup"
        : "Emails turned off";

  const emailDescription =
    data.emailMode === "SHOPIFY_NATIVE"
      ? "Shopify's native store-credit notification is selected. This is the default and requires no extra email provider setup."
      : data.emailMode === "CREDITFLOW_CUSTOM"
        ? data.customEmailProviderReady
          ? "CreditFlow customer emails are selected and the email provider is configured."
          : "Custom emails are selected, but the hosting email provider is not configured yet. Use Shopify's native notification until this is ready."
        : "Customer notifications are currently disabled. Review this choice before enabling rewards.";

  const activationDescription =
    data.activeRewardCount > 0
      ? `${data.activeRewardCount} reward ${data.activeRewardCount === 1 ? "rule is" : "rules are"} active and can award store credit when an order qualifies.`
      : data.rewardRuleCount > 0
        ? "Your saved rewards are paused. No automatic rewards are issued until you choose to enable a rule."
        : "Create a reward first. You can keep it paused while you review its conditions and reward amount.";

  return (
    <s-page heading="Setup guide">
      <div className="cfs-page">
        <style>{`
          .cfs-page {
            display: grid;
            gap: 18px;
            padding: 8px 0 38px;
            color: #202923;
            font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          }
          .cfs-page * { box-sizing: border-box; }
          .cfs-hero {
            display: grid;
            grid-template-columns: minmax(0, 1fr) minmax(230px, .48fr);
            gap: 18px;
            align-items: stretch;
          }
          .cfs-hero-copy { padding: 4px 0; }
          .cfs-eyebrow {
            color: #738078;
            font-size: 10px;
            font-weight: 700;
            letter-spacing: .1em;
            text-transform: uppercase;
          }
          .cfs-title {
            margin: 8px 0 7px;
            color: #202923;
            font-size: clamp(25px, 3vw, 32px);
            font-weight: 670;
            letter-spacing: -.055em;
            line-height: 1.12;
          }
          .cfs-lead {
            max-width: 660px;
            margin: 0;
            color: #748078;
            font-size: 12px;
            line-height: 1.7;
          }
          .cfs-progress {
            display: grid;
            align-content: center;
            gap: 11px;
            padding: 17px;
            border: 1px solid #e5eae6;
            border-radius: 12px;
            background: #fff;
            box-shadow: 0 1px 2px rgba(27,39,31,.025);
          }
          .cfs-progress-top {
            display: flex;
            justify-content: space-between;
            align-items: center;
            gap: 10px;
          }
          .cfs-progress-label { color: #59665e; font-size: 11px; font-weight: 620; }
          .cfs-progress-value { color: #263b30; font-size: 18px; font-weight: 700; letter-spacing: -.04em; }
          .cfs-track { height: 7px; overflow: hidden; border-radius: 20px; background: #edf1ed; }
          .cfs-track-fill { height: 100%; border-radius: inherit; background: #54765f; transition: width .25s ease; }
          .cfs-progress-note { color: #849087; font-size: 10px; line-height: 1.5; }
          .cfs-section-heading {
            display: flex;
            justify-content: space-between;
            align-items: end;
            gap: 12px;
          }
          .cfs-section-heading h2 {
            margin: 0;
            color: #2b3830;
            font-size: 14px;
            font-weight: 660;
            letter-spacing: -.02em;
          }
          .cfs-section-heading p { margin: 4px 0 0; color: #87928a; font-size: 10px; line-height: 1.5; }
          .cfs-steps {
            display: grid;
            grid-template-columns: repeat(3, minmax(0, 1fr));
            gap: 11px;
          }
          .cfs-step {
            display: flex;
            flex-direction: column;
            gap: 13px;
            min-width: 0;
            padding: 16px;
            border: 1px solid #e5eae6;
            border-radius: 11px;
            background: #fff;
            box-shadow: 0 1px 2px rgba(27,39,31,.025);
          }
          .cfs-step-top { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
          .cfs-step-number {
            display: inline-grid;
            place-items: center;
            width: 27px;
            height: 27px;
            border-radius: 8px;
            background: #edf3ee;
            color: #315b48;
            font-size: 11px;
            font-weight: 700;
          }
          .cfs-status {
            display: inline-flex;
            align-items: center;
            max-width: 100%;
            padding: 5px 8px;
            border: 1px solid #e7ece8;
            border-radius: 20px;
            background: #f6f8f6;
            color: #69766d;
            font-size: 9px;
            font-weight: 650;
            line-height: 1.3;
          }
          .cfs-status--good { border-color: #e0ece3; background: #eff6f0; color: #426d4e; }
          .cfs-status--attention { border-color: #eee3d1; background: #faf5ec; color: #80643b; }
          .cfs-step h3 { margin: 0; color: #27352d; font-size: 13px; font-weight: 670; letter-spacing: -.015em; }
          .cfs-step-copy { min-height: 66px; margin: 6px 0 0; color: #78847c; font-size: 10px; line-height: 1.65; }
          .cfs-step-meta {
            padding-top: 10px;
            border-top: 1px solid #edf0ed;
            color: #69776e;
            font-size: 10px;
            line-height: 1.5;
          }
          .cfs-step-action {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            align-self: flex-start;
            min-height: 34px;
            margin-top: auto;
            padding: 0 11px;
            border: 1px solid #263b30;
            border-radius: 8px;
            background: #263b30;
            color: #fff;
            font-size: 10px;
            font-weight: 640;
            text-decoration: none;
            transition: background .15s ease, border-color .15s ease;
          }
          .cfs-step-action:hover { border-color: #355344; background: #355344; color: #fff; }
          .cfs-lower {
            display: grid;
            grid-template-columns: minmax(0, 1.15fr) minmax(260px, .85fr);
            gap: 11px;
            align-items: stretch;
          }
          .cfs-panel {
            display: grid;
            align-content: start;
            gap: 13px;
            min-width: 0;
            padding: 16px;
            border: 1px solid #e5eae6;
            border-radius: 11px;
            background: #fff;
          }
          .cfs-panel h2 { margin: 0; color: #2b3830; font-size: 13px; font-weight: 660; }
          .cfs-tool-list { display: grid; gap: 0; }
          .cfs-tool {
            display: flex;
            justify-content: space-between;
            align-items: center;
            gap: 12px;
            padding: 11px 0;
            border-top: 1px solid #edf0ed;
            color: inherit;
            text-decoration: none;
          }
          .cfs-tool:first-child { border-top: 0; padding-top: 0; }
          .cfs-tool:last-child { padding-bottom: 0; }
          .cfs-tool strong { display: block; color: #344239; font-size: 10px; font-weight: 650; }
          .cfs-tool small { display: block; margin-top: 3px; color: #87928a; font-size: 9px; line-height: 1.45; }
          .cfs-tool-arrow { color: #758278; font-size: 17px; }
          .cfs-note {
            padding: 11px 13px;
            border: 1px solid #e7ece8;
            border-radius: 9px;
            background: #f8faf8;
            color: #718077;
            font-size: 10px;
            line-height: 1.6;
          }
          @media (max-width: 900px) {
            .cfs-hero { grid-template-columns: 1fr; }
            .cfs-steps { grid-template-columns: 1fr; }
            .cfs-step-copy { min-height: 0; }
            .cfs-lower { grid-template-columns: 1fr; }
          }
          @media (max-width: 560px) {
            .cfs-page { gap: 14px; }
            .cfs-progress, .cfs-step, .cfs-panel { padding: 13px; }
          }
          @media (prefers-reduced-motion: reduce) {
            .cfs-track-fill { transition: none; }
          }
        `}</style>

        <section className="cfs-hero">
          <div className="cfs-hero-copy">
            <div className="cfs-eyebrow">A simple starting point</div>
            <h1 className="cfs-title">Get CreditFlow ready</h1>
            <p className="cfs-lead">
              Set up when customers earn store credit, choose how they hear about it,
              and switch rewards on only when you are comfortable. Your Shopify store
              remains in control of customer credit balances.
            </p>
          </div>

          <aside className="cfs-progress" aria-label="Setup progress">
            <div className="cfs-progress-top">
              <span className="cfs-progress-label">Setup progress</span>
              <span className="cfs-progress-value">{data.readySteps}/3</span>
            </div>
            <div
              className="cfs-track"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={3}
              aria-valuenow={data.readySteps}
              aria-label="Setup steps ready"
            >
              <div className="cfs-track-fill" style={{ width: `${progress}%` }} />
            </div>
            <div className="cfs-progress-note">
              {data.readySteps === 3
                ? "Your core reward setup is ready. You can review it any time."
                : "Complete the essentials below. Nothing is activated automatically from this page."}
            </div>
          </aside>
        </section>

        <div className="cfs-section-heading">
          <div>
            <h2>Your three setup steps</h2>
            <p>Follow them in order, or return whenever you need to make a change.</p>
          </div>
        </div>

        <section className="cfs-steps">
          <article className="cfs-step">
            <div className="cfs-step-top">
              <span className="cfs-step-number">1</span>
              <span className={`cfs-status ${data.rewardRuleCount > 0 ? "cfs-status--good" : "cfs-status--attention"}`}>
                {data.rewardRuleCount > 0 ? "Reward saved" : "Not started"}
              </span>
            </div>
            <div>
              <h3>Create your rewards</h3>
              <p className="cfs-step-copy">
                Decide when customers qualify, which products count and how much
                store credit they can earn.
              </p>
            </div>
            <div className="cfs-step-meta">
              {data.rewardRuleCount > 0
                ? `${data.rewardRuleCount} saved · ${data.activeRewardCount} active · ${data.pausedRewardCount} paused`
                : "No reward rules have been created yet."}
            </div>
            <Link className="cfs-step-action" to="/app/automations">
              {data.rewardRuleCount > 0 ? "Review rewards" : "Create your first reward"}
            </Link>
          </article>

          <article className="cfs-step">
            <div className="cfs-step-top">
              <span className="cfs-step-number">2</span>
              <span className={`cfs-status ${data.emailReady ? "cfs-status--good" : "cfs-status--attention"}`}>
                {emailStatus}
              </span>
            </div>
            <div>
              <h3>Choose customer emails</h3>
              <p className="cfs-step-copy">{emailDescription}</p>
            </div>
            <div className="cfs-step-meta">
              {data.expiryReminderEnabled
                ? "Expiry reminders are enabled."
                : "Expiry reminders are currently off."}
            </div>
            <Link className="cfs-step-action" to="/app/notifications">
              Review email settings
            </Link>
          </article>

          <article className="cfs-step">
            <div className="cfs-step-top">
              <span className="cfs-step-number">3</span>
              <span className={`cfs-status ${data.activeRewardCount > 0 ? "cfs-status--good" : "cfs-status--attention"}`}>
                {data.activeRewardCount > 0
                  ? "Active"
                  : data.rewardRuleCount > 0
                    ? "Paused"
                    : "Waiting for rewards"}
              </span>
            </div>
            <div>
              <h3>Switch rewards on when ready</h3>
              <p className="cfs-step-copy">{activationDescription}</p>
            </div>
            <div className="cfs-step-meta">
              Only the first matching reward rule is applied to an order. Rewards do not stack.
            </div>
            <Link className="cfs-step-action" to="/app/automations">
              Review reward status
            </Link>
          </article>
        </section>

        <section className="cfs-lower">
          <article className="cfs-panel">
            <h2>Keep an eye on results</h2>
            <div className="cfs-tool-list">
              <Link className="cfs-tool" to="/app/automation-history">
                <span>
                  <strong>Reward activity</strong>
                  <small>
                    {data.executionCount.toLocaleString()} evaluations recorded · {data.issuedCount.toLocaleString()} rewards issued
                  </small>
                </span>
                <span className="cfs-tool-arrow" aria-hidden="true">›</span>
              </Link>
              <Link className="cfs-tool" to="/app/reversals">
                <span>
                  <strong>Refunds</strong>
                  <small>Review store-credit reversals connected to Shopify refunds</small>
                </span>
                <span className="cfs-tool-arrow" aria-hidden="true">›</span>
              </Link>
            </div>
          </article>

          <article className="cfs-panel">
            <h2>Other tools</h2>
            <div className="cfs-tool-list">
              <Link className="cfs-tool" to="/app/automation-simulator">
                <span>
                  <strong>Reward preview</strong>
                  <small>Estimate a reward using sample order details. No credit is issued.</small>
                </span>
                <span className="cfs-tool-arrow" aria-hidden="true">›</span>
              </Link>
              <Link className="cfs-tool" to="/app/operations">
                <span>
                  <strong>System status</strong>
                  <small>Check order processing, customer emails and background jobs.</small>
                </span>
                <span className="cfs-tool-arrow" aria-hidden="true">›</span>
              </Link>
              <Link className="cfs-tool" to="/app/privacy-requests">
                <span>
                  <strong>Privacy requests</strong>
                  <small>Review customer data requests received from Shopify.</small>
                </span>
                <span className="cfs-tool-arrow" aria-hidden="true">›</span>
              </Link>
            </div>
          </article>
        </section>

        <p className="cfs-note">
          Important: CreditFlow manages reward rules and records. Shopify remains the
          authoritative source for each customer's available store credit balance.
          This guide never activates a rule or issues credit.
        </p>
      </div>
    </s-page>
  );
}
