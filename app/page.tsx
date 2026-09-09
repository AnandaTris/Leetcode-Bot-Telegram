import { fetchDailyChallenge } from "@/lib/leetcode";

export const dynamic = "force-dynamic";

/**
 * A one-glance health check: if this page renders today's problem, the
 * LeetCode fetch works and the deployment is live.
 */
export default async function Page() {
  let body: React.ReactNode;
  try {
    const daily = await fetchDailyChallenge();
    body = (
      <>
        <p style={{ margin: "0 0 4px", fontSize: 13, color: "#8b939c" }}>{daily.date}</p>
        <h1 style={{ margin: "0 0 8px", fontSize: 22, fontWeight: 600 }}>
          {daily.id}. {daily.title}
        </h1>
        <p style={{ margin: "0 0 20px", fontSize: 14, color: "#8b939c" }}>
          {daily.difficulty} · {daily.acRate.toFixed(1)}% acceptance
        </p>
        <a
          href={daily.url}
          style={{
            display: "inline-block",
            padding: "8px 14px",
            borderRadius: 8,
            background: "#1f6feb",
            color: "white",
            fontSize: 14,
            textDecoration: "none",
          }}
        >
          Open on LeetCode ↗
        </a>
      </>
    );
  } catch (error) {
    body = (
      <p style={{ margin: 0, fontSize: 14, color: "#f85149" }}>
        Couldn&apos;t reach LeetCode: {error instanceof Error ? error.message : String(error)}
      </p>
    );
  }

  return (
    <main
      style={{
        maxWidth: 460,
        padding: 28,
        border: "1px solid #21262d",
        borderRadius: 14,
        background: "#12151a",
      }}
    >
      <p
        style={{
          margin: "0 0 18px",
          fontSize: 11,
          letterSpacing: "0.09em",
          textTransform: "uppercase",
          color: "#6e7681",
        }}
      >
        LeetCode Daily Bot · live
      </p>
      {body}
    </main>
  );
}
