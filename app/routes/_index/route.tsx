import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, Form, useActionData, useLoaderData } from "react-router";

import { login } from "../../shopify.server";
import { loginErrorMessage } from "./error.server";

import styles from "./styles.module.css";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);

  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }

  return { showForm: Boolean(login) };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const errors = loginErrorMessage(await login(request));

  return { errors };
};

export default function App() {
  const { showForm } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const errors = actionData?.errors;

  return (
    <div className={styles.index}>
      <div className={styles.content}>
        <h1 className={styles.heading}>Store credit rewards built for Shopify</h1>
        <p className={styles.text}>
          CreditFlow automates cashback rules, customer emails and refund-aware reversals while Shopify keeps control of every customer’s store credit balance.
        </p>
        {showForm && (
          <Form className={styles.form} method="post">
            <label className={styles.label}>
              <span>Shop domain</span>
              <input className={styles.input} type="text" name="shop" />
              <span>{errors?.shop ?? "e.g: my-shop-domain.myshopify.com"}</span>
            </label>
            <button className={styles.button} type="submit">
              Log in
            </button>
          </Form>
        )}
        <ul className={styles.list}>
          <li>
            <strong>Flexible reward rules</strong>. Set eligibility and reward amounts without code, then preview a rule before activating it.
          </li>
          <li>
            <strong>Shopify Native Store Credit</strong>. CreditFlow records reward and reversal metadata; it does not create a competing wallet.
          </li>
          <li>
            <strong>Clear operations</strong>. Review order evaluations, refund reversals, customer emails and work that needs reconciliation.
          </li>
        </ul>
      </div>
    </div>
  );
}
