/**
 * The human workflow router.
 *
 * Every route begins with source material a person already recognizes. The
 * destination guide carries the complete example and instructions.
 */
export const WorkflowChooser = () => {
  // Keep data inside the component. Mintlify compiles only the named export and
  // drops module-level constants from snippet files.
  const routes = [
    {
      title: "Show a product or website",
      bring: "Bring a URL, launch brief, or product story.",
      href: "/guides/product-launch-video",
    },
    {
      title: "Explain an idea",
      bring: "Bring notes, an article, a script, or one rough thought.",
      href: "/guides/faceless-explainer",
    },
    {
      title: "Work with existing footage",
      bring: "Bring a talking-head, interview, or podcast clip.",
      href: "/guides/captions-and-recuts",
    },
    {
      title: "Explain a pull request",
      bring: "Bring a GitHub pull request link.",
      href: "/guides/pr-to-video",
    },
    {
      title: "Make a short motion graphic",
      bring: "Bring a message, number, quote, chart, or logo.",
      href: "/guides/motion-graphics",
    },
    {
      title: "Cut to music",
      bring: "Bring a track and any photos or video you want to use.",
      href: "/guides/music-to-video",
    },
    {
      title: "Build a presentation",
      bring: "Bring an outline, pitch, report, or existing deck.",
      href: "/guides/slideshow",
    },
    {
      title: "Direct a custom video",
      bring: "Bring the outcome you want and whatever source material you have.",
      href: "/guides/general-video",
    },
    {
      title: "Port a Remotion composition",
      bring: "Bring an existing Remotion project. One-way migration, not a new build.",
      href: "/guides/hyperframes-vs-remotion",
    },
  ];

  return (
    <div className="hf-workflow-routes">
      {routes.map((route) => (
        <a
          key={route.href}
          href={route.href}
          aria-label={`${route.title}. ${route.bring}`}
          className="hf-workflow-route"
        >
          <span>
            <span className="hf-workflow-route-title">{route.title}</span>
            <span className="hf-workflow-route-copy">{route.bring}</span>
          </span>
        </a>
      ))}
    </div>
  );
};
