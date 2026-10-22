"use client";

import { BrandLoader } from "@/components/brand-loader";
import dynamic from "next/dynamic";

/**
 * Route-level code splitting. These screens are only needed after sign-in or on specific routes, so they are loaded on
 * demand instead of shipping inside the first bundle of every public page.
 */
const Skeleton = () => <BrandLoader compact text="Loading…" />;

export const Phase2Experience = dynamic(() => import("./phase2").then((m) => m.Phase2Experience), { loading: Skeleton });
export const LearningIntelligence = dynamic(() => import("./learning-intelligence").then((m) => m.LearningIntelligence), { loading: Skeleton });
export const DoubtSolver = dynamic(() => import("./doubt-solver").then((m) => m.DoubtSolver), { loading: Skeleton });
export const RewardsMarketplace = dynamic(() => import("./rewards-marketplace").then((m) => m.RewardsMarketplace), { loading: Skeleton });
export const LibraryDiscovery = dynamic(() => import("./library-discovery").then((m) => m.LibraryDiscovery), { loading: Skeleton });
export const Maintenance = dynamic(() => import("./maintenance").then((m) => m.Maintenance), { loading: Skeleton });
export const ExamPrep = dynamic(() => import("./prep").then((m) => m.ExamPrep), { loading: Skeleton });
export const TestResult = dynamic(() => import("./prep-test").then((m) => m.TestResult), { loading: Skeleton });
export const TestRunner = dynamic(() => import("./prep-test").then((m) => m.TestRunner), { loading: Skeleton });
export const PrepAdmin = dynamic(() => import("./prep-admin").then((m) => m.PrepAdmin), { loading: Skeleton });
export const OwnerBilling = dynamic(() => import("./saas-owner").then((m) => m.OwnerBilling), { loading: Skeleton });
export const OwnerBranches = dynamic(() => import("./saas-owner").then((m) => m.OwnerBranches), { loading: Skeleton });
export const OwnerCrm = dynamic(() => import("./saas-owner").then((m) => m.OwnerCrm), { loading: Skeleton });
export const OwnerSupport = dynamic(() => import("./saas-owner").then((m) => m.OwnerSupport), { loading: Skeleton });
export const Onboarding = dynamic(() => import("./saas-owner").then((m) => m.Onboarding), { loading: Skeleton });
export const SaasAdmin = dynamic(() => import("./saas-admin").then((m) => m.SaasAdmin), { loading: Skeleton });
export const PlatformFeatures = dynamic(() => import("./platform-admin").then((m) => m.PlatformFeatures), { loading: Skeleton });
export const PlatformStudentRules = dynamic(() => import("./platform-admin").then((m) => m.PlatformStudentRules), { loading: Skeleton });
export const PlatformAccounts = dynamic(() => import("./platform-admin").then((m) => m.PlatformAccounts), { loading: Skeleton });
export const PilotImport = dynamic(() => import("./pilot").then((m) => m.PilotImport), { loading: Skeleton });
export const AccountSecurity = dynamic(() => import("./account").then((m) => m.AccountSecurity), { loading: Skeleton });
export const ForgotPassword = dynamic(() => import("./account").then((m) => m.ForgotPassword), { loading: Skeleton });
export const ResetPassword = dynamic(() => import("./account").then((m) => m.ResetPassword), { loading: Skeleton });
export const Community = dynamic(() => import("./community").then((m) => m.Community), { loading: Skeleton });
export const CommunityModeration = dynamic(() => import("./community").then((m) => m.CommunityModeration), { loading: Skeleton });
export const DemoPage = dynamic(() => import("./saas-public").then((m) => m.DemoPage), { loading: Skeleton });
export const SandboxCheckout = dynamic(() => import("./saas-public").then((m) => m.SandboxCheckout), { loading: Skeleton });
export const SaasPricing = dynamic(() => import("./saas-public").then((m) => m.SaasPricing), { loading: Skeleton });
export const Auth = dynamic(() => import("./auth").then((m) => m.Auth), { loading: Skeleton });
export const StudentJoin = dynamic(() => import("./join").then((m) => m.StudentJoin), { loading: Skeleton });
export const StudentPunch = dynamic(() => import("./join").then((m) => m.StudentPunch), { loading: Skeleton });
export const OwnerJoinRequests = dynamic(() => import("./join").then((m) => m.OwnerJoinRequests), { loading: Skeleton });
export const OwnerPresence = dynamic(() => import("./join").then((m) => m.OwnerPresence), { loading: Skeleton });
