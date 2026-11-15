// Read-only comparison of the payment gateway's payments with local records. Creates, changes and refunds NOTHING.
//   npm run billing:reconcile [-- --days 30]
// Needs MONGODB_URI and the Razorpay key pair (test keys reconcile test payments, live keys live payments: use the matching environment).
import mongoose from "mongoose";
import { reconcileWithProvider } from "../src/lib/billing-reconcile";
import { scrubText } from "../src/lib/log";

const i = process.argv.indexOf("--days");
const days = i >= 0 ? Number(process.argv[i + 1]) || 7 : 7;
async function main() {
  if (!process.env.MONGODB_URI) throw new Error("MONGODB_URI is required");
  await mongoose.connect(process.env.MONGODB_URI);
  const r = await reconcileWithProvider({ days });
  console.log(JSON.stringify(r, null, 2));
  console.log(r.ok ? `RECONCILED (${r.mode}): ${r.providerPayments} gateway payments match ${r.localPayments} local records.` : `MISMATCHES (${r.discrepancies.length}): see docs/BILLING.md#reconciliation-mismatches`);
  if (!r.complete) console.log("NOTE: the gateway listing was truncated; widen or narrow --days");
  await mongoose.disconnect();
  process.exit(r.ok ? 0 : 1);
}
main().catch((e) => { console.error(scrubText(e instanceof Error ? e.message : String(e))); process.exit(1); });
