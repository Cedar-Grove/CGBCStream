function authErrorMessage(): string | null {
  const code = new URLSearchParams(window.location.search).get("authError");
  if (code === "domain") {
    return "That Google account isn't on an authorized Cedar Grove domain.";
  }
  if (code === "failed") {
    return "Sign-in failed. Please try again.";
  }
  return null;
}

export default function Login() {
  const error = authErrorMessage();

  return (
    <div className="login-screen">
      <div className="login-form">
        <h1>CGBCStream</h1>
        <p className="muted">Sign in with your Cedar Grove Google account.</p>
        {error && <p className="error">{error}</p>}
        <a className="button-link google-signin" href="/api/auth/login">
          Sign in with Google
        </a>
      </div>
    </div>
  );
}
