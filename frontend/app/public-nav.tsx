/** Navigation shared by the public (no-login) pages. */
export function PublicNav() {
  return (
    <nav className="row" aria-label="About Freelance Income AI">
      <a className="link" href="/#signin">Sign in</a>
      <a className="link" href="/projects">Find work</a>
      <a className="link" href="/freelancers">Hire freelancers</a>
      <a className="link" href="/how-it-works">How it works</a>
      <a className="link" href="/pricing">Pricing</a>
      <a className="link" href="/safety">Safety</a>
      <a className="link" href="/help">Help</a>
      <a className="link" href="/about">About</a>
      <a className="link" href="/contact">Contact</a>
    </nav>
  );
}
