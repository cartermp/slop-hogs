const NEW_ISSUE_URL = "https://github.com/cartermp/slop-hogs/issues/new";

function issueUrl(title: string, body: string): string {
  return `${NEW_ISSUE_URL}?title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`;
}

const feedbackUrl = issueUrl(
  "[Feedback] ",
  "## Feedback\n\n<!-- What would make Slop Hogs better? -->\n\n",
);

const bugUrl = issueUrl(
  "[Bug] ",
  "## What happened?\n\n\n## What did you expect?\n\n\n## Steps to reproduce\n\n1. \n\n## Device and browser\n\n",
);

export function FeedbackLinks({ variant }: { variant: "login" | "game" }) {
  return (
    <nav className={`feedback-links feedback-links-${variant}`} aria-label="Help improve Slop Hogs">
      <a
        href={feedbackUrl}
        target="_blank"
        rel="noreferrer"
        aria-label="Share feedback on GitHub (opens in a new tab)"
      >
        [ SHARE FEEDBACK ]
      </a>
      <a
        href={bugUrl}
        target="_blank"
        rel="noreferrer"
        aria-label="Report a bug on GitHub (opens in a new tab)"
      >
        [ REPORT A BUG ]
      </a>
    </nav>
  );
}
