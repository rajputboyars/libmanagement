import { Schema } from "mongoose";
import { id, model } from "./models";

const Mixed = Schema.Types.Mixed;

// ── Tenancy: Organization → branches (a branch is an existing Library document) ──
export const Organization = model(
  "Organization",
  {
    name: { type: String, required: true, trim: true, maxlength: 100 },
    ownerId: { type: id, required: true, index: true },
    status: { type: String, enum: ["active", "suspended"], default: "active", index: true },
    suspendedReason: { type: String, default: "", maxlength: 300 },
    isTest: { type: Boolean, default: false },
    referralCode: { type: String, unique: true, sparse: true, uppercase: true },
    referredByCode: { type: String, uppercase: true },
    onboardingStatus: { type: String, enum: ["pending", "complete"], default: "pending" },
    billingEmail: { type: String, default: "", lowercase: true, trim: true },
    gstin: { type: String, default: "", trim: true, maxlength: 20 },
  },
  [[{ createdAt: -1 }, {}]],
);
export const OrganizationMembership = model(
  "OrganizationMembership",
  {
    organizationId: { type: id, required: true },
    userId: { type: id, required: true, index: true },
    role: { type: String, enum: ["org-owner", "branch-manager", "staff"], required: true },
    branchIds: [id],
    marketingOptIn: { type: Boolean, default: false },
  },
  [[{ organizationId: 1, userId: 1 }, { unique: true }]],
);
export const StudentTransfer = model(
  "StudentTransfer",
  {
    organizationId: { type: id, required: true, index: true },
    studentId: { type: id, required: true, index: true },
    fromLibraryId: { type: id, required: true },
    toLibraryId: { type: id, required: true },
    actorId: { type: id, required: true },
    note: { type: String, default: "", maxlength: 300 },
  },
);
export const PendingStudent = model(
  "PendingStudent",
  {
    libraryId: { type: id, required: true },
    organizationId: { type: id, required: true },
    name: { type: String, required: true, trim: true, maxlength: 80 },
    email: { type: String, required: true, lowercase: true, trim: true },
    phone: { type: String, default: "", trim: true, maxlength: 20 },
    status: { type: String, enum: ["pending", "linked"], default: "pending" },
  },
  [[{ libraryId: 1, email: 1 }, { unique: true }], [{ email: 1, status: 1 }, {}]],
);

// ── Plans, entitlements, subscriptions ──
export const SaaSPlan = model(
  "SaaSPlan",
  {
    key: { type: String, required: true, lowercase: true, trim: true, maxlength: 30 },
    version: { type: Number, required: true, min: 1 },
    current: { type: Boolean, default: true },
    name: { type: String, required: true, trim: true, maxlength: 40 },
    description: { type: String, default: "", maxlength: 300 },
    monthlyPaise: { type: Number, required: true, min: 0 },
    annualPaise: { type: Number, required: true, min: 0 },
    trialDays: { type: Number, default: 0, min: 0, max: 90 },
    limits: { activeStudents: { type: Number, required: true, min: 1 }, branches: { type: Number, required: true, min: 1 } },
    features: [{ type: String, trim: true, maxlength: 40 }],
    providerPlanIds: { type: Mixed, default: {} },
    isPublic: { type: Boolean, default: true },
    sortOrder: { type: Number, default: 0 },
    createdBy: id,
  },
  [[{ key: 1, version: 1 }, { unique: true }], [{ key: 1, current: 1 }, {}]],
);
export const SaaSSubscription = model(
  "SaaSSubscription",
  {
    organizationId: { type: id, required: true, unique: true },
    planKey: { type: String, required: true },
    planVersion: { type: Number, required: true },
    planSnapshot: { type: Mixed, required: true },
    interval: { type: String, enum: ["monthly", "annual"], default: "monthly" },
    status: { type: String, enum: ["trialing", "active", "past_due", "canceled", "expired"], required: true, index: true },
    trialStart: Date,
    trialEnd: Date,
    currentPeriodStart: Date,
    currentPeriodEnd: Date,
    cancelAtPeriodEnd: { type: Boolean, default: false },
    canceledAt: Date,
    pastDueSince: Date,
    source: { type: String, enum: ["free", "trial", "provider", "credit", "admin"], default: "free" },
    provider: { type: String, enum: ["razorpay", "sandbox"] },
    providerSubscriptionId: { type: String, unique: true, sparse: true },
    checkoutUrl: String,
    mode: { type: String, enum: ["live", "sandbox", "none"], default: "none" },
    lastProviderEventAt: Date,
    couponCode: String,
    pendingPlan: { key: String, interval: String },
    overrides: { type: Mixed },
    history: [{ _id: false, at: Date, status: String, planKey: String, reason: String, by: id }],
  },
  [[{ status: 1, currentPeriodEnd: 1 }, {}], [{ trialEnd: 1 }, {}]],
);
export const BillingInvoice = model(
  "BillingInvoice",
  {
    organizationId: { type: id, required: true },
    subscriptionId: id,
    number: { type: String, required: true, unique: true },
    providerPaymentId: { type: String, unique: true, sparse: true },
    mode: { type: String, enum: ["live", "sandbox", "credit"], required: true },
    planKey: String,
    periodStart: Date,
    periodEnd: Date,
    lineItems: [{ _id: false, description: String, amountPaise: Number }],
    subtotalPaise: { type: Number, required: true, min: 0 },
    discountPaise: { type: Number, default: 0, min: 0 },
    taxMode: { type: String, enum: ["none", "inclusive", "exclusive"], default: "none" },
    taxRateBps: { type: Number, default: 0 },
    taxPaise: { type: Number, default: 0, min: 0 },
    totalPaise: { type: Number, required: true, min: 0 },
    amountPaidPaise: { type: Number, default: 0, min: 0 },
    refundedPaise: { type: Number, default: 0, min: 0 },
    status: { type: String, enum: ["open", "paid", "failed", "void", "partially_refunded", "refunded"], default: "open", index: true },
    failureReason: String,
    paidAt: Date,
  },
  [[{ organizationId: 1, createdAt: -1 }, {}], [{ status: 1, createdAt: -1 }, {}]],
);
export const BillingPayment = model(
  "BillingPayment",
  {
    organizationId: { type: id, required: true },
    invoiceId: id,
    provider: { type: String, required: true },
    providerPaymentId: { type: String, required: true },
    providerSubscriptionId: String,
    amountPaise: { type: Number, required: true, min: 0 },
    status: { type: String, enum: ["captured", "failed", "partially_refunded", "refunded"], required: true },
    refundedPaise: { type: Number, default: 0, min: 0 },
    method: String,
    mode: { type: String, enum: ["live", "sandbox"], required: true },
    capturedAt: Date,
    failureReason: String,
    lastEventAt: Date,
  },
  [[{ provider: 1, providerPaymentId: 1 }, { unique: true }], [{ organizationId: 1, createdAt: -1 }, {}]],
);
export const BillingWebhookEvent = model(
  "BillingWebhookEvent",
  {
    provider: { type: String, required: true },
    eventId: { type: String, required: true },
    type: { type: String, required: true },
    mode: { type: String, enum: ["live", "sandbox"], required: true },
    providerCreatedAt: Date,
    status: { type: String, enum: ["received", "processing", "processed", "ignored", "failed"], default: "received" },
    error: String,
    attempts: { type: Number, default: 0 },
    payload: { type: Mixed },
    processedAt: Date,
  },
  [[{ provider: 1, eventId: 1 }, { unique: true }]],
);
export const SubscriptionCredit = model(
  "SubscriptionCredit",
  {
    organizationId: { type: id, required: true, index: true },
    amountPaise: { type: Number, required: true },
    reason: { type: String, enum: ["referral", "admin", "prepay", "adjustment"], required: true },
    key: { type: String, required: true, unique: true },
    note: { type: String, default: "", maxlength: 200 },
    createdBy: id,
  },
);
export const Coupon = model(
  "Coupon",
  {
    code: { type: String, required: true, unique: true, uppercase: true, trim: true, maxlength: 30 },
    name: { type: String, required: true, trim: true, maxlength: 80 },
    campaign: { type: String, default: "", trim: true, maxlength: 60 },
    type: { type: String, enum: ["percent", "fixed"], required: true },
    value: { type: Number, required: true, min: 1 },
    maxRedemptions: { type: Number, default: 100, min: 1 },
    redemptions: { type: Number, default: 0, min: 0 },
    validFrom: Date,
    validTo: Date,
    plans: [String],
    active: { type: Boolean, default: true },
    providerOfferId: { type: String, default: "" },
    createdBy: id,
  },
);
export const CouponRedemption = model(
  "CouponRedemption",
  { couponId: { type: id, required: true }, organizationId: { type: id, required: true }, code: String, discountPaise: Number },
  [[{ couponId: 1, organizationId: 1 }, { unique: true }]],
);
export const Referral = model(
  "Referral",
  {
    referrerOrgId: { type: id, required: true, index: true },
    referredOrgId: { type: id, required: true, unique: true },
    code: { type: String, required: true },
    status: { type: String, enum: ["pending", "qualified", "rewarded", "rejected"], default: "pending", index: true },
    rejectReason: { type: String, default: "" },
    qualifiedAt: Date,
  },
);

// ── CRM, support, notifications ──
export const AdmissionLead = model(
  "AdmissionLead",
  {
    libraryId: { type: id, required: true, index: true },
    organizationId: id,
    name: { type: String, required: true, trim: true, maxlength: 80 },
    phone: { type: String, default: "", trim: true, maxlength: 20 },
    email: { type: String, default: "", lowercase: true, trim: true, maxlength: 120 },
    message: { type: String, default: "", trim: true, maxlength: 500 },
    source: { type: String, enum: ["website", "walk-in", "referral", "social", "campaign", "other"], default: "website" },
    campaign: { type: String, default: "", maxlength: 60 },
    stage: { type: String, enum: ["new", "contacted", "visit-scheduled", "converted", "lost"], default: "new", index: true },
    assignedTo: id,
    visitAt: Date,
    lostReason: { type: String, default: "", maxlength: 200 },
    consentContact: { type: Boolean, default: false },
    consentAt: Date,
    dedupeKey: { type: String, required: true },
    enquiryCount: { type: Number, default: 1 },
    history: [{ _id: false, at: Date, stage: String, by: id, note: String }],
  },
  [[{ libraryId: 1, dedupeKey: 1 }, { unique: true }], [{ libraryId: 1, stage: 1, createdAt: -1 }, {}]],
);
export const FollowUpTask = model(
  "FollowUpTask",
  {
    libraryId: { type: id, required: true },
    leadId: { type: id, required: true, index: true },
    assignedTo: id,
    dueAt: { type: Date, required: true },
    note: { type: String, default: "", maxlength: 200 },
    done: { type: Boolean, default: false },
    doneAt: Date,
  },
  [[{ libraryId: 1, done: 1, dueAt: 1 }, {}]],
);
export const PlatformLead = model(
  "PlatformLead",
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    email: { type: String, required: true, lowercase: true, trim: true, maxlength: 120 },
    phone: { type: String, default: "", maxlength: 20 },
    libraryName: { type: String, default: "", maxlength: 100 },
    message: { type: String, default: "", maxlength: 500 },
    consentContact: { type: Boolean, default: false },
    status: { type: String, enum: ["new", "contacted", "scheduled", "closed"], default: "new" },
  },
  [[{ email: 1, createdAt: -1 }, {}]],
);
export const SupportTicket = model(
  "SupportTicket",
  {
    organizationId: { type: id, required: true, index: true },
    libraryId: id,
    createdBy: { type: id, required: true },
    subject: { type: String, required: true, trim: true, maxlength: 120 },
    category: { type: String, enum: ["billing", "technical", "account", "feature", "other"], default: "other" },
    priority: { type: String, enum: ["low", "normal", "high"], default: "normal" },
    status: { type: String, enum: ["open", "pending", "resolved", "closed"], default: "open", index: true },
    messages: [{ _id: false, authorId: id, role: { type: String, enum: ["owner", "admin"] }, body: { type: String, maxlength: 2000 }, at: Date }],
    history: [{ _id: false, status: String, by: id, at: Date }],
  },
  [[{ status: 1, updatedAt: -1 }, {}]],
);
export const NotificationDelivery = model(
  "NotificationDelivery",
  {
    key: { type: String, required: true, unique: true },
    organizationId: id,
    userId: id,
    channel: { type: String, enum: ["in-app", "email", "whatsapp"], required: true },
    kind: { type: String, required: true },
    marketing: { type: Boolean, default: false },
    status: { type: String, enum: ["sent", "skipped", "failed", "pending"], required: true },
    attempts: { type: Number, default: 0 },
    error: String,
  },
);
export const SaaSAuditLog = model(
  "SaaSAuditLog",
  {
    organizationId: { type: id, index: true },
    actorId: { type: id, required: true },
    actorRole: String,
    action: { type: String, required: true },
    targetType: String,
    targetId: String,
    details: { type: Mixed },
  },
  [[{ createdAt: -1 }, {}]],
);
export const PlatformSettings = model("PlatformSettings", {
  key: { type: String, default: "default", unique: true },
  taxMode: { type: String, enum: ["none", "inclusive", "exclusive"], default: "none" },
  taxRateBps: { type: Number, default: 0, min: 0, max: 10000 },
  gstin: { type: String, default: "", maxlength: 20 },
  legalName: { type: String, default: "", maxlength: 120 },
  graceDays: { type: Number, default: 7, min: 0, max: 60 },
  referralEnabled: { type: Boolean, default: true },
  referralRewardPaise: { type: Number, default: 29900, min: 0 },
  referralMonthlyCap: { type: Number, default: 5, min: 0 },
  invoicePrefix: { type: String, default: "SQ", maxlength: 8 },
  invoiceSeq: { type: Number, default: 0 },
  // Student features that need an active, fully paid library membership (see student-access.ts).
  premiumStudentFeatures: { type: [String], default: [] },
});
export const VerificationCode = model(
  "VerificationCode",
  {
    userId: { type: id, required: true },
    channel: { type: String, enum: ["email", "mobile"], required: true },
    target: { type: String, required: true },
    codeHash: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    attempts: { type: Number, default: 0 },
    verifiedAt: Date,
  },
  [[{ userId: 1, channel: 1, createdAt: -1 }, {}]],
);
export const OnboardingDraft = model(
  "OnboardingDraft",
  {
    userId: { type: id, required: true, unique: true },
    organizationId: id,
    libraryId: id,
    completed: [String],
    data: { type: Mixed, default: {} },
    status: { type: String, enum: ["draft", "complete"], default: "draft" },
    lastStep: { type: String, default: "organization" },
  },
);

export const BillingCheckout = model(
  "BillingCheckout",
  {
    organizationId: { type: id, required: true, index: true },
    planKey: { type: String, required: true },
    planVersion: { type: Number, required: true },
    interval: { type: String, enum: ["monthly", "annual"], required: true },
    provider: { type: String, required: true },
    mode: { type: String, enum: ["live", "sandbox"], required: true },
    providerSubscriptionId: { type: String, required: true, unique: true },
    checkoutUrl: String,
    couponCode: String,
    status: { type: String, enum: ["created", "completed", "abandoned", "failed"], default: "created" },
    createdBy: id,
  },
);
