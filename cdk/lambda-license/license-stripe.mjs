/* The Stripe calls the license service makes, over plain fetch —
 * no Stripe SDK to bundle. Stripe takes form-encoded bodies. */
const API = "https://api.stripe.com/v1";

export function createStripe(secretKey, fetchImpl = fetch) {
  async function call(method, path, params) {
    const response = await fetchImpl(`${API}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${secretKey}`,
        ...(params && { "content-type": "application/x-www-form-urlencoded" }),
      },
      body: params && new URLSearchParams(params).toString(),
    });
    if (response.status === 404) return null;
    const body = await response.json();
    if (!response.ok) {
      throw new Error(`Stripe ${method} ${path}: ${response.status} ${body?.error?.message ?? ""}`);
    }
    return body;
  }
  return {
    createCheckoutSession: (params) => call("POST", "/checkout/sessions", params),
    getCheckoutSession: (id) =>
      call("GET", `/checkout/sessions/${encodeURIComponent(id)}?expand[]=subscription`),
    getSubscription: (id) => call("GET", `/subscriptions/${encodeURIComponent(id)}`),
    /* The key as a custom field on the customer's invoices — so it's in
     * every invoice Stripe emails — and as metadata, to find it in the
     * dashboard. */
    tagCustomer: (customerId, licenseKey) =>
      call("POST", `/customers/${encodeURIComponent(customerId)}`, {
        "invoice_settings[custom_fields][0][name]": "License key",
        "invoice_settings[custom_fields][0][value]": licenseKey,
        "metadata[license_key]": licenseKey,
      }),
  };
}
