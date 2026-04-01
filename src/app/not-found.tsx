export default function NotFound() {
  return (
    <div
      style={{
        minHeight: "100vh",
        backgroundColor: "#faf8f4",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        textAlign: "center",
        padding: "2rem",
      }}
    >
      <div>
        <p
          style={{
            fontSize: "8rem",
            fontWeight: 700,
            color: "#e5e7eb",
            margin: 0,
            lineHeight: 1,
            letterSpacing: "-0.04em",
            fontVariant: "small-caps",
          }}
        >
          404
        </p>

        <h1
          style={{
            fontFamily: "'Instrument Serif', serif",
            fontWeight: 400,
            color: "#000",
            letterSpacing: "-0.03em",
            fontSize: "2.5rem",
            margin: "0.5rem 0 0",
          }}
        >
          Nothing here
        </h1>

        <p
          style={{
            color: "#6b7280",
            fontSize: "1rem",
            lineHeight: 1.6,
            maxWidth: "28rem",
            margin: "1rem auto 0",
          }}
        >
          This page doesn&apos;t exist. If you&apos;re looking to upload a
          policy, text Spot to get your link.
        </p>

        <a
          href="https://claritylabs.inc"
          style={{
            display: "inline-block",
            marginTop: "2rem",
            backgroundColor: "#111827",
            color: "#fff",
            borderRadius: "999px",
            padding: "0.6rem 1.5rem",
            fontSize: "0.85rem",
            textDecoration: "none",
            fontFamily: "inherit",
          }}
        >
          Go to Clarity Labs
        </a>

        <p
          style={{
            color: "#8a8578",
            fontSize: "0.75rem",
            fontVariant: "small-caps",
            marginTop: "3rem",
            letterSpacing: "0.05em",
          }}
        >
          clarity labs
        </p>
      </div>
    </div>
  );
}
