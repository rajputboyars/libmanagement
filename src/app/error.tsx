"use client";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main className="loading">
      <h1>Let’s try that again.</h1>
      <p>Your space couldn’t load. Please retry.</p>
      <button className="button" onClick={reset}>
        Try again
      </button>
    </main>
  );
}
