const ALLNETAIRTIME_API_KEY = process.env.ALLNETAIRTIME_API_KEY;
const ALLNETAIRTIME_BASE_URL = "https://allnetairtime.co.za";

if (!ALLNETAIRTIME_API_KEY) {
  console.warn("ALLNETAIRTIME_API_KEY is not set — airtime redemption will always fail closed.");
}

interface AirtimeVoucherResult {
  success: boolean;
  error?: string;
  reference?: string;
  vouchers?: Array<{ voucherId: number; pin: string; value: number }>;
  raw?: unknown;
}

async function callAllNetAirtime(path: string, body: Record<string, unknown>) {
  const response = await fetch(`${ALLNETAIRTIME_BASE_URL}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": ALLNETAIRTIME_API_KEY as string,
    },
    body: JSON.stringify(body),
  });
  const json = await response.json().catch(() => null);
  return { ok: response.ok, status: response.status, json };
}

/**
 * Places a real airtime voucher order via AllNetAirtime (a Freepaid product), then
 * immediately fetches the order back to retrieve the actual voucher PIN(s) — the
 * order response itself only contains order metadata, never the PINs directly.
 * Order values must be whole Rand amounts between 2 and 999 per their API contract.
 * The user redeems the PIN themselves by dialing *130*410*01*their_pin# on any network.
 */
export async function orderAirtimeVoucher(value: number): Promise<AirtimeVoucherResult> {
  if (!ALLNETAIRTIME_API_KEY) {
    return { success: false, error: "Airtime redemption is not configured." };
  }
  if (!Number.isInteger(value) || value < 2 || value > 999) {
    return { success: false, error: "Airtime amount must be a whole number between R2 and R999." };
  }

  // Step 1: place the order.
  let orderResult;
  try {
    orderResult = await callAllNetAirtime("/api/order.php", {
      quantity: 1,
      value,
      description: "KwandaData wallet redemption",
    });
  } catch (err) {
    console.error("Failed to reach AllNetAirtime order.php:", err);
    return { success: false, error: "Could not reach the airtime provider right now. Please try again." };
  }

  if (!orderResult.ok || !orderResult.json || orderResult.json.status === "error") {
    const body = orderResult.json;
    // 400 validation failures carry the real detail in data.errors, not the generic message.
    const validationErrors = body?.data?.errors;
    const message = Array.isArray(validationErrors) && validationErrors.length > 0
      ? validationErrors.join(" ")
      : (body?.message || "Could not place the airtime order right now.");
    console.error("AllNetAirtime order.php failed:", orderResult.status, body);
    return { success: false, error: message, raw: body };
  }

  const orderData = orderResult.json.data || {};
  const reference: string | undefined = orderData.reference;
  if (!reference) {
    console.error("AllNetAirtime order.php succeeded but returned no reference:", orderResult.json);
    return { success: false, error: "Order placed but could not be confirmed. Please contact support with this timestamp.", raw: orderResult.json };
  }

  // Step 2: fetch the same order back to get the actual voucher PIN(s).
  let fetchResult;
  try {
    fetchResult = await callAllNetAirtime("/api/fetch_order.php", { reference });
  } catch (err) {
    console.error("Failed to reach AllNetAirtime fetch_order.php:", err);
    return {
      success: false,
      error: `Your order was placed (reference ${reference}) but we couldn't retrieve the PIN. Please contact support with this reference.`,
      reference,
    };
  }

  if (!fetchResult.ok || !fetchResult.json || fetchResult.json.status === "error") {
    console.error("AllNetAirtime fetch_order.php failed:", fetchResult.status, fetchResult.json);
    return {
      success: false,
      error: `Your order was placed (reference ${reference}) but we couldn't retrieve the PIN. Please contact support with this reference.`,
      reference,
      raw: fetchResult.json,
    };
  }

  const vouchers = (fetchResult.json.data?.vouchers || []).map((v: any) => ({
    voucherId: v.voucher_id,
    pin: v.pin,
    value: v.value,
  }));

  return { success: true, reference, vouchers, raw: fetchResult.json };
}