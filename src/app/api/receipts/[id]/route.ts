import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { Payment, Library, User } from "@/lib/models";
const escape = (value: unknown) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
export async function GET(
  _: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const user = await currentUser();
  if (!user)
    return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  const { id } = await ctx.params;
  if (!/^[a-f\d]{24}$/i.test(id))
    return NextResponse.json({ error: "Receipt not found" }, { status: 404 });
  const scope =
    user.role === "owner"
      ? { libraryId: user.libraryId }
      : { userId: user._id };
  const payment = await Payment.findOne({ _id: id, ...scope });
  if (!payment)
    return NextResponse.json({ error: "Receipt not found" }, { status: 404 });
  const [library, student] = await Promise.all([
    Library.findById(payment.libraryId),
    User.findById(payment.userId),
  ]);
  const amount = new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
  }).format(payment.amount / 100);
  return new NextResponse(
    `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Receipt ${escape(payment.receipt)}</title><style>body{font:16px system-ui;color:#243e35;max-width:640px;margin:60px auto;padding:30px}header{border-bottom:2px solid #20745b;padding-bottom:25px}h1{font-size:28px}dl{display:grid;grid-template-columns:1fr 1fr;gap:20px;margin:35px 0}dd{margin:0;font-weight:600}dt{color:#64776c}.amount{background:#edf5ef;padding:25px;border-radius:10px;font-size:28px}footer{font-size:12px;color:#64776c;margin-top:35px}@media print{body{margin:0}}</style><header><strong>✳ StudyQuest</strong><h1>Payment receipt</h1><p>${escape(library?.name)}</p></header><dl><dt>Receipt number</dt><dd>${escape(payment.receipt)}</dd><dt>Student</dt><dd>${escape(student?.name)}</dd><dt>Recorded on</dt><dd>${escape(payment.createdAt.toISOString().slice(0, 10))}</dd><dt>Payment method</dt><dd>${escape(payment.method.toUpperCase())}</dd><dt>Membership reference</dt><dd>${escape(payment.membershipId)}</dd></dl><div class="amount">${escape(amount)}<p style="font-size:13px">Confirmed payment received</p></div><footer>Generated from a confirmed cash / UPI record. This receipt is not a tax invoice. Use your browser’s Print command to save a PDF.</footer></html>`,
    {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "private, no-store",
        "Content-Security-Policy":
          "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'",
      },
    },
  );
}
