/**
 * Four always-visible next steps for people who already have a project.
 */
export const AdvancedPathGrid = () => {
  const paths = [
    {
      title: "Direct the agent better",
      detail: "Change the story, source material, or several scenes with one clear revision.",
      action: "Give better direction",
      href: "/prompting/overview",
    },
    {
      title: "Edit in Studio",
      detail: "Change visible design, text, media, timing, and animation in the live project.",
      action: "Open the Studio guide",
      href: "/studio",
    },
    {
      title: "Build richer compositions",
      detail: "Add project media and reusable Catalog scenes before adapting them to your work.",
      action: "Use Assets and Catalog",
      href: "/studio/assets-and-blocks",
    },
    {
      title: "Check, render, and share",
      detail:
        "Validate the project, render through Studio, an agent, or the CLI, and review the file.",
      action: "Finish the project",
      href: "/guides/export-and-share",
    },
  ];
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 260px), 1fr))",
        gap: "1rem",
        margin: "1.5rem 0",
      }}
    >
      {paths.map((path) => (
        <article
          key={path.href}
          style={{
            overflow: "hidden",
            border: "1px solid var(--border-color, rgba(128, 128, 128, 0.22))",
            borderRadius: "12px",
          }}
        >
          <div style={{ padding: "0.9rem 1rem 1rem" }}>
            <strong style={{ display: "block", fontSize: "1rem", lineHeight: 1.35 }}>
              {path.title}
            </strong>
            <span
              style={{
                display: "block",
                marginTop: "0.35rem",
                fontSize: "0.875rem",
                lineHeight: 1.5,
                opacity: 0.72,
              }}
            >
              {path.detail}
            </span>
            <a
              href={path.href}
              style={{
                display: "inline-block",
                marginTop: "0.75rem",
                fontSize: "0.875rem",
                fontWeight: 600,
                color: "inherit",
                textDecoration: "none",
              }}
            >
              {path.action} →
            </a>
          </div>
        </article>
      ))}
    </div>
  );
};
