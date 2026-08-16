import { DashboardApp } from "../dashboard/components/dashboard-app";

export const dynamic = "force-dynamic";

export default function Home() {
  return (
    <>
      <DashboardApp allowDevelopmentShell={process.env.NODE_ENV !== "production"} />
      <a
        href="/verification-test"
        aria-label="Open Custom UID verification test"
        style={{
          position: "fixed",
          right: 20,
          bottom: 20,
          zIndex: 80,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          minHeight: 44,
          padding: "0 16px",
          borderRadius: 12,
          background: "#111827",
          color: "#ffffff",
          fontWeight: 700,
          textDecoration: "none",
          boxShadow: "0 8px 24px rgba(0,0,0,0.22)",
        }}
      >
        Custom UID Test
      </a>
    </>
  );
}
